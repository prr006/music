use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::types::{LyricsLine, LyricsResult, Track};
use crate::ytdlp::YtDlp;

/// Lightweight Rust port of the full MELO `YoutubeLyrics` provider.
///
/// Behavior mirrors `src/melo/lyrics/youtube-lyrics.ts`:
///  1. run `yt-dlp -J --skip-download --no-warnings <url>`
///  2. pick a caption URL from `subtitles` / `automatic_captions`
///  3. fetch the VTT/SRT body
///  4. parse timed cues into `LyricsLine`s
pub struct LyricsProvider {
    ytdlp: YtDlp,
    cache: Mutex<HashMap<String, LyricsResult>>,
}

impl LyricsProvider {
    pub fn new(path: Option<PathBuf>) -> Self {
        LyricsProvider {
            ytdlp: YtDlp::new(path),
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

        let result = match self.fetch_lyrics(track).await {
            Ok(lines) if !lines.is_empty() => LyricsResult {
                track_id: track.id.clone(),
                lines,
                source: Some("youtube".to_string()),
            },
            Ok(_) => empty.clone(),
            Err(e) => {
                log::warn!("lyrics lookup failed for {}: {e}", track.id);
                empty.clone()
            }
        };

        self.cache.lock().await.insert(track.id.clone(), result.clone());
        result
    }

    async fn fetch_lyrics(&self, track: &Track) -> anyhow::Result<Vec<LyricsLine>> {
        let raw = self.ytdlp.dump_json(&track.url).await?;
        let dump: Value = serde_json::from_str(&raw)?;
        let Some(url) = caption_url_from_dump(&dump) else {
            return Ok(Vec::new());
        };
        let body = fetch_text(&url).await?;
        Ok(parse_cues(&body))
    }
}

async fn fetch_text(url: &str) -> anyhow::Result<String> {
    let url = url.to_string();
    tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
        let response = ureq::get(url.as_str())
            .call()
            .map_err(|e| anyhow::anyhow!("lyrics caption fetch failed: {e}"))?;
        response
            .into_string()
            .map_err(|e| anyhow::anyhow!("lyrics caption body invalid: {e}"))
    })
    .await
    .map_err(|e| anyhow::anyhow!("lyrics caption fetch aborted: {e}"))?
}

fn preferred_url(entries: &Value) -> Option<String> {
    let arr = entries.as_array()?;
    let mut first: Option<String> = None;
    for item in arr {
        if let Some(url) = item.get("url").and_then(Value::as_str) {
            let ext = item.get("ext").and_then(Value::as_str).unwrap_or("").to_string();
            if first.is_none() {
                first = Some(url.to_string());
            }
            if ext == "vtt" || ext == "srv3" || ext == "srt" {
                return Some(url.to_string());
            }
        }
    }
    first
}

fn first_url(entries: &Value) -> Option<String> {
    let arr = entries.as_array()?;
    arr.iter()
        .find_map(|item| item.get("url").and_then(Value::as_str))
        .map(str::to_string)
}

/// Mirrors `captionUrlFromDump`: prefer English captions in `subtitles`,
/// then `automatic_captions`, then any available caption entry.
pub fn caption_url_from_dump(dump: &Value) -> Option<String> {
    let obj = dump.as_object()?;
    let langs = ["en", "en-US", "en-GB", "en-orig"];
    for bucket in ["subtitles", "automatic_captions"] {
        let Some(map) = obj.get(bucket).and_then(Value::as_object) else {
            continue;
        };
        for lang in langs {
            if let Some(entries) = map.get(lang) {
                if let Some(url) = preferred_url(entries) {
                    return Some(url);
                }
            }
        }
        for entries in map.values() {
            if entries.is_array() {
                if let Some(url) = first_url(entries) {
                    return Some(url);
                }
            }
        }
    }
    None
}

/// Mirrors `parseVtt`: accepts WebVTT or simple SRT, keeps timestamps for sync.
pub fn parse_cues(input: &str) -> Vec<LyricsLine> {
    let mut lines = Vec::new();
    let text = input.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let mut seen: Vec<String> = Vec::new();

    for block in text.split("\n\n") {
        let rows: Vec<&str> = block
            .lines()
            .map(str::trim)
            .filter(|row| {
                !row.is_empty()
                    && *row != "WEBVTT"
                    && !row.starts_with("NOTE")
                    && !row.starts_with("Kind:")
                    && !row.starts_with("Language:")
            })
            .collect();
        if rows.is_empty() {
            continue;
        }
        let Some(time_row) = rows.iter().find(|row| row.contains("-->")).copied() else {
            continue;
        };
        let start_raw = time_row.split("-->").next().unwrap_or_default();
        let start_ms = parse_timestamp(start_raw);
        let raw_text = rows
            .iter()
            .filter(|row| {
                *row != time_row && !row.trim().chars().all(|c| c.is_ascii_digit())
            })
            .copied()
            .collect::<Vec<_>>()
            .join(" ");
        let text = clean_cue(&raw_text);
        if text.is_empty() {
            continue;
        }
        let key = format!("{}:{text}", start_ms.map_or_else(String::new, |ms| ms.to_string()));
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        lines.push(LyricsLine { text, start_ms });
    }

    lines
}

fn parse_timestamp(raw: &str) -> Option<f64> {
    let raw = raw.trim();
    let sep = raw.find(|c: char| c == ',' || c == '.')?;
    let time = &raw[..sep];
    let frac = &raw[sep + 1..];

    let mut digits: String = frac.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.truncate(3);
    while digits.len() < 3 {
        digits.push('0');
    }
    let ms = digits.parse::<f64>().ok()?;

    let parts: Vec<&str> = time.split(':').collect();
    let (h, m, s) = match parts.len() {
        2 => (0.0, parts[0].parse::<f64>().ok()?, parts[1].parse::<f64>().ok()?),
        3 => (
            parts[0].parse::<f64>().ok()?,
            parts[1].parse::<f64>().ok()?,
            parts[2].parse::<f64>().ok()?,
        ),
        _ => return None,
    };
    Some(((h * 60.0 + m) * 60.0 + s) * 1000.0 + ms)
}

fn clean_cue(text: &str) -> String {
    let stripped = strip_tags(text)
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">");

    let mut out = String::with_capacity(stripped.len());
    let mut pending_space = false;
    for ch in stripped.trim().chars() {
        if ch.is_whitespace() {
            pending_space = true;
        } else {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(ch);
        }
    }
    out
}

fn strip_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}
