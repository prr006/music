use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::engine::RefillRequest;
use crate::AppState;
use crate::types::{AppSettings, ControlResponse, RepeatMode, Track};
use crate::ytdlp::YtDlp;

fn str_field(command: &Value, key: &str) -> Option<String> {
    command.get(key).and_then(Value::as_str).map(str::to_string)
}

fn track_from(command: &Value, key: &str) -> Result<Track, ControlResponse> {
    let value = command.get(key).ok_or_else(|| ControlResponse::err("Missing track."))?;
    serde_json::from_value(value.clone()).map_err(|e| ControlResponse::err(format!("Invalid track: {e}")))
}

fn repeat_from(value: Option<&Value>) -> Result<RepeatMode, ControlResponse> {
    match value.and_then(Value::as_str) {
        Some("one") => Ok(RepeatMode::One),
        Some("all") => Ok(RepeatMode::All),
        Some("off") | None => Ok(RepeatMode::Off),
        Some(other) => Err(ControlResponse::err(format!("Unsupported repeat mode: {other}"))),
    }
}

fn settings_from(value: Option<&Value>) -> Result<AppSettings, ControlResponse> {
    let value = value.ok_or_else(|| ControlResponse::err("Missing settings."))?;
    serde_json::from_value(value.clone()).map_err(|e| ControlResponse::err(format!("Invalid settings: {e}")))
}

fn uint(command: &Value, key: &str) -> usize {
    command.get(key).and_then(Value::as_u64).unwrap_or(u64::MAX) as usize
}

fn f64(command: &Value, key: &str) -> f64 {
    command.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

async fn refill_engine(state: &AppState, request: RefillRequest) {
    if request.generation == 0 || request.from_id.is_empty() {
        return;
    }
    let from_id = request.from_id.clone();
    let path = {
        let engine = state.engine.lock().await;
        engine.ytdlp.path.clone()
    };
    let yt = YtDlp::new(path);
    if let Ok(tracks) = yt.fetch_mix(&from_id, 25).await {
        let mut engine = state.engine.lock().await;
        engine.apply_refill(request.generation, &from_id, tracks);
    }
}

async fn play_track_and_refill(state: &AppState, track: Track) -> u64 {
    let (generation, id) = {
        let mut engine = state.engine.lock().await;
        let generation = engine.play(track).await;
        let id = engine.current_track.as_ref().map(|t| t.id.clone()).unwrap_or_default();
        (generation, id)
    };
    if !id.is_empty() {
        let request = RefillRequest { generation, from_id: id };
        let cloned = (*state).clone();
        tauri::async_runtime::spawn(async move {
            refill_engine(&cloned, request).await;
        });
    }
    generation
}

async fn backend_send_impl(
    app: AppHandle,
    state: &AppState,
    command: Value,
) -> ControlResponse {
    let cmd_type = str_field(&command, "type").unwrap_or_default();
    match cmd_type.as_str() {
        "play" => {
            let query = str_field(&command, "query").unwrap_or_default();
            let tracks = {
                let engine = state.engine.lock().await;
                engine.search(&query, 1).await
            };
            let track = match tracks {
                Ok(mut list) if !list.is_empty() => list.remove(0),
                _ => return ControlResponse::err("No results found."),
            };
            play_track_and_refill(state, track).await;
            ControlResponse::ok("Playing.")
        }
        "play-track" => {
            let track = match track_from(&command, "track") {
                Ok(t) => t,
                Err(e) => return e,
            };
            play_track_and_refill(state, track).await;
            ControlResponse::ok("Playing.")
        }
        "mute" => {
            let muted = { state.engine.lock().await.toggle_mute().await };
            ControlResponse::ok(if muted { "Muted." } else { "Unmuted." })
        }
        "next" => {
            let request = {
                let mut engine = state.engine.lock().await;
                match engine.play_next_track().await {
                    Ok(r) => r,
                    Err(e) => return ControlResponse::err(e.to_string()),
                }
            };
            let state2 = state.clone();
            tauri::async_runtime::spawn(async move {
                refill_engine(&state2, request).await;
            });
            ControlResponse::ok("Next.")
        }
        "previous" => {
            match { state.engine.lock().await.play_previous_track().await } {
                Ok(()) => ControlResponse::ok("Previous."),
                Err(e) => ControlResponse::err(e.to_string()),
            }
        }
        "pause" => {
            state.engine.lock().await.set_paused(true).await;
            ControlResponse::ok("Paused.")
        }
        "resume" => {
            state.engine.lock().await.set_paused(false).await;
            ControlResponse::ok("Resumed.")
        }
        "toggle" => {
            let paused = { state.engine.lock().await.toggle_pause().await };
            ControlResponse::ok(if paused { "Paused." } else { "Resumed." })
        }
        "volume" => {
            let value = f64(&command, "value");
            let relative = command.get("relative").and_then(Value::as_bool).unwrap_or(false);
            let volume = { state.engine.lock().await.set_volume(value, relative).await };
            ControlResponse::ok(format!("Volume: {volume}%"))
        }
        "seek" => {
            let seconds = f64(&command, "seconds");
            state.engine.lock().await.seek(seconds).await;
            ControlResponse::ok("Seeked.")
        }
        "now" => {
            let engine = state.engine.lock().await;
            let track = engine.current_track.clone();
            match track {
                Some(track) => {
                    let time = engine.mpv.state.time_pos;
                    let duration = engine.mpv.state.duration;
                    ControlResponse::ok(format!(
                        "{} — {}\n{:.0}:{:.0} / {:.0}:{:.0}\n{}",
                        track.title,
                        track.uploader.unwrap_or_default(),
                        time / 60.0,
                        time % 60.0,
                        duration / 60.0,
                        duration % 60.0,
                        track.url
                    ))
                }
                None => ControlResponse::err("Nothing is playing."),
            }
        }
        "status" => {
            let engine = state.engine.lock().await;
            ControlResponse::ok(engine.status_text())
        }
        "shuffle" => {
            let enabled = command.get("enabled").and_then(Value::as_bool);
            {
                let mut engine = state.engine.lock().await;
                let next = enabled.unwrap_or_else(|| !engine.shuffle);
                engine.set_shuffle(next);
            }
            ControlResponse::ok("Shuffle updated.")
        }
        "repeat" => {
            let mode = match repeat_from(command.get("mode")) {
                Ok(m) => m,
                Err(e) => return e,
            };
            state.engine.lock().await.set_repeat(mode).await;
            ControlResponse::ok("Repeat updated.")
        }
        "favorite" => {
            let track = {
                let engine = state.engine.lock().await;
                match command.get("track").cloned().map(|v| serde_json::from_value::<Track>(v)) {
                    Some(Ok(track)) => track,
                    _ => engine.current_track.clone().unwrap_or_else(|| Track {
                        id: String::new(),
                        title: String::new(),
                        url: String::new(),
                        duration: None,
                        uploader: None,
                        artwork: None,
                        album: None,
                    }),
                }
            };
            if track.id.is_empty() {
                return ControlResponse::err("Nothing is playing.");
            }
            let mut engine = state.engine.lock().await;
            let added = engine.toggle_favorite(track);
            ControlResponse::ok(if added { "Added to favorites." } else { "Removed from favorites." })
        }
        "download" => {
            let track = {
                let engine = state.engine.lock().await;
                engine.current_track.clone()
            };
            let Some(track) = track else {
                return ControlResponse::err("Nothing is playing.");
            };
            match { state.engine.lock().await.download(track).await } {
                Ok(()) => ControlResponse::ok("Download complete."),
                Err(e) => ControlResponse::err(e.to_string()),
            }
        }
        "queue" => {
            let clear = command.get("clear").and_then(Value::as_bool).unwrap_or(false);
            let mut engine = state.engine.lock().await;
            if clear {
                engine.clear_queue().await;
                return ControlResponse::ok("Queue cleared.");
            }
            ControlResponse::data("Queue.", engine.queue_snapshot())
        }
        "stop" => {
            state.engine.lock().await.stop().await;
            ControlResponse::ok("Playback stopped.")
        }
        "quit" => {
            let cloned = state.clone();
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut engine = cloned.engine.lock().await;
                engine.shutdown().await;
                drop(engine);
                app_handle.exit(0);
            });
            ControlResponse::ok("Closing.")
        }
        "add-to-queue" => {
            let track = match track_from(&command, "track") {
                Ok(t) => t,
                Err(e) => return e,
            };
            state.engine.lock().await.add_to_queue(track).await;
            ControlResponse::ok("Added to queue.")
        }
        "play-next" => {
            let track = match track_from(&command, "track") {
                Ok(t) => t,
                Err(e) => return e,
            };
            state.engine.lock().await.play_next_in_queue(track).await;
            ControlResponse::ok("Will play next.")
        }
        "remove-from-queue" => {
            let index = uint(&command, "index");
            state.engine.lock().await.remove_from_queue(index).await;
            ControlResponse::ok("Removed from queue.")
        }
        "move-queue" | "queue-move" => {
            let from = uint(&command, "from");
            let to = uint(&command, "to");
            let ok = state.engine.lock().await.move_queue_item(from, to).await;
            ControlResponse::ok(if ok { "Queue updated." } else { "Could not move queue item." })
        }
        "play-from-queue" => {
            let index = uint(&command, "index");
            match { state.engine.lock().await.play_from_queue(index).await } {
                Ok(_) => ControlResponse::ok("Playing."),
                Err(e) => ControlResponse::err(e.to_string()),
            }
        }
        "get-queue" => {
            let engine = state.engine.lock().await;
            ControlResponse::data("Queue.", engine.queue_snapshot())
        }
        "get-state" => {
            let engine = state.engine.lock().await;
            ControlResponse::data("State.", engine.snapshot())
        }
        "subscribe" => ControlResponse::ok("Subscribed."),
        "search" => {
            let query = str_field(&command, "query").unwrap_or_default();
            let limit = command.get("limit").and_then(Value::as_u64).unwrap_or(8) as usize;
            let result = { state.engine.lock().await.search(&query, limit).await };
            match result {
                Ok(tracks) => ControlResponse::data("Search results.", json!(tracks)),
                Err(e) => ControlResponse::err(e.to_string()),
            }
        }
        "get-playlists" => {
            let engine = state.engine.lock().await;
            ControlResponse::data(format!("{} playlists.", engine.playlists.len()), engine.playlist_snapshot())
        }
        "create-playlist" => {
            let name = str_field(&command, "name").unwrap_or_else(|| "New Playlist".into());
            let playlist = { state.engine.lock().await.create_playlist(&name) };
            ControlResponse::data("Playlist created.", json!(playlist))
        }
        "delete-playlist" => {
            let id = str_field(&command, "id").unwrap_or_default();
            state.engine.lock().await.delete_playlist(&id);
            ControlResponse::ok("Playlist deleted.")
        }
        "rename-playlist" => {
            let id = str_field(&command, "id").unwrap_or_default();
            let name = str_field(&command, "name").unwrap_or_default();
            state.engine.lock().await.rename_playlist(&id, &name);
            ControlResponse::ok("Playlist renamed.")
        }
        "add-to-playlist" => {
            let id = str_field(&command, "id").unwrap_or_default();
            let track = match track_from(&command, "track") {
                Ok(t) => t,
                Err(e) => return e,
            };
            let ok = state.engine.lock().await.add_track_to_playlist(&id, &track);
            ControlResponse::ok(if ok { "Added to playlist." } else { "Already in playlist or missing playlist." })
        }
        "remove-from-playlist" => {
            let id = str_field(&command, "id").unwrap_or_default();
            let index = uint(&command, "index");
            state.engine.lock().await.remove_track_from_playlist(&id, index);
            ControlResponse::ok("Removed from playlist.")
        }
        "reorder-playlist" => {
            let id = str_field(&command, "id").unwrap_or_default();
            let from = uint(&command, "from");
            let to = uint(&command, "to");
            let ok = state.engine.lock().await.reorder_playlist(&id, from, to);
            ControlResponse::ok(if ok { "Playlist updated." } else { "Could not reorder playlist." })
        }
        "play-playlist" => {
            let id = str_field(&command, "id").unwrap_or_default();
            let index = uint(&command, "index");
            let playlist = {
                let engine = state.engine.lock().await;
                engine.playlist_by_id(&id)
            };
            let Some(playlist) = playlist else {
                return ControlResponse::err("Playlist not found.");
            };
            let Some(track) = playlist.tracks.get(index).cloned() else {
                return ControlResponse::err("Playlist is empty.");
            };
            let remaining = playlist.tracks.iter().skip(index + 1).cloned().collect::<Vec<_>>();
            let _ = { state.engine.lock().await.play_from_playlist(track, remaining).await };
            ControlResponse::ok("Playing playlist.")
        }
        "save-queue-as-playlist" => {
            let name = str_field(&command, "name").unwrap_or_default();
            match { state.engine.lock().await.save_queue_as_playlist(&name) } {
                Some(playlist) => ControlResponse::data("Saved playlist.", json!(playlist)),
                None => ControlResponse::err("Queue is empty."),
            }
        }
        "clear-history" => {
            state.engine.lock().await.clear_history();
            ControlResponse::ok("History cleared.")
        }
        "get-settings" => {
            let engine = state.engine.lock().await;
            ControlResponse::data("Settings.", json!(engine.settings_snapshot()))
        }
        "save-settings" => {
            let settings = match settings_from(command.get("settings")) {
                Ok(s) => s,
                Err(e) => return e,
            };
            state.engine.lock().await.save_settings(settings);
            ControlResponse::ok("Settings saved.")
        }
        "get-lyrics" => {
            let engine = state.engine.lock().await;
            let track = match command.get("track").cloned().and_then(|v| serde_json::from_value::<Track>(v).ok()) {
                Some(track) => track,
                None => match engine.current_track.clone() {
                    Some(track) => track,
                    None => return ControlResponse::data("No lyrics.", json!({ "trackId": "", "lines": [], "source": null })),
                },
            };
            let lyrics = engine.lyrics_for(&track);
            ControlResponse::data("Lyrics.", json!(lyrics))
        }
        // Backwards compatibility with the earlier lightweight command names.
        "playlist-create" => {
            let name = str_field(&command, "name").unwrap_or_else(|| "New Playlist".into());
            let playlist = { state.engine.lock().await.create_playlist(&name) };
            ControlResponse::data("Playlist created.", json!(playlist))
        }
        "playlist-delete" => {
            let id = str_field(&command, "id").unwrap_or_default();
            state.engine.lock().await.delete_playlist(&id);
            ControlResponse::ok("Playlist deleted.")
        }
        "playlist-rename" => {
            let id = str_field(&command, "id").unwrap_or_default();
            let name = str_field(&command, "name").unwrap_or_default();
            state.engine.lock().await.rename_playlist(&id, &name);
            ControlResponse::ok("Playlist renamed.")
        }
        "playlist-add-track" => {
            let id = str_field(&command, "playlistId").unwrap_or_default();
            let track = match track_from(&command, "track") {
                Ok(t) => t,
                Err(e) => return e,
            };
            let ok = state.engine.lock().await.add_track_to_playlist(&id, &track);
            ControlResponse::ok(if ok { "Added to playlist." } else { "Track already in playlist." })
        }
        "playlist-remove-track" => {
            let id = str_field(&command, "playlistId").unwrap_or_default();
            let index = uint(&command, "index");
            state.engine.lock().await.remove_track_from_playlist(&id, index);
            ControlResponse::ok("Removed from playlist.")
        }
        "playlist-apply" => {
            let track = match track_from(&command, "track") {
                Ok(t) => t,
                Err(e) => return e,
            };
            let remaining = command
                .get("tracks")
                .and_then(Value::as_array)
                .map(|arr| arr.iter().filter_map(|v| serde_json::from_value::<Track>(v.clone()).ok()).collect::<Vec<_>>())
                .unwrap_or_default();
            let _ = { state.engine.lock().await.play_from_playlist(track, remaining).await };
            ControlResponse::ok("Playing playlist.")
        }
        _ => ControlResponse::err(format!("Unsupported control command: {cmd_type}")),
    }
}

#[tauri::command]
pub async fn backend_send(
    app: AppHandle,
    state: State<'_, AppState>,
    command: Value,
) -> Result<ControlResponse, String> {
    Ok(backend_send_impl(app, state.inner(), command).await)
}

#[tauri::command]
pub async fn backend_is_connected(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(*state.connection.lock().await == crate::types::ConnectionState::Connected)
}

#[tauri::command]
pub async fn backend_get_connection_state(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.connection.lock().await.as_str().to_string())
}

#[tauri::command]
pub async fn backend_retry(state: State<'_, AppState>) -> Result<(), String> {
    *state.connection.lock().await = crate::types::ConnectionState::Connecting;
    Ok(())
}
