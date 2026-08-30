use chrono::Utc;
use dirs::home_dir;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::types::{AppSettings, Playlist, Track};

const APP_DIR: &str = "melo";

pub fn config_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(base) = std::env::var("APPDATA") {
            return Path::new(&base).join(APP_DIR);
        }
    }
    let base = dirs::config_dir().unwrap_or_else(|| home_dir().unwrap_or_else(|| Path::new(".").to_path_buf()));
    base.join(APP_DIR)
}

pub fn music_dir() -> PathBuf {
    let base = dirs::audio_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    base.join(APP_DIR)
}

fn ensure_dir(path: &Path) {
    if let Ok(()) = fs::create_dir_all(path) {}
}

fn read_json(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| Value::Array(vec![]))
}

fn write_json(path: &Path, value: &Value) {
    if let Some(parent) = path.parent() {
        ensure_dir(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(value) {
        let _ = fs::write(path, text);
    }
}

pub fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn favorites_path() -> PathBuf {
    config_dir().join("favorites.json")
}

pub fn playlists_path() -> PathBuf {
    config_dir().join("playlists.json")
}

pub fn downloads_path() -> PathBuf {
    config_dir().join("downloads.json")
}

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    read_json(&path)
        .as_object()
        .and_then(|obj| serde_json::from_value(Value::Object(obj.clone())).ok())
        .unwrap_or_default()
}

pub fn save_settings(settings: &AppSettings) {
    if let Ok(value) = serde_json::to_value(settings) {
        write_json(&settings_path(), &value);
    }
}

pub fn load_favorites() -> Vec<Track> {
    let path = favorites_path();
    read_json(&path)
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
        .unwrap_or_default()
}

pub fn save_favorites(favorites: &[Track]) {
    if let Ok(value) = serde_json::to_value(favorites) {
        write_json(&favorites_path(), &value);
    }
}

pub fn toggle_favorite(favorites: &mut Vec<Track>, track: &Track) -> bool {
    if let Some(pos) = favorites.iter().position(|t| t.id == track.id) {
        favorites.remove(pos);
        save_favorites(favorites);
        false
    } else {
        favorites.push(track.clone());
        save_favorites(favorites);
        true
    }
}

pub fn load_playlists() -> Vec<Playlist> {
    let path = playlists_path();
    read_json(&path)
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
        .unwrap_or_default()
}

pub fn save_playlists(playlists: &[Playlist]) {
    if let Ok(value) = serde_json::to_value(playlists) {
        write_json(&playlists_path(), &value);
    }
}

pub fn load_downloads() -> Vec<Track> {
    let path = downloads_path();
    read_json(&path)
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
        .unwrap_or_default()
}

pub fn save_downloads(downloads: &[Track]) {
    if let Ok(value) = serde_json::to_value(downloads) {
        write_json(&downloads_path(), &value);
    }
}

pub fn create_playlist(playlists: &mut Vec<Playlist>, name: &str) -> Playlist {
    let playlist = Playlist {
        id: Utc::now().timestamp_millis().to_string(),
        name: name.to_string(),
        tracks: vec![],
        created_at: Utc::now().to_rfc3339(),
    };
    playlists.push(playlist.clone());
    save_playlists(playlists);
    playlist
}

pub fn delete_playlist(playlists: &mut Vec<Playlist>, id: &str) {
    playlists.retain(|p| p.id != id);
    save_playlists(playlists);
}

pub fn rename_playlist(playlists: &mut Vec<Playlist>, id: &str, name: &str) {
    if let Some(p) = playlists.iter_mut().find(|p| p.id == id) {
        p.name = name.to_string();
        save_playlists(playlists);
    }
}

pub fn add_track_to_playlist(playlists: &mut Vec<Playlist>, playlist_id: &str, track: &Track) -> bool {
    if let Some(playlist) = playlists.iter_mut().find(|p| p.id == playlist_id) {
        if playlist.tracks.iter().any(|t| t.id == track.id) {
            return false;
        }
        playlist.tracks.push(track.clone());
        save_playlists(playlists);
        true
    } else {
        false
    }
}

pub fn remove_track_from_playlist(playlists: &mut Vec<Playlist>, playlist_id: &str, index: usize) {
    if let Some(playlist) = playlists.iter_mut().find(|p| p.id == playlist_id) {
        if index < playlist.tracks.len() {
            playlist.tracks.remove(index);
            save_playlists(playlists);
        }
    }
}

pub fn downloaded_path(track_id: &str) -> PathBuf {
    music_dir().join(format!("{track_id}.mp3"))
}

pub fn is_downloaded(downloads: &[Track], id: &str) -> bool {
    downloads.iter().any(|t| t.id == id)
}

pub fn add_download_record(downloads: &mut Vec<Track>, track: &Track) {
    if !is_downloaded(downloads, &track.id) {
        downloads.push(track.clone());
        save_downloads(downloads);
    }
}

pub fn delete_download_record(downloads: &mut Vec<Track>, track_id: &str) {
    downloads.retain(|t| t.id != track_id);
    save_downloads(downloads);
}
