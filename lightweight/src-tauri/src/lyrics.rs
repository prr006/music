use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::types::{LyricsLine, LyricsResult, Track};

const USER_AGENT: &str = "MELO/0.1.0 (https://github.com/prr006/music)";
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const MIN_MATCH_SCORE: i64 = 100;

/// Lightweight Rust lyrics provider backed by LRCLIB's public API.
///
/// Lookup strategy:
///  1. Exact `/api/get` using the current track's title/artist plus album and
///     duration when available. This is the highest-precision match.
///  2. `/api/search?track_name=...&artist_name=...` with both the original and
///     cleaned title/artist, because LRCLIB stores artist names without
///     YouTube " - Topic" suffixes and titles without "(Official ...)" markers.
///  3. `/api/search?q=<title> <artist>` as a final broad fallback.
///  4. Score the returned records and prefer synced lyrics, then plain lyrics.
///
/// Missing/error cases always return the existing empty `LyricsResult`.
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
        let title = track.title.trim();
        let artist = clean_artist(track.uploader.as_deref().unwrap_or_default().trim());
        if title.is_empty() || artist.is_empty() {
            return Ok(None);
        }

        // 1. Exact match endpoint first.
        if let Some(url) = exact_lyrics_url(track, &title, &artist) {
            if let Some(Some(body)) = request_json(&url).await? {
                if let Some(lines) = parse_response(&body) {
                    return Ok(Some(lines));
                }
            }
        }

        // 2. Structured search with original and cleaned metadata.
        let clean_title = clean_title(title);
        let mut results: Vec<Value> = Vec::new();
        let structured = [
            (title.to_string(), artist.clone()),
            (clean_title.clone(), artist.clone()),
        ];
        for (t, a) in structured {
            let url = search_url(&t, &a);
            if let Some(Some(body)) = request_json(&url).await? {
                if let Some(items) = body.as_array() {
                    results.extend(items.clone());
                }
            }
        }

        // 3. Broad fuzzy search fallback.
        let q = format!("{clean_title} {artist}");
        let q_url = q_search_url(&q);
        if let Some(Some(body)) = request_json(&q_url).await? {
            if let Some(items) = body.as_array() {
                results.extend(items.clone());
            }
        }

        Ok(pick_best(&results, track, &clean_title, &artist))
    }
}

fn exact_lyrics_url(track: &Track, title: &str, artist: &str) -> Option<String> {
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

fn search_url(title: &str, artist: &str) -> String {
    format!(
        "https://lrclib.net/api/search?track_name={}&artist_name={}",
        percent_encode(title),
        percent_encode(artist)
    )
}

fn q_search_url(query: &str) -> String {
    format!(
        "https://lrclib.net/api/search?q={}",
        percent_encode(query)
    )
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

async fn request_json(url: &str) -> anyhow::Result<Option<Value>> {
    let url = url.to_string();
    match tokio::task::spawn_blocking(move || fetch_json(&url)).await {
        Ok(result) => result,
        Err(e) => Err(anyhow::anyhow!("lrclib fetch aborted: {e}")),
    }
}

fn fetch_json(url: &str) -> anyhow::Result<Option<Value>> {
    let response = ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .timeout(HTTP_TIMEOUT)
        .call();
    let response = match response {
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

fn pick_best(
    results: &[Value],
    track: &Track,
    source_title: &str,
    source_artist: &str,
) -> Option<Vec<LyricsLine>> {
    let mut best: Option<(i64, Vec<LyricsLine>)> = None;
    for result in results {
        let Some(lines) = parse_response(result) else {
            continue;
        };
        if lines.is_empty() {
            continue;
        }
        let score = score_result(result, track, source_title, source_artist);
        if score < MIN_MATCH_SCORE || !candidate_acceptable(result, track, source_title, source_artist) {
            continue;
        }
        if best.as_ref().map_or(true, |(best_score, _)| score > *best_score) {
            best = Some((score, lines));
        }
    }
    best.map(|(_, lines)| lines)
}

fn candidate_acceptable(
    result: &Value,
    track: &Track,
    source_title: &str,
    source_artist: &str,
) -> bool {
    let result_title = result
        .get("trackName")
        .or_else(|| result.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let result_artist = result.get("artistName").and_then(Value::as_str).unwrap_or("");

    let n_title = normalize(result_title);
    let n_source_title = normalize(source_title);
    let n_artist = normalize(result_artist);
    let n_source_artist = normalize(source_artist);

    let title_match = n_title == n_source_title
        || n_source_title.starts_with(n_title.as_str())
        || n_title.starts_with(n_source_title.as_str());
    let artist_match = n_artist == n_source_artist
        || n_artist.contains(n_source_artist.as_str())
        || n_source_artist.contains(n_artist.as_str());
    let duration_close = match (result.get("duration").and_then(Value::as_f64), track.duration) {
        (Some(actual), Some(expected)) => (actual - expected).abs() <= 5.0,
        // Without a local duration we still trust the search result if either
        // the title or artist matches; LRCLIB may return a slightly different
        // duration for the same recording.
        _ => true,
    };

    artist_match || (title_match && duration_close)
}

fn score_result(
    result: &Value,
    track: &Track,
    source_title: &str,
    source_artist: &str,
) -> i64 {
    let result_title = result
        .get("trackName")
        .or_else(|| result.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let result_artist = result.get("artistName").and_then(Value::as_str).unwrap_or("");
    let result_album = result.get("albumName").and_then(Value::as_str).unwrap_or("");

    let n_title = normalize(result_title);
    let n_source_title = normalize(source_title);
    let n_artist = normalize(result_artist);
    let n_source_artist = normalize(source_artist);

    let mut score = 0i64;

    if n_title == n_source_title
        || n_source_title.starts_with(n_title.as_str())
        || n_title.starts_with(n_source_title.as_str())
    {
        score += 100;
    }

    let artist_match = n_artist == n_source_artist
        || n_artist.contains(n_source_artist.as_str())
        || n_source_artist.contains(n_artist.as_str());
    if artist_match {
        score += 80;
    }

    let result_duration = result.get("duration").and_then(Value::as_f64);
    if let (Some(actual), Some(expected)) = (result_duration, track.duration) {
        let diff = (actual - expected).abs();
        if diff <= 2.0 {
            score += 40;
        } else if diff <= 5.0 {
            score += 15;
        }
    }

    if let Some(expected_album) = track.album.as_deref() {
        let album = result_album.trim();
        if !album.is_empty() && !expected_album.is_empty() {
            let n_album = normalize(album);
            let n_expected = normalize(expected_album);
            if n_album == n_expected
                || n_album.starts_with(n_expected.as_str())
                || n_expected.starts_with(n_album.as_str())
            {
                score += 20;
            }
        }
    }

    let has_synced = result
        .get("syncedLyrics")
        .and_then(Value::as_str)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let has_plain = result
        .get("plainLyrics")
        .and_then(Value::as_str)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if has_synced {
        score += 20;
    } else if has_plain {
        score += 5;
    }

    score
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

fn clean_title(title: &str) -> String {
    let trimmed = title.trim();
    let lower = trimmed.to_lowercase();
    const SUFFIXES: &[&str] = &[
        " (official audio)",
        " (official video)",
        " (official lyric video)",
        " (official music video)",
        " (official audio)",
        " (lyrics)",
        " (audio)",
        " [official audio]",
        " [official video]",
        " [official lyric video]",
        " [lyrics]",
        " [audio]",
        " - topic",
    ];
    for suffix in SUFFIXES {
        if lower.ends_with(suffix) {
            return trimmed[..trimmed.len() - suffix.len()].trim().to_string();
        }
    }
    trimmed.to_string()
}

fn clean_artist(artist: &str) -> String {
    let trimmed = artist.trim();
    let lower = trimmed.to_lowercase();
    for suffix in [" - topic", " topic"] {
        if lower.ends_with(suffix) {
            return trimmed[..trimmed.len() - suffix.len()].trim().to_string();
        }
    }
    trimmed.to_string()
}

fn normalize(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_space = false;
    for ch in input.to_lowercase().chars() {
        if ch.is_alphanumeric() {
            out.push(ch);
            last_was_space = false;
        } else if !last_was_space {
            out.push(' ');
            last_was_space = true;
        }
    }
    out.trim().to_string()
}
