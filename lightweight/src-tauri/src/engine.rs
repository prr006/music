use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use rand::seq::SliceRandom;
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;

use crate::config;
use crate::lyrics::LyricsProvider;
use crate::mpv::Mpv;
use crate::runtime::RuntimePaths;
use crate::types::{AppSettings, Playlist, QueueItem, QueueSource, RepeatMode, Track};
use crate::ytdlp::YtDlp;

const REFILL_THRESHOLD: usize = 5;
/// Session playback history is capped like the legacy player's.
const HISTORY_MAX: usize = 200;
/// Upper bound for a pending mpv load. A load that is not confirmed by
/// `file-loaded` within this window is treated as failed so playback never
/// spins in a loading state forever.
const LOAD_TIMEOUT: Duration = Duration::from_secs(45);

/// Load timeout, overridable via `MELO_LOAD_TIMEOUT_MS` (mainly for tests).
fn load_timeout() -> Duration {
    std::env::var("MELO_LOAD_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .map(Duration::from_millis)
        .unwrap_or(LOAD_TIMEOUT)
}

#[derive(Debug, Clone)]
pub struct RefillRequest {
    pub generation: u64,
    pub from_id: String,
}

/// A queued track whose `loadfile` has been issued but whose load has not yet
/// been confirmed by mpv (`file-loaded`). Queue/history/current-track state is
/// committed only once the load succeeds, so a failed load never corrupts them.
struct PendingAdvance {
    next: Track,
}

pub struct Engine {
    pub mpv: Mpv,
    pub ytdlp: YtDlp,
    pub(crate) lyrics: Arc<LyricsProvider>,
    pub events: UnboundedSender<Value>,
    pub current_track: Option<Track>,
    pub queue: Vec<QueueItem>,
    pub history: Vec<Track>,
    /// Track ids already present in the session history, so each track is
    /// recorded at most once even after the history window trims it.
    pub history_seen: HashSet<String>,
    pub favorites: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub downloads: Vec<Track>,
    pub settings: AppSettings,
    pub shuffle: bool,
    pub fetching_mix: bool,
    pub mix_generation: u64,
    pub downloading: HashSet<String>,
    /// True while an internal transition is advancing to the next track.
    pub advancing: bool,
    /// True from the moment a new URL is issued to mpv until `file-loaded`.
    /// Prevents idle/end-file events from advancing again while a load is in flight.
    pub load_pending: bool,
    /// True once an auto-advance has been attempted for the current idle state.
    /// Prevents a duplicate `end-file` from retrying in a tight loop when a
    /// load fails; reset by the next successful `file-loaded` or user action.
    pub advance_attempted: bool,
    /// Deferred auto-advance awaiting mpv `file-loaded`.
    pub pending_advance: Option<PendingAdvance>,
    /// Timestamp when the current in-flight load began, for the load timeout.
    pub load_started: Option<Instant>,
}

impl Engine {
    pub fn new(runtime: &RuntimePaths, events: UnboundedSender<Value>) -> Self {
        Engine {
            mpv: Mpv::new(),
            ytdlp: YtDlp::new(runtime.ytdlp.clone()),
            lyrics: Arc::new(LyricsProvider::new()),
            events,
            current_track: None,
            queue: vec![],
            history: vec![],
            history_seen: HashSet::new(),
            favorites: config::load_favorites(),
            playlists: config::load_playlists(),
            downloads: config::load_downloads(),
            settings: config::load_settings(),
            shuffle: false,
            fetching_mix: false,
            mix_generation: 0,
            downloading: HashSet::new(),
            advancing: false,
            load_pending: false,
            advance_attempted: false,
            pending_advance: None,
            load_started: None,
        }
    }

    pub async fn start(&mut self, runtime: &RuntimePaths) -> anyhow::Result<()> {
        let mpv_path = runtime
            .mpv
            .clone()
            .ok_or_else(|| anyhow::anyhow!("bundled mpv not found"))?;
        let proxy = std::env::var("YTMUSIC_PROXY").unwrap_or_default();
        let ytdlp_dir = runtime.ytdlp.as_deref().and_then(|p| p.parent()).map(|p| p.to_path_buf());
        self.mpv.start(&mpv_path, self.events.clone(), &proxy, ytdlp_dir).await
    }

    pub async fn shutdown(&mut self) {
        self.advancing = false;
        self.mark_load_done();
        self.advance_attempted = false;
        self.pending_advance = None;
        self.mpv.shutdown().await;
    }

    fn emit(&self, event: Value) {
        let _ = self.events.send(event);
    }

    pub fn emit_playback_state(&self) {
        let track = self.current_track.clone();
        let playing = self.is_playing();
        let loading = self.load_pending;
        // Never surface the previous track's position/duration while a load is
        // in flight; show a zeroed (or metadata-only) state instead.
        let (position, duration) = if loading {
            (0.0, track.as_ref().and_then(|t| t.duration).unwrap_or(0.0))
        } else {
            (self.mpv.state.time_pos, self.mpv.state.duration)
        };
        self.emit(json!({
            "type": "playback-state",
            "track": track,
            "playing": playing,
            "loading": loading,
            "position": position,
            "duration": duration,
            "volume": self.mpv.state.volume,
            "muted": self.mpv.state.muted,
            "shuffle": self.shuffle,
            "repeat": self.mpv.state.repeat_mode,
        }));
    }

    pub fn emit_queue_changed(&self) {
        let queue = self.queue.clone();
        let manual_count = self.queue.iter().filter(|q| q.source == QueueSource::Manual).count();
        let radio_count = self.queue.iter().filter(|q| q.source == QueueSource::Radio).count();
        self.emit(json!({
            "type": "queue-changed",
            "queue": queue,
            "manualCount": manual_count,
            "radioCount": radio_count,
        }));
    }

    pub fn emit_queue_refilled(&self) {
        let queue = self.queue.clone();
        let manual_count = self.queue.iter().filter(|q| q.source == QueueSource::Manual).count();
        let radio_count = self.queue.iter().filter(|q| q.source == QueueSource::Radio).count();
        self.emit(json!({
            "type": "queue-refilled",
            "queue": queue,
            "manualCount": manual_count,
            "radioCount": radio_count,
        }));
    }

    pub fn emit_track_changed(&self) {
        self.emit(json!({ "type": "track-changed", "track": self.current_track }));
    }

    fn is_playing(&self) -> bool {
        !self.mpv.state.paused && !self.load_pending && !self.mpv.state.idle_active
    }

    fn mark_load_started(&mut self) {
        self.load_pending = true;
        self.load_started = Some(Instant::now());
    }

    fn mark_load_done(&mut self) {
        self.load_pending = false;
        self.load_started = None;
    }

    async fn load_track(&mut self, url: &str) -> Result<(), String> {
        self.mark_load_started();
        let result = self.mpv.load(url).await;
        if let Err(e) = &result {
            self.mark_load_done();
            log::warn!("mpv failed to load a track: {e}");
        }
        result
    }

    async fn halt_and_load(&mut self, url: &str) -> Result<(), String> {
        self.advance_attempted = false;
        self.pending_advance = None;
        let _ = self.mpv.stop().await;
        self.load_track(url).await
    }

    pub async fn tick(&mut self) {
        let _ = self.mpv.poll_state().await;
        // Bounded load: if a load is not confirmed within the timeout, treat it
        // as failed so playback never spins in a loading state forever.
        if self.load_pending {
            if let Some(started) = self.load_started {
                if started.elapsed() >= load_timeout() {
                    log::warn!("mpv load timed out; marking playback stopped");
                    self.mark_load_done();
                    self.pending_advance = None;
                    // Clear the latch as well: otherwise one slow (but not
                    // dead) load would disable auto-advance permanently.
                    self.advance_attempted = false;
                }
            }
        }
        self.emit_playback_state();
    }

    pub async fn handle_event(&mut self, event: Value) -> RefillRequest {
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or_default();
        match event_type {
            "start-file" => {
                // A file began loading. Do not commit anything yet; the
                // `file-loaded` event is the confirmation that it succeeded.
                RefillRequest { generation: 0, from_id: String::new() }
            }
            "file-loaded" => {
                // The load succeeded: finalize any deferred auto-advance.
                self.mark_load_done();
                self.advance_attempted = false;
                // mpv is now actively playing, so reflect that immediately
                // instead of waiting for the next poll.
                self.mpv.state.idle_active = false;
                if let Some(pending) = self.pending_advance.take() {
                    return self.commit_advance(pending);
                }
                self.emit_playback_state();
                RefillRequest { generation: 0, from_id: String::new() }
            }
            "end-file" => {
                let reason = event.get("reason").and_then(Value::as_str).unwrap_or("unknown");
                // mpv is idle only once the file truly ended (or the load
                // failed). `stop` is immediately followed by a new load and
                // `redirect` keeps playing; for both, the poll and
                // property-change events keep the state correct.
                if reason == "eof" || reason == "error" {
                    self.mpv.state.idle_active = true;
                }
                if reason == "error" {
                    // A load we issued failed. Roll back any deferred advance
                    // and surface a stopped state instead of a stuck spinner.
                    self.mark_load_done();
                    if let Some(pending) = self.pending_advance.take() {
                        log::warn!("auto-next failed to load {}", pending.next.id);
                        // The failed track was never committed, so it is
                        // still in the queue. Drop it: keeping it would make
                        // manual Next (and a later EOF) reload the same
                        // broken track forever. The rest of the queue is
                        // intact; playing on is the user's call.
                        if self
                            .queue
                            .first()
                            .map(|q| q.track.id == pending.next.id)
                            .unwrap_or(false)
                        {
                            self.queue.remove(0);
                            self.emit_queue_changed();
                        }
                    }
                    self.emit_playback_state();
                    return RefillRequest { generation: 0, from_id: String::new() };
                }
                // Only a genuine end-of-file should auto-advance. `stop` comes
                // from manual track switches and `quit` from shutdown.
                // `advance_attempted` prevents a duplicate `end-file` from
                // re-running an advance whose load already failed.
                if reason == "eof" && !self.load_pending && !self.advancing && !self.advance_attempted {
                    self.on_end_of_file().await
                } else {
                    RefillRequest { generation: 0, from_id: String::new() }
                }
            }
            "property-change" => {
                // Keep `mpv.state` fresh between 500ms polls so seeks and
                // snapshots never reason about a stale position. Deliberately
                // no renderer emit here: the 2Hz playback-state broadcast
                // plus renderer-side interpolation is enough, and property
                // changes arrive far more often than that.
                let name = event.get("data").and_then(|d| d.get("name")).and_then(Value::as_str);
                let value = event
                    .get("data")
                    .and_then(|d| d.get("value"))
                    .cloned()
                    .unwrap_or(Value::Null);
                match name {
                    Some("time-pos") => {
                        if let Some(v) = value.as_f64() {
                            self.mpv.state.time_pos = v;
                        }
                    }
                    Some("duration") => {
                        if let Some(v) = value.as_f64() {
                            self.mpv.state.duration = v;
                        }
                    }
                    Some("pause") => {
                        if let Some(v) = value.as_bool() {
                            self.mpv.state.paused = v;
                        }
                    }
                    Some("mute") => {
                        if let Some(v) = value.as_bool() {
                            self.mpv.state.muted = v;
                        }
                    }
                    Some("volume") => {
                        if let Some(v) = value.as_f64() {
                            self.mpv.state.volume = v.round() as u64;
                        }
                    }
                    Some("idle-active") => {
                        if let Some(v) = value.as_bool() {
                            self.mpv.state.idle_active = v;
                        }
                    }
                    Some("media-title") => {
                        if let Some(v) = value.as_str() {
                            self.mpv.state.title = v.to_string();
                        }
                    }
                    _ => {}
                }
                RefillRequest { generation: 0, from_id: String::new() }
            }
            _ => RefillRequest { generation: 0, from_id: String::new() },
        }
    }

    /// Commit a deferred auto-advance now that mpv confirmed the load.
    fn commit_advance(&mut self, pending: PendingAdvance) -> RefillRequest {
        // The confirmed next track is still in the queue; remove it.
        if let Some(pos) = self.queue.iter().position(|q| q.track.id == pending.next.id) {
            self.queue.remove(pos);
        }
        self.emit_queue_changed();
        self.emit_playback_state();
        self.needs_refill()
            .then(|| RefillRequest {
                generation: self.mix_generation,
                from_id: pending.next.id.clone(),
            })
            .unwrap_or(RefillRequest { generation: 0, from_id: String::new() })
    }

    async fn on_end_of_file(&mut self) -> RefillRequest {
        if self.advancing {
            return RefillRequest { generation: 0, from_id: String::new() };
        }
        self.advancing = true;
        self.advance_attempted = true;
        let result = self.advance_after_eof().await;
        self.advancing = false;
        result
    }

    async fn advance_after_eof(&mut self) -> RefillRequest {
        let Some(current) = self.current_track.clone() else {
            return RefillRequest { generation: 0, from_id: String::new() };
        };
        if self.mpv.state.repeat_mode == RepeatMode::One {
            return RefillRequest { generation: 0, from_id: String::new() };
        }

        // Repeat-all with an exhausted queue: replay the session cycle. The
        // cycle is the deduplicated session history (each track once, oldest
        // to newest) plus the track that just ended; re-queueing it
        // newest-first makes the loop stable and endless, matching the
        // legacy player, which rebuilt the queue from its history snapshot
        // on every EOF.
        if self.queue.is_empty() && self.mpv.state.repeat_mode == RepeatMode::All {
            self.record_history(&current);
            if !self.history.is_empty() {
                let cycle = self
                    .history
                    .iter()
                    .rev()
                    .cloned()
                    .map(|track| QueueItem { track, source: QueueSource::Radio })
                    .collect::<Vec<_>>();
                self.queue = cycle;
                self.emit_queue_changed();
            }
        }

        if !self.queue.is_empty() {
            let next = self.queue[0].clone();
            let url = self.play_url(&next.track);
            // Issue the load but do NOT commit queue/history/current-track yet.
            // `loadfile` only acknowledges the command; `file-loaded` is the
            // confirmation that the next track actually started.
            if let Err(e) = self.load_track(&url).await {
                log::warn!("auto-next failed to issue load for {}: {e}", next.track.id);
                self.emit_playback_state();
                return RefillRequest { generation: 0, from_id: String::new() };
            }
            // Surface the next track as loading immediately; the finished track
            // belongs in history regardless of whether the next one succeeds.
            self.record_history(&current);
            self.current_track = Some(next.track.clone());
            self.emit_track_changed();
            self.pending_advance = Some(PendingAdvance {
                next: next.track,
            });
            return RefillRequest { generation: 0, from_id: String::new() };
        }

        // No next track: stop cleanly. mpv is already idle after EOF.
        self.emit_playback_state();
        RefillRequest { generation: 0, from_id: String::new() }
    }

    /// Record a track into the session history at most once (deduped by id,
    /// capped at `HISTORY_MAX`), like the legacy player's HistoryService.
    fn record_history(&mut self, track: &Track) {
        if track.id.is_empty() || self.history_seen.contains(&track.id) {
            return;
        }
        self.history_seen.insert(track.id.clone());
        self.history.push(track.clone());
        if self.history.len() > HISTORY_MAX {
            self.history.remove(0);
        }
        self.emit(json!({ "type": "history-changed", "history": self.history.clone() }));
    }

    fn needs_refill(&self) -> bool {
        self.queue.iter().all(|q| q.source != QueueSource::Manual)
            && self.queue.iter().filter(|q| q.source == QueueSource::Radio).count() < REFILL_THRESHOLD
    }

    fn play_url(&self, track: &Track) -> String {
        if config::is_downloaded(&self.downloads, &track.id) {
            let path = config::downloaded_path(&track.id);
            if path.is_file() {
                return path.to_string_lossy().to_string();
            }
        }
        track.url.clone()
    }

    fn shuffle_radio_only(&mut self) {
        let mut manual = Vec::new();
        let mut radio = Vec::new();
        for item in self.queue.drain(..) {
            if item.source == QueueSource::Manual {
                manual.push(item);
            } else {
                radio.push(item);
            }
        }
        radio.shuffle(&mut rand::thread_rng());
        self.queue = manual.into_iter().chain(radio.into_iter()).collect();
    }

    pub async fn search(&self, query: &str, limit: usize) -> anyhow::Result<Vec<Track>> {
        self.ytdlp.search(query, limit).await
    }

    pub async fn play(&mut self, track: Track) -> u64 {
        self.mix_generation += 1;
        let generation = self.mix_generation;
        if let Some(current) = self.current_track.clone() {
            if current.id != track.id {
                self.record_history(&current);
            }
        }
        self.queue.clear();
        self.current_track = Some(track.clone());
        let url = self.play_url(&track);
        if let Err(e) = self.halt_and_load(&url).await {
            log::warn!("play failed to load {}: {e}", track.id);
        }
        self.emit_track_changed();
        self.emit_queue_changed();
        // Give the renderer an immediate state; radio mix is filled by the command caller.
        self.emit_playback_state();
        generation
    }

    pub async fn play_from_playlist(&mut self, track: Track, remaining: Vec<Track>) -> u64 {
        self.mix_generation += 1;
        let generation = self.mix_generation;
        if let Some(current) = self.current_track.clone() {
            if current.id != track.id {
                self.record_history(&current);
            }
        }
        let mut queue = remaining
            .into_iter()
            .map(|t| QueueItem { track: t, source: QueueSource::Playlist })
            .collect::<Vec<_>>();
        if self.shuffle {
            queue.shuffle(&mut rand::thread_rng());
        }
        self.queue = queue;
        self.current_track = Some(track.clone());
        let url = self.play_url(&track);
        if let Err(e) = self.halt_and_load(&url).await {
            log::warn!("playlist load failed for {}: {e}", track.id);
        }
        self.emit_track_changed();
        self.emit_queue_changed();
        self.emit_playback_state();
        generation
    }

    pub async fn add_to_queue(&mut self, track: Track) {
        self.queue.push(QueueItem { track, source: QueueSource::Manual });
        self.emit_queue_changed();
    }

    pub async fn play_next_in_queue(&mut self, track: Track) {
        self.queue.insert(0, QueueItem { track, source: QueueSource::Manual });
        self.emit_queue_changed();
    }

    pub async fn play_from_queue(&mut self, index: usize) -> anyhow::Result<u64> {
        if index >= self.queue.len() {
            return Err(anyhow::anyhow!("That queue item is gone."));
        }
        let item = self.queue.remove(index);
        self.mix_generation += 1;
        let generation = self.mix_generation;
        if let Some(current) = self.current_track.clone() {
            if current.id != item.track.id {
                self.record_history(&current);
            }
        }
        self.current_track = Some(item.track.clone());
        let url = self.play_url(&item.track);
        if let Err(e) = self.halt_and_load(&url).await {
            log::warn!("queue load failed for {}: {e}", item.track.id);
        }
        self.emit_track_changed();
        self.emit_queue_changed();
        self.emit_playback_state();
        Ok(generation)
    }

    pub async fn remove_from_queue(&mut self, index: usize) -> bool {
        if index >= self.queue.len() {
            return false;
        }
        self.queue.remove(index);
        self.emit_queue_changed();
        true
    }

    pub async fn clear_queue(&mut self) {
        self.mix_generation += 1;
        self.fetching_mix = false;
        self.queue.clear();
        self.emit_queue_changed();
    }

    pub async fn move_queue_item(&mut self, from: usize, to: usize) -> bool {
        if from >= self.queue.len() || to >= self.queue.len() {
            return false;
        }
        let item = self.queue.remove(from);
        self.queue.insert(to, item);
        self.emit_queue_changed();
        true
    }

    pub async fn play_next_track(&mut self) -> anyhow::Result<RefillRequest> {
        // An auto-advance may already be loading a queued track (its load is
        // confirmed by a later `file-loaded`). If the user presses Next, they
        // mean the track *after* the current one — cancel the in-flight load
        // and drop its queue entry instead of reloading the same track.
        if let Some(pending) = self.pending_advance.take() {
            if let Some(pos) = self.queue.iter().position(|q| q.track.id == pending.next.id) {
                self.queue.remove(pos);
            }
            self.mark_load_done();
            self.emit_queue_changed();
        }
        if self.queue.is_empty() {
            return Err(anyhow::anyhow!("The queue is empty."));
        }
        if let Some(current) = self.current_track.clone() {
            self.record_history(&current);
        }
        let next = self.queue.remove(0);
        self.current_track = Some(next.track.clone());
        let url = self.play_url(&next.track);
        if let Err(e) = self.halt_and_load(&url).await {
            log::warn!("next load failed for {}: {e}", next.track.id);
        }
        self.emit_track_changed();
        self.emit_queue_changed();
        self.emit_playback_state();
        let refill = self.needs_refill().then(|| RefillRequest {
            generation: self.mix_generation,
            from_id: next.track.id.clone(),
        });
        Ok(refill.unwrap_or(RefillRequest { generation: 0, from_id: String::new() }))
    }

    pub async fn play_previous_track(&mut self) -> anyhow::Result<()> {
        let Some(previous) = self.history.pop() else {
            return Err(anyhow::anyhow!("There is no previous song."));
        };
        if let Some(current) = &self.current_track {
            self.queue.insert(0, QueueItem { track: current.clone(), source: QueueSource::Manual });
        }
        self.current_track = Some(previous.clone());
        let url = self.play_url(&previous);
        if let Err(e) = self.halt_and_load(&url).await {
            log::warn!("previous load failed for {}: {e}", previous.id);
        }
        self.emit_track_changed();
        self.emit_queue_changed();
        self.emit_playback_state();
        Ok(())
    }

    pub async fn toggle_pause(&mut self) -> bool {
        let _ = self.mpv.toggle_pause().await;
        self.mpv.state.paused
    }

    pub async fn set_paused(&mut self, paused: bool) {
        let _ = self.mpv.set_paused(paused).await;
        self.emit_playback_state();
    }

    pub async fn toggle_mute(&mut self) -> bool {
        let _ = self.mpv.toggle_mute().await;
        self.mpv.state.muted
    }

    pub async fn set_volume(&mut self, value: f64, relative: bool) -> u64 {
        let base = if relative { self.mpv.state.volume as f64 } else { 0.0 };
        let next = (base + value).clamp(0.0, 100.0).round() as u64;
        let _ = self.mpv.set_volume(next).await;
        self.emit(json!({
            "type": "volume-changed",
            "volume": next,
            "muted": self.mpv.state.muted,
        }));
        next
    }

    pub async fn seek(&mut self, seconds: f64) {
        let _ = self.mpv.seek(seconds).await;
        self.emit_playback_state();
    }

    pub async fn stop(&mut self) {
        self.mix_generation += 1;
        self.fetching_mix = false;
        self.advancing = false;
        self.mark_load_done();
        self.advance_attempted = false;
        self.pending_advance = None;
        self.queue.clear();
        self.history.clear();
        self.history_seen.clear();
        self.current_track = None;
        let _ = self.mpv.stop().await;
        self.emit_track_changed();
        self.emit_queue_changed();
        self.emit_playback_state();
    }

    pub fn clear_history(&mut self) {
        self.history.clear();
        self.history_seen.clear();
        self.emit(json!({ "type": "history-changed", "history": self.history }));
    }

    pub fn settings_snapshot(&self) -> AppSettings {
        self.settings.clone()
    }

    pub fn save_settings(&mut self, settings: AppSettings) {
        self.settings = settings.clone();
        config::save_settings(&settings);
        self.emit(json!({ "type": "settings-changed", "settings": settings }));
    }

    pub fn set_shuffle(&mut self, enabled: bool) {
        let changed = self.shuffle != enabled;
        self.shuffle = enabled;
        if changed && enabled {
            self.shuffle_radio_only();
            self.emit_queue_changed();
        }
        self.emit(json!({ "type": "shuffle-changed", "enabled": enabled }));
        self.emit_playback_state();
    }

    pub async fn set_repeat(&mut self, mode: RepeatMode) {
        let _ = self.mpv.set_repeat(mode).await;
        self.emit(json!({ "type": "repeat-changed", "mode": mode }));
        self.emit_playback_state();
    }

    pub fn toggle_favorite(&mut self, track: Track) -> bool {
        let added = config::toggle_favorite(&mut self.favorites, &track);
        self.emit(json!({ "type": "favorites-changed", "favorites": self.favorites }));
        added
    }

    pub fn apply_mix(&mut self, generation: u64, tracks: Vec<Track>) {
        if generation != self.mix_generation {
            return;
        }
        let known: HashSet<String> = self.queue.iter().map(|q| q.track.id.clone()).collect();
        let mut new_tracks: Vec<Track> = tracks
            .into_iter()
            .filter(|t| !known.contains(&t.id) && t.id != self.current_track.as_ref().map(|c| c.id.clone()).unwrap_or_default())
            .collect();
        new_tracks.truncate(22);
        if self.shuffle {
            new_tracks.shuffle(&mut rand::thread_rng());
        }
        self.queue = new_tracks
            .into_iter()
            .map(|t| QueueItem { track: t, source: QueueSource::Radio })
            .collect();
        self.fetching_mix = false;
        self.emit_queue_refilled();
    }

    pub fn apply_refill(&mut self, generation: u64, from_id: &str, tracks: Vec<Track>) {
        if generation != self.mix_generation {
            return;
        }
        let known: HashSet<String> = self.queue.iter().map(|q| q.track.id.clone()).collect();
        let mut new_tracks: Vec<Track> = tracks
            .into_iter()
            .filter(|t| t.id != from_id && !known.contains(&t.id))
            .collect();
        if self.shuffle {
            new_tracks.shuffle(&mut rand::thread_rng());
        }
        self.queue.extend(new_tracks.into_iter().map(|t| QueueItem { track: t, source: QueueSource::Radio }));
        self.fetching_mix = false;
        self.emit_queue_refilled();
    }

    pub fn snapshot(&self) -> Value {
        let loading = self.load_pending;
        let (time_pos, duration) = if loading {
            (0.0, self.current_track.as_ref().and_then(|t| t.duration).unwrap_or(0.0))
        } else {
            (self.mpv.state.time_pos, self.mpv.state.duration)
        };
        json!({
            "currentTrack": self.current_track,
            "queue": self.queue,
            "history": self.history,
            "favorites": self.favorites,
            "playlists": self.playlists,
            "downloads": self.downloads,
            "settings": self.settings,
            "volume": self.mpv.state.volume,
            "muted": self.mpv.state.muted,
            "paused": self.mpv.state.paused || self.load_pending,
            "loading": loading,
            "timePos": time_pos,
            "duration": duration,
            "shuffle": self.shuffle,
            "repeat": self.mpv.state.repeat_mode,
        })
    }

    pub fn queue_snapshot(&self) -> Value {
        json!(self.queue)
    }

    pub fn status_text(&self) -> String {
        let track = self.current_track.as_ref().map(|t| t.title.clone()).unwrap_or_else(|| "stopped".into());
        format!(
            "MELO | {track} | {} | {}% | queue {}",
            if self.mpv.state.paused { "paused" } else if self.is_playing() { "playing" } else { "stopped" },
            self.mpv.state.volume,
            self.queue.len(),
        )
    }

    // ─── Playlists ──────────────────────────────────────────────────────

    pub fn create_playlist(&mut self, name: &str) -> Playlist {
        let p = config::create_playlist(&mut self.playlists, name);
        self.emit(json!({ "type": "playlists-changed", "playlists": self.playlists }));
        p
    }

    pub fn delete_playlist(&mut self, id: &str) {
        config::delete_playlist(&mut self.playlists, id);
        self.emit(json!({ "type": "playlists-changed", "playlists": self.playlists }));
    }

    pub fn rename_playlist(&mut self, id: &str, name: &str) {
        config::rename_playlist(&mut self.playlists, id, name);
        self.emit(json!({ "type": "playlists-changed", "playlists": self.playlists }));
    }

    pub fn add_track_to_playlist(&mut self, playlist_id: &str, track: &Track) -> bool {
        let ok = config::add_track_to_playlist(&mut self.playlists, playlist_id, track);
        self.emit(json!({ "type": "playlists-changed", "playlists": self.playlists }));
        ok
    }

    pub fn remove_track_from_playlist(&mut self, playlist_id: &str, index: usize) {
        config::remove_track_from_playlist(&mut self.playlists, playlist_id, index);
        self.emit(json!({ "type": "playlists-changed", "playlists": self.playlists }));
    }

    pub fn reorder_playlist(&mut self, playlist_id: &str, from: usize, to: usize) -> bool {
        let Some(playlist) = self.playlists.iter_mut().find(|p| p.id == playlist_id) else {
            return false;
        };
        if from >= playlist.tracks.len() || to >= playlist.tracks.len() {
            return false;
        }
        let track = playlist.tracks.remove(from);
        playlist.tracks.insert(to, track);
        config::save_playlists(&self.playlists);
        self.emit(json!({ "type": "playlists-changed", "playlists": self.playlists }));
        true
    }

    pub fn playlist_by_id(&self, id: &str) -> Option<Playlist> {
        self.playlists.iter().find(|p| p.id == id).cloned()
    }

    pub fn save_queue_as_playlist(&mut self, name: &str) -> Option<Playlist> {
        if self.queue.is_empty() {
            return None;
        }
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        let playlist = Playlist {
            id: Utc::now().timestamp_millis().to_string(),
            name: name.to_string(),
            tracks: self.queue.iter().map(|item| item.track.clone()).collect(),
            created_at: Utc::now().to_rfc3339(),
        };
        self.playlists.push(playlist.clone());
        config::save_playlists(&self.playlists);
        self.emit(json!({ "type": "playlists-changed", "playlists": self.playlists }));
        Some(playlist)
    }

    pub fn playlist_snapshot(&self) -> Value {
        json!(self.playlists)
    }

    // ─── Download ───────────────────────────────────────────────────────

    pub async fn download(&mut self, track: Track) -> anyhow::Result<()> {
        if config::is_downloaded(&self.downloads, &track.id) {
            config::delete_download_record(&mut self.downloads, &track.id);
            let _ = std::fs::remove_file(config::downloaded_path(&track.id));
            self.emit(json!({ "type": "download-removed", "trackId": track.id }));
            return Ok(());
        }
        if self.downloading.contains(&track.id) {
            return Ok(());
        }
        self.downloading.insert(track.id.clone());
        self.emit(json!({ "type": "download-started", "trackId": track.id }));

        let path = config::music_dir().join(format!("{}.mp3", track.id));
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut cmd = if let Some(ytdlp) = &self.ytdlp.path {
            tokio::process::Command::new(ytdlp)
        } else {
            tokio::process::Command::new("yt-dlp")
        };
        cmd.args([
            "--ignore-config", "--no-cache-dir", "--no-cookies", "--no-cookies-from-browser",
            "-x", "--audio-format", "mp3", "-o",
        ]);
        cmd.arg(path.to_string_lossy().to_string());
        cmd.arg(&track.url);

        let output = cmd.output().await;
        self.downloading.remove(&track.id);
        match output {
            Ok(out) if out.status.success() => {
                config::add_download_record(&mut self.downloads, &track);
                self.emit(json!({ "type": "download-completed", "track": track }));
                Ok(())
            }
            Ok(out) => {
                self.emit(json!({ "type": "download-removed", "trackId": track.id }));
                Err(anyhow::anyhow!(String::from_utf8_lossy(&out.stderr).to_string()))
            }
            Err(e) => {
                self.emit(json!({ "type": "download-removed", "trackId": track.id }));
                Err(anyhow::anyhow!("download failed: {e}"))
            }
        }
    }
}

// ─── Regression tests (fake mpv over the IPC socket) ─────────────────────
//
// The fake mpv is a real Unix listener speaking mpv's JSON-lines IPC: it
// answers `request` calls and records every `loadfile`/`stop`. mpv *events*
// (file-loaded / end-file / property-change) are injected directly via
// `Engine::handle_event`, which is exactly how the lib.rs event loop
// delivers them.

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering as AOrd};
    use std::thread;
    use std::time::{Duration as StdDuration, Instant as StdInstant};

    static PIPE_COUNTER: AtomicU64 = AtomicU64::new(0);
    static TEST_ENV: std::sync::Once = std::sync::Once::new();

    struct EnvRestore;
    impl Drop for EnvRestore {
        fn drop(&mut self) {
            std::env::remove_var("MELO_LOAD_TIMEOUT_MS");
        }
    }

    fn track(id: &str) -> Track {
        Track {
            id: id.to_string(),
            title: format!("track {id}"),
            url: format!("https://example.com/{id}"),
            duration: Some(100.0),
            uploader: None,
            artwork: None,
            album: None,
        }
    }

    fn turl(id: &str) -> String {
        format!("https://example.com/{id}")
    }

    fn init_test_env() {
        TEST_ENV.call_once(|| {
            let dir = std::env::temp_dir().join(format!("melo-test-{}", std::process::id()));
            let _ = std::fs::create_dir_all(dir.join("config"));
            let _ = std::fs::create_dir_all(dir.join("home"));
            std::env::set_var("XDG_CONFIG_HOME", dir.join("config"));
            std::env::set_var("HOME", dir.join("home"));
            std::env::remove_var("MELO_LOAD_TIMEOUT_MS");
        });
    }

    // ── fake mpv ─────────────────────────────────────────────────────────

    struct FakeState {
        props: HashMap<String, Value>,
        /// loadfile commands as (request_id, url); request ids are monotonic
        /// on the client, so sorting by them restores issuance order even
        /// though connection handlers run on parallel threads.
        load_entries: Vec<(u64, String)>,
        stops: u32,
        /// When set, `loadfile` commands are accepted but never answered,
        /// emulating an mpv whose IPC reply is lost/delayed past the
        /// client's request timeout.
        loadfile_no_ack: bool,
    }

    struct FakeMpv {
        state: std::sync::Arc<std::sync::Mutex<FakeState>>,
        stop: std::sync::Arc<AtomicBool>,
    }

    impl FakeMpv {
        fn new(pipe: &str) -> Self {
            let _ = std::fs::remove_file(pipe);
            let listener = UnixListener::bind(pipe).expect("fake mpv: bind");
            let _ = listener.set_nonblocking(true);
            let state = std::sync::Arc::new(std::sync::Mutex::new(FakeState {
                props: HashMap::from([
                    ("pause".to_string(), Value::Bool(false)),
                    ("mute".to_string(), Value::Bool(false)),
                    ("time-pos".to_string(), Value::Null),
                    ("duration".to_string(), Value::Null),
                    ("volume".to_string(), json!(100)),
                    ("idle-active".to_string(), Value::Bool(true)),
                    ("media-title".to_string(), Value::Null),
                ]),
                load_entries: Vec::new(),
                stops: 0,
                loadfile_no_ack: false,
            }));
            let stop = std::sync::Arc::new(AtomicBool::new(false));
            let st2 = state.clone();
            let stop2 = stop.clone();
            thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    if stop2.load(AOrd::SeqCst) {
                        break;
                    }
                    let conn = match listener.accept() {
                        Ok((c, _)) => c,
                        Err(ref e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                || e.kind() == std::io::ErrorKind::Interrupted =>
                        {
                            thread::sleep(StdDuration::from_millis(5));
                            continue;
                        }
                        Err(_) => break,
                    };
                    let s3 = st2.clone();
                    let stop3 = stop2.clone();
                    thread::spawn(move || {
                        let mut conn = conn;
                        let mut carry = String::new();
                        loop {
                            if stop3.load(AOrd::SeqCst) {
                                return;
                            }
                            match conn.read(&mut buf) {
                                Ok(0) => return,
                                Ok(n) => {
                                    carry.push_str(&String::from_utf8_lossy(&buf[..n]));
                                }
                                Err(ref e)
                                    if e.kind() == std::io::ErrorKind::WouldBlock
                                        || e.kind() == std::io::ErrorKind::Interrupted =>
                                {
                                    thread::sleep(StdDuration::from_millis(5));
                                    continue;
                                }
                                Err(_) => return,
                            }
                            while let Some(pos) = carry.find('\n') {
                                let line = carry[..pos].to_string();
                                carry.drain(..=pos);
                                let line = line.trim();
                                if line.is_empty() {
                                    continue;
                                }
                                let Ok(msg) = serde_json::from_str::<Value>(line) else {
                                    continue;
                                };
                                let request_id = msg.get("request_id").and_then(Value::as_u64);
                                let command = msg
                                    .get("command")
                                    .and_then(Value::as_array)
                                    .cloned()
                                    .unwrap_or_default();
                                let Some(id) = request_id else { continue };
                                let mut reply: Option<Value> = None;
                                let mut no_ack = false;
                                {
                                    let mut st = s3.lock().unwrap();
                                    let cmd = command.first().and_then(Value::as_str);
                                    match cmd {
                                        Some("get_property") => {
                                            let name = command
                                                .get(1)
                                                .and_then(Value::as_str)
                                                .unwrap_or_default();
                                            let data = st.props.get(name).cloned().unwrap_or(Value::Null);
                                            reply = Some(json!({ "error": "success", "request_id": id, "data": data }));
                                        }
                                        Some("loadfile") => {
                                            let url = command
                                                .get(1)
                                                .and_then(Value::as_str)
                                                .unwrap_or_default()
                                                .to_string();
                                            st.load_entries.push((id, url));
                                            if !st.loadfile_no_ack {
                                                reply = Some(json!({ "error": "success", "request_id": id }));
                                            } else {
                                                no_ack = true;
                                            }
                                        }
                                        Some("stop") => {
                                            st.stops += 1;
                                            reply = Some(json!({ "error": "success", "request_id": id }));
                                        }
                                        Some("seek") => {
                                            reply = Some(json!({ "error": "success", "request_id": id }));
                                        }
                                        Some("cycle") => {
                                            let what = command
                                                .get(1)
                                                .and_then(Value::as_str)
                                                .unwrap_or_default();
                                            if let Some(v) = st.props.get_mut(what) {
                                                if let Some(b) = v.as_bool() {
                                                    *v = Value::Bool(!b);
                                                }
                                            }
                                            reply = Some(json!({ "error": "success", "request_id": id }));
                                        }
                                        Some("set_property") => {
                                            let name = command
                                                .get(1)
                                                .and_then(Value::as_str)
                                                .unwrap_or_default()
                                                .to_string();
                                            let value = command.get(2).cloned().unwrap_or(Value::Null);
                                            st.props.insert(name, value);
                                            reply = Some(json!({ "error": "success", "request_id": id }));
                                        }
                                        Some("quit") => {
                                            reply = Some(json!({ "error": "success", "request_id": id }));
                                            stop3.store(true, AOrd::SeqCst);
                                        }
                                        _ => {
                                            reply = Some(json!({ "error": "success", "request_id": id }));
                                        }
                                    }
                                }
                                // A no-ack loadfile: go silent for a moment, then
                                // drop the connection (emulates a lost reply).
                                if no_ack {
                                    thread::sleep(StdDuration::from_millis(2000));
                                    return;
                                }
                                if let Some(r) = reply {
                                    let mut text = r.to_string();
                                    text.push('\n');
                                    if conn.write_all(text.as_bytes()).is_err() {
                                        return;
                                    }
                                }
                            }
                        }
                    });
                }
            });
            FakeMpv { state, stop }
        }

        fn set_prop(&self, name: &str, value: Value) {
            self.state.lock().unwrap().props.insert(name.to_string(), value);
        }

        fn loads(&self) -> Vec<String> {
            let mut entries = self.state.lock().unwrap().load_entries.clone();
            entries.sort_by_key(|(id, _)| *id);
            entries.into_iter().map(|(_, url)| url).collect()
        }

        fn stops(&self) -> u32 {
            self.state.lock().unwrap().stops
        }

        fn no_ack_loadfile(&self, enabled: bool) {
            self.state.lock().unwrap().loadfile_no_ack = enabled;
        }
    }

    impl Drop for FakeMpv {
        fn drop(&mut self) {
            self.stop.store(true, AOrd::SeqCst);
        }
    }

    // ── harness ──────────────────────────────────────────────────────────

    fn make_engine() -> (Engine, FakeMpv, tokio::sync::mpsc::UnboundedReceiver<Value>) {
        init_test_env();
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let runtime = RuntimePaths {
            mpv: Some(PathBuf::from("/fake/mpv")),
            ytdlp: None,
            resource_dir: None,
        };
        let mut eng = Engine::new(&runtime, tx);
        let n = PIPE_COUNTER.fetch_add(1, AOrd::SeqCst);
        let pipe = std::env::temp_dir()
            .join(format!("melo-fake-{}-{n}.sock", std::process::id()))
            .to_string_lossy()
            .to_string();
        let _ = std::fs::remove_file(&pipe);
        eng.mpv.pipe = pipe.clone();
        let fake = FakeMpv::new(&pipe);
        (eng, fake, rx)
    }

    async fn file_loaded(eng: &mut Engine) {
        let _ = eng.handle_event(json!({ "type": "file-loaded" })).await;
    }

    async fn eof(eng: &mut Engine) {
        let _ = eng.handle_event(json!({ "type": "end-file", "reason": "eof" })).await;
    }

    async fn eof_error(eng: &mut Engine) {
        let _ = eng.handle_event(json!({ "type": "end-file", "reason": "error" })).await;
    }

    fn current_id(eng: &Engine) -> Option<String> {
        eng.current_track.as_ref().map(|t| t.id.clone())
    }

    /// Wait until the fake mpv has recorded at least `n` loadfile commands.
    /// `loadfile` is fire-and-forget on the engine side, so the test must
    /// synchronize on the fake's observation instead of assuming delivery.
    fn wait_loads(fake: &FakeMpv, n: usize) -> bool {
        let deadline = StdInstant::now() + StdDuration::from_millis(3000);
        loop {
            if fake.loads().len() >= n {
                return true;
            }
            if StdInstant::now() >= deadline {
                return false;
            }
            thread::sleep(StdDuration::from_millis(5));
        }
    }

    /// Give late (spurious) loadfile commands a moment to arrive before
    /// asserting that no further load happened.
    fn settle(fake: &FakeMpv) {
        thread::sleep(StdDuration::from_millis(50));
        let _ = fake;
    }

    fn drain_events(rx: &mut tokio::sync::mpsc::UnboundedReceiver<Value>) -> Vec<Value> {
        let mut out = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            out.push(ev);
        }
        out
    }

    fn emitted(events: &[Value], ty: &str) -> Vec<Value> {
        events
            .iter()
            .filter(|e| e.get("type").and_then(Value::as_str) == Some(ty))
            .cloned()
            .collect()
    }

    // ── 1. normal EOF advances exactly once ─────────────────────────────

    #[test]
    fn auto_next_advances_exactly_once() {
        tokio::block_on(async {
            let (mut eng, fake, mut rx) = make_engine();
            let a = track("a");
            eng.play(a.clone()).await;
            file_loaded(&mut eng).await;
            assert_eq!(current_id(&eng), Some("a".into()));
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");

            eng.add_to_queue(track("b")).await;
            eof(&mut eng).await;
            // advance issued: b is loading
            assert_eq!(current_id(&eng), Some("b".into()));
            assert!(eng.pending_advance.is_some());
            assert!(wait_loads(&fake, 2), "fake never saw the advance loadfile");

            // a duplicate end-file must NOT advance again
            eof(&mut eng).await;
            settle(&fake);
            assert_eq!(fake.loads(), vec![turl("a"), turl("b")]);

            // confirmation commits the advance
            file_loaded(&mut eng).await;
            assert!(eng.pending_advance.is_none());
            assert!(eng.queue.is_empty());
            assert_eq!(current_id(&eng), Some("b".into()));
            assert!(emitted(&drain_events(&mut rx), "track-changed").len() >= 1);

            // EOF of b with an empty queue: stops, no further load
            eof(&mut eng).await;
            assert_eq!(fake.loads(), vec![turl("a"), turl("b")]);
        });
    }

    // ── 2. a failed auto-next load drops the failed head, keeps the queue sane ─

    #[test]
    fn failed_auto_next_drops_failed_head() {
        tokio::block_on(async {
            let (mut eng, fake, _rx) = make_engine();
            eng.play(track("a")).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");
            eng.add_to_queue(track("b")).await;
            eng.add_to_queue(track("c")).await;

            eof(&mut eng).await;
            assert_eq!(current_id(&eng), Some("b".into()));
            assert!(wait_loads(&fake, 2), "fake never saw the advance loadfile");

            // mpv reports the b load failed
            eof_error(&mut eng).await;
            // the failed track must be gone from the queue head; c must survive
            let ids: Vec<&str> = eng.queue.iter().map(|q| q.track.id.as_str()).collect();
            assert_eq!(ids, vec!["c"]);
            assert!(eng.pending_advance.is_none());
            assert!(!eng.load_pending);
            // no automatic retry of c — the user decides (matches old app)
            settle(&fake);
            assert_eq!(fake.loads(), vec![turl("a"), turl("b")]);

            // manual Next now plays c (not a reload of b)
            eng.play_next_track().await.unwrap();
            assert_eq!(current_id(&eng), Some("c".into()));
            assert!(wait_loads(&fake, 3), "fake never saw the manual next loadfile");
            assert_eq!(fake.loads(), vec![turl("a"), turl("b"), turl("c")]);
            assert!(eng.queue.is_empty());
        });
    }

    // ── 3. a delayed/lost loadfile reply must not abort the advance ─────

    #[test]
    fn advance_survives_lost_loadfile_reply() {
        tokio::block_on(async {
            let (mut eng, fake, _rx) = make_engine();
            eng.play(track("a")).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");
            eng.add_to_queue(track("b")).await;

            // from now on, loadfile replies never arrive
            fake.no_ack_loadfile(true);

            let started = StdInstant::now();
            eof(&mut eng).await;
            let elapsed = started.elapsed();

            // the advance must not be aborted by a missing IPC reply
            assert_eq!(current_id(&eng), Some("b".into()));
            assert!(eng.pending_advance.is_some());
            assert!(wait_loads(&fake, 2), "fake never saw the advance loadfile");
            assert_eq!(fake.loads(), vec![turl("a"), turl("b")]);
            // ...and it must be fast (fire-and-forget, no request timeout)
            assert!(
                elapsed < StdDuration::from_secs(2),
                "advance took {elapsed:?}"
            );

            // mpv eventually confirms
            file_loaded(&mut eng).await;
            assert!(eng.pending_advance.is_none());
            assert!(eng.queue.is_empty());
        });
    }

    // ── 4. empty queue after EOF stops normally ─────────────────────────

    #[test]
    fn empty_queue_eof_stops() {
        tokio::block_on(async {
            let (mut eng, fake, _rx) = make_engine();
            eng.play(track("a")).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");

            eof(&mut eng).await;
            assert_eq!(current_id(&eng), Some("a".into()));
            settle(&fake);
            assert_eq!(fake.loads(), vec![turl("a")]);

            // repeated end-file (mpv can send more than one) still does nothing
            eof(&mut eng).await;
            eof(&mut eng).await;
            settle(&fake);
            assert_eq!(fake.loads(), vec![turl("a")]);
            assert!(!eng.load_pending);
            assert!(eng.pending_advance.is_none());
        });
    }

    // ── 5. repeat one never auto-advances ───────────────────────────────

    #[test]
    fn repeat_one_does_not_advance() {
        tokio::block_on(async {
            let (mut eng, fake, _rx) = make_engine();
            eng.set_repeat(RepeatMode::One).await;
            eng.play(track("a")).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");
            eng.add_to_queue(track("b")).await;

            eof(&mut eng).await;
            assert_eq!(current_id(&eng), Some("a".into()));
            settle(&fake);
            assert_eq!(fake.loads(), vec![turl("a")]);
            let ids: Vec<&str> = eng.queue.iter().map(|q| q.track.id.as_str()).collect();
            assert_eq!(ids, vec!["b"]);
        });
    }

    // ── 6. repeat all loops forever through the session tracks ──────────

    #[test]
    fn repeat_all_loops_forever() {
        tokio::block_on(async {
            let (mut eng, fake, _rx) = make_engine();
            eng.play(track("a")).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");
            eng.add_to_queue(track("b")).await;
            eng.add_to_queue(track("c")).await;
            eng.set_repeat(RepeatMode::All).await;

            // drive playback through several full cycles:
            // eof a -> b -> c, then repeat-all cycles: c -> b -> a -> c -> b -> a
            for _ in 0..8 {
                eof(&mut eng).await;
                file_loaded(&mut eng).await;
            }

            // initial a, then b c, then the stable c b a cycle forever
            let expected: Vec<String> = vec![
                "a", "b", "c", "c", "b", "a", "c", "b", "a",
            ]
            .into_iter()
            .map(turl)
            .collect();
            assert!(wait_loads(&fake, 9), "repeat-all cycle did not reach 9 loads");
            settle(&fake);
            assert_eq!(fake.loads(), expected);
            // every load was committed; the queue never grew unboundedly
            assert!(eng.queue.is_empty());
            assert_eq!(current_id(&eng), Some("a".into()));

            // and the cycle continues (not a one-shot)
            eof(&mut eng).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 10), "repeat-all stopped looping");
            settle(&fake);
            assert_eq!(fake.loads(), expected.iter().chain(std::iter::once(&turl("c"))).cloned().collect::<Vec<_>>());
        });
    }

    // ── 7. manual Next still works ──────────────────────────────────────

    #[test]
    fn manual_next_works() {
        tokio::block_on(async {
            let (mut eng, fake, mut rx) = make_engine();
            eng.play(track("a")).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");
            eng.add_to_queue(track("b")).await;
            eng.add_to_queue(track("c")).await;

            eng.play_next_track().await.unwrap();
            assert_eq!(current_id(&eng), Some("b".into()));
            assert!(wait_loads(&fake, 2), "fake never saw the manual next loadfile");
            assert_eq!(fake.loads(), vec![turl("a"), turl("b")]);
            assert!(fake.stops() >= 1);
            let ids: Vec<&str> = eng.queue.iter().map(|q| q.track.id.as_str()).collect();
            assert_eq!(ids, vec!["c"]);
            assert!(emitted(&drain_events(&mut rx), "track-changed").len() >= 1);

            // and Previous returns to a
            eng.play_previous_track().await.unwrap();
            assert_eq!(current_id(&eng), Some("a".into()));
            assert!(wait_loads(&fake, 3), "fake never saw the previous loadfile");
            assert_eq!(fake.loads(), vec![turl("a"), turl("b"), turl("a")]);
        });
    }

    // ── 8. manual Next while an auto-next load is in flight skips it ────

    #[test]
    fn manual_next_skips_pending_head() {
        tokio::block_on(async {
            let (mut eng, fake, _rx) = make_engine();
            eng.play(track("a")).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");
            eng.add_to_queue(track("b")).await;
            eng.add_to_queue(track("c")).await;

            // auto-advance starts loading b (not yet confirmed)
            eof(&mut eng).await;
            assert_eq!(current_id(&eng), Some("b".into()));
            assert!(eng.pending_advance.is_some());
            assert!(wait_loads(&fake, 2), "fake never saw the advance loadfile");

            // the user presses Next while b is still loading: c must play
            eng.play_next_track().await.unwrap();
            assert_eq!(current_id(&eng), Some("c".into()));
            assert!(wait_loads(&fake, 3), "fake never saw the manual next loadfile");
            assert_eq!(fake.loads(), vec![turl("a"), turl("b"), turl("c")]);
            assert!(eng.queue.is_empty());
            assert!(eng.pending_advance.is_none());

            // b's late confirmation must not corrupt anything
            file_loaded(&mut eng).await;
            assert_eq!(current_id(&eng), Some("c".into()));
            assert!(eng.queue.is_empty());
        });
    }

    // ── 9. track change resets position/duration (no stale leak) ────────

    #[test]
    fn track_change_resets_position() {
        tokio::block_on(async {
            let (mut eng, fake, _rx) = make_engine();
            eng.play(track("a")).await;
            file_loaded(&mut eng).await;

            fake.set_prop("time-pos", json!(42.0));
            fake.set_prop("duration", json!(99.0));
            eng.tick().await;
            assert_eq!(eng.mpv.state.time_pos, 42.0);
            assert_eq!(eng.mpv.state.duration, 99.0);

            // starting b must zero the in-flight position immediately
            eng.play(track("b")).await;
            assert_eq!(eng.mpv.state.time_pos, 0.0);
            assert_eq!(eng.mpv.state.duration, 0.0);
            assert_eq!(current_id(&eng), Some("b".into()));
        });
    }

    // ── 10. property-change events keep mpv state fresh ─────────────────

    #[test]
    fn property_change_updates_state() {
        tokio::block_on(async {
            let (mut eng, _fake, _rx) = make_engine();
            let ev = |name: &str, value: Value| {
                json!({ "type": "property-change", "data": { "name": name, "value": value } })
            };

            let _ = eng.handle_event(ev("time-pos", json!(12.5))).await;
            assert_eq!(eng.mpv.state.time_pos, 12.5);

            let _ = eng.handle_event(ev("duration", json!(300.0))).await;
            assert_eq!(eng.mpv.state.duration, 300.0);

            let _ = eng.handle_event(ev("pause", json!(true))).await;
            assert!(eng.mpv.state.paused);

            let _ = eng.handle_event(ev("mute", json!(true))).await;
            assert!(eng.mpv.state.muted);

            let _ = eng.handle_event(ev("volume", json!(63.0))).await;
            assert_eq!(eng.mpv.state.volume, 63);

            let _ = eng.handle_event(ev("idle-active", json!(false))).await;
            assert!(!eng.mpv.state.idle_active);

            let _ = eng.handle_event(ev("media-title", json!("Song Title"))).await;
            assert_eq!(eng.mpv.state.title, "Song Title");
        });
    }

    // ── 11. a load that never confirms clears the advance latch ─────────

    #[test]
    fn load_timeout_clears_advance_attempted() {
        tokio::block_on(async {
            let (mut eng, fake, _rx) = make_engine();
            // short load timeout so the test does not wait 45s
            std::env::set_var("MELO_LOAD_TIMEOUT_MS", "150");
            let _guard = EnvRestore;

            eng.play(track("a")).await;
            file_loaded(&mut eng).await;
            assert!(wait_loads(&fake, 1), "fake never saw the play loadfile");
            eng.add_to_queue(track("b")).await;

            // auto-advance starts loading b; mpv never confirms it
            eof(&mut eng).await;
            assert_eq!(current_id(&eng), Some("b".into()));
            assert!(eng.load_pending);
            assert!(eng.advance_attempted);
            assert!(wait_loads(&fake, 2), "fake never saw the advance loadfile");

            // let the load time out
            tokio::time::sleep(StdDuration::from_millis(250)).await;
            eng.tick().await;
            assert!(!eng.load_pending);
            assert!(eng.pending_advance.is_none());
            assert!(!eng.advance_attempted, "advance latch must be cleared by the load timeout");

            // a later EOF may retry the advance instead of latching forever
            eof(&mut eng).await;
            assert!(wait_loads(&fake, 3), "advance was still latched after the load timeout");
            settle(&fake);
            assert_eq!(fake.loads(), vec![turl("a"), turl("b"), turl("b")]);
        });
    }
}
