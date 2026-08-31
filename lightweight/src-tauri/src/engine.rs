use std::collections::HashSet;
use std::sync::Arc;

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

#[derive(Debug, Clone)]
pub struct RefillRequest {
    pub generation: u64,
    pub from_id: String,
}

pub struct Engine {
    pub mpv: Mpv,
    pub ytdlp: YtDlp,
    pub(crate) lyrics: Arc<LyricsProvider>,
    pub events: UnboundedSender<Value>,
    pub current_track: Option<Track>,
    pub queue: Vec<QueueItem>,
    pub history: Vec<Track>,
    pub favorites: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub downloads: Vec<Track>,
    pub settings: AppSettings,
    pub shuffle: bool,
    pub fetching_mix: bool,
    pub mix_generation: u64,
    pub downloading: HashSet<String>,
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
            favorites: config::load_favorites(),
            playlists: config::load_playlists(),
            downloads: config::load_downloads(),
            settings: config::load_settings(),
            shuffle: false,
            fetching_mix: false,
            mix_generation: 0,
            downloading: HashSet::new(),
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
        self.mpv.shutdown().await;
    }

    fn emit(&self, event: Value) {
        let _ = self.events.send(event);
    }

    pub fn emit_playback_state(&self) {
        let track = self.current_track.clone();
        let playing = !self.mpv.state.paused;
        self.emit(json!({
            "type": "playback-state",
            "track": track,
            "playing": playing,
            "position": self.mpv.state.time_pos,
            "duration": self.mpv.state.duration,
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

    pub async fn tick(&mut self) {
        let _ = self.mpv.poll_state().await;
        self.emit_playback_state();
    }

    pub async fn handle_event(&mut self, event: Value) -> RefillRequest {
        if event.get("type").and_then(Value::as_str) == Some("end-file") {
            let reason = event.get("reason").and_then(Value::as_str).unwrap_or("unknown");
            if reason == "eof" || reason == "quit" {
                return self.on_end_of_file().await;
            }
        }
        RefillRequest { generation: 0, from_id: String::new() }
    }

    async fn on_end_of_file(&mut self) -> RefillRequest {
        let Some(current) = self.current_track.clone() else {
            return RefillRequest { generation: 0, from_id: String::new() };
        };
        if self.mpv.state.repeat_mode == RepeatMode::One {
            return RefillRequest { generation: 0, from_id: String::new() };
        }

        if !self.queue.is_empty() {
            self.history.push(current);
            let next = self.queue.remove(0);
            self.current_track = Some(next.track.clone());
            let url = self.play_url(&next.track);
            let _ = self.mpv.load(&url).await;
            self.emit_track_changed();
            self.emit_queue_changed();
            let refill = self.needs_refill().then(|| RefillRequest {
                generation: self.mix_generation,
                from_id: next.track.id.clone(),
            });
            return refill.unwrap_or(RefillRequest { generation: 0, from_id: String::new() });
        }

        if self.mpv.state.repeat_mode == RepeatMode::All && !self.history.is_empty() {
            self.queue = self
                .history
                .iter()
                .cloned()
                .map(|track| QueueItem { track, source: QueueSource::Radio })
                .collect();
            self.history.clear();
            if self.shuffle {
                self.shuffle_radio_only();
            }
            let next = self.queue.remove(0);
            self.current_track = Some(next.track.clone());
            let url = self.play_url(&next.track);
            let _ = self.mpv.load(&url).await;
            self.emit_track_changed();
            self.emit_queue_changed();
        }

        RefillRequest { generation: 0, from_id: String::new() }
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
        if let Some(current) = &self.current_track {
            if current.id != track.id {
                self.history.push(current.clone());
            }
        }
        self.queue.clear();
        self.current_track = Some(track.clone());
        let url = self.play_url(&track);
        let _ = self.mpv.load(&url).await;
        self.emit_track_changed();
        self.emit_queue_changed();
        // Give the renderer an immediate state; radio mix is filled by the command caller.
        self.emit_playback_state();
        generation
    }

    pub async fn play_from_playlist(&mut self, track: Track, remaining: Vec<Track>) -> u64 {
        self.mix_generation += 1;
        let generation = self.mix_generation;
        if let Some(current) = &self.current_track {
            if current.id != track.id {
                self.history.push(current.clone());
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
        let _ = self.mpv.load(&url).await;
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
        if let Some(current) = &self.current_track {
            if current.id != item.track.id {
                self.history.push(current.clone());
            }
        }
        self.current_track = Some(item.track.clone());
        let url = self.play_url(&item.track);
        self.mpv.load(&url).await.map_err(|e| anyhow::anyhow!(e))?;
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
        if self.queue.is_empty() {
            return Err(anyhow::anyhow!("The queue is empty."));
        }
        if let Some(current) = &self.current_track {
            self.history.push(current.clone());
        }
        let next = self.queue.remove(0);
        self.current_track = Some(next.track.clone());
        let url = self.play_url(&next.track);
        self.mpv.load(&url).await.map_err(|e| anyhow::anyhow!(e))?;
        self.emit_track_changed();
        self.emit_queue_changed();
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
        self.mpv.load(&url).await.map_err(|e| anyhow::anyhow!(e))?;
        self.emit_track_changed();
        self.emit_queue_changed();
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
        self.queue.clear();
        self.history.clear();
        self.current_track = None;
        let _ = self.mpv.stop().await;
        self.emit_track_changed();
        self.emit_queue_changed();
        self.emit_playback_state();
    }

    pub fn clear_history(&mut self) {
        self.history.clear();
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
            "paused": self.mpv.state.paused,
            "timePos": self.mpv.state.time_pos,
            "duration": self.mpv.state.duration,
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
            if self.mpv.state.paused { "paused" } else { "playing" },
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
