use std::collections::HashMap;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::types::{LyricsLine, LyricsResult, Track};

const USER_AGENT: &str = "MELO/0.1.0 (https://github.com/prr006/music)";

/// Lightweight Rust lyrics provider backed by LRCLIB's public API.
///
/// Behavior:
///  1. query `/api/get` with the current track's artist/title, plus album
///     and duration when available
///  2. prefer `syncedLyrics` (LRC timestamps)
///  3. fall back to `plainLyrics`
///  4. return the existing empty `LyricsResult` on missing or failed lookups
pub struct LyricsProvider {
    cache: Mutex<HashMap<String, LyricsResult>>,
}

impl LyricsProvider {
    pub fn new() -> Self {
        LyricsProvider {
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub async fn lyrics_for(&self, track: &Track) -> LyricsResult {
        if let Some(cached) = self.cache.lock().await.get(&track.id).cloned() {
            return cached;
        }

        let empty = LyricsResult {
            track_id: track.id.clone(),
            lines: Vec::new(),
            source: None,
        };

        let result = match self.fetch_and_parse(track).await {
            Ok(Some(lines)) => LyricsResult {
                track_id: track.id.clone(),
                lines,
                source: Some("lrclib".to_string()),
            },
            Ok(_) => empty.clone(),
            Err(e) => {
                log::warn!("lrclib lookup failed for {}: {e}", track.id);
                empty.clone()
            }
        };

        self.cache.lock().await.insert(track.id.clone(), result.clone());
        result
    }

    async fn fetch_and_parse(&self, track: &Track) -> anyhow::Result<Option<Vec<LyricsLine>>> {
        let Some(url) = lyrics_url(track) else {
            return Ok(None);
        };
        let url = url.clone();
        let body = match tokio::task::spawn_blocking(move || fetch_json(&url)).await {
            Ok(Ok(Some(body))) => body,
            Ok(Ok(None)) => return Ok(None),
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(anyhow::anyhow!("lrclib fetch aborted: {e}")),
        };
        Ok(parse_response(&body))
    }
}

fn lyrics_url(track: &Track) -> Option<String> {
    let artist = track.uploader.as_deref().unwrap_or_default().trim();
    let title = track.title.trim();
    if artist.is_empty() || title.is_empty() {
        return None;
    }

    let mut query = format!(
        "track_name={}&artist_name={}",
        percent_encode(title),
        percent_encode(artist)
    );
    if let Some(album) = track.album.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        query.push_str(&format!("&album_name={}", percent_encode(album)));
    }
    if let Some(duration) = track.duration {
        if duration.is_finite() && duration >= 1.0 && duration <= 3600.0 {
            query.push_str(&format!("&duration={}", duration.round() as u64));
        }
    }
    Some(format!("https://lrclib.net/api/get?{query}"))
}

fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn fetch_json(url: &str) -> anyhow::Result<Option<Value>> {
    let response = match ureq::get(url).set("User-Agent", USER_AGENT).call() {
        Ok(response) => response,
        Err(e) => {
            log::debug!("lrclib request failed: {e}");
            return Ok(None);
        }
    };
    let status = response.status();
    if status == 404 {
        return Ok(None);
    }
    if !(200..300).contains(&status) {
        return Err(anyhow::anyhow!("lrclib returned {status}"));
    }
    let body = response
        .into_string()
        .map_err(|e| anyhow::anyhow!("lrclib response body invalid: {e}"))?;
    Ok(Some(serde_json::from_str(&body)?))
}

fn parse_response(dump: &Value) -> Option<Vec<LyricsLine>> {
    if let Some(synced) = dump.get("syncedLyrics").and_then(Value::as_str) {
        let lines = parse_synced_lyrics(synced);
        if !lines.is_empty() {
            return Some(lines);
        }
    }
    if let Some(plain) = dump.get("plainLyrics").and_then(Value::as_str) {
        let lines = parse_plain_lyrics(plain);
        if !lines.is_empty() {
            return Some(lines);
        }
    }
    None
}

fn parse_synced_lyrics(input: &str) -> Vec<LyricsLine> {
    let mut lines = Vec::new();
    for raw in input.lines() {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let Some((timestamps, text)) = lrc_line(raw) else {
            continue;
        };
        if timestamps.is_empty() {
            continue;
        }
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        for start_ms in timestamps {
            lines.push(LyricsLine {
                text: text.to_string(),
                start_ms: Some(start_ms),
            });
        }
    }
    lines
}

fn parse_plain_lyrics(input: &str) -> Vec<LyricsLine> {
    input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|text| LyricsLine {
            text: text.to_string(),
            start_ms: None,
        })
        .collect()
}

fn lrc_line(line: &str) -> Option<(Vec<f64>, &str)> {
    let mut rest = line.trim_start();
    let mut timestamps = Vec::new();
    loop {
        let Some(stripped) = rest.strip_prefix('[') else {
            break;
        };
        let Some(end) = stripped.find(']') else {
            break;
        };
        let Some(start_ms) = parse_lrc_timestamp(&stripped[..end]) else {
            break;
        };
        timestamps.push(start_ms);
        rest = &stripped[end + 1..];
    }
    if timestamps.is_empty() {
        None
    } else {
        Some((timestamps, rest))
    }
}

fn parse_lrc_timestamp(raw: &str) -> Option<f64> {
    let raw = raw.trim();
    let sep = raw.find(|c: char| c == ',' || c == '.');
    let (time_raw, frac_raw) = sep.map_or((raw, ""), |index| {
        (&raw[..index], &raw[index + 1..])
    });

    let mut digits: String = frac_raw.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.truncate(3);
    while digits.len() < 3 {
        digits.push('0');
    }
    let ms = if digits.is_empty() { 0.0 } else { digits.parse::<f64>().ok()? };

    let parts: Vec<&str> = time_raw.split(':').collect();
    let (hours, minutes, seconds) = match parts.len() {
        2 => (0.0, parts[0].parse::<f64>().ok()?, parts[1].parse::<f64>().ok()?),
        3 => (
            parts[0].parse::<f64>().ok()?,
            parts[1].parse::<f64>().ok()?,
            parts[2].parse::<f64>().ok()?,
        ),
        _ => return None,
    };
    Some(((hours * 60.0 + minutes) * 60.0 + seconds) * 1000.0 + ms)
}
