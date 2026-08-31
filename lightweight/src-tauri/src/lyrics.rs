use std::collections::{HashMap, HashSet};
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
///  1. Exact `/api/get` using the cleaned title/artist (plus album and
///     duration when available). This is the highest-precision match.
///  2. Structured `/api/search?track_name=...&artist_name=...` over sensible
///     combinations of cleaned/original title and artist, because LRCLIB
///     stores artist names without YouTube " - Topic"/"VEVO" suffixes and
///     titles without "(Official ...)" markers.
///  3. `/api/search?q=<title> <artist>` as a final broad fallback.
///  4. Score every candidate and require BOTH a title and an artist match so
///     an obviously-wrong result is never returned just because it is the
///     closest hit. Synced lyrics are preferred over plain lyrics.
///
/// Missing/error cases always return the existing empty `LyricsResult`. All
/// network work runs on a blocking thread so the playback thread is never
/// blocked.
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
            Some(lines) => LyricsResult {
                track_id: track.id.clone(),
                lines,
                source: Some("lrclib".to_string()),
            },
            None => empty.clone(),
        };

        self.cache.lock().await.insert(track.id.clone(), result.clone());
        result
    }

    async fn fetch_and_parse(&self, track: &Track) -> Option<Vec<LyricsLine>> {
        let raw_title = track.title.trim();
        let raw_artist = track.uploader.as_deref().unwrap_or_default().trim();
        if raw_title.is_empty() || raw_artist.is_empty() {
            return None;
        }

        let clean_title = clean_title(raw_title);
        let clean_artist = clean_artist(raw_artist);

        let titles = dedup_str(&[clean_title.as_str(), raw_title]);
        let artists = dedup_str(&[clean_artist.as_str(), raw_artist]);

        // 1. Exact `/api/get`. The cleaned pair matches how LRCLIB stores
        //    metadata, so try it first; the original title is a fallback.
        for t in &titles {
            for a in &artists {
                if let Some(url) = exact_lyrics_url(track, t, a) {
                    if let Some(body) = request_json(&url).await {
                        if let Some(lines) = parse_response(&body) {
                            return Some(lines);
                        }
                    }
                }
            }
        }

        // 2. Structured search over cleaned/original combinations.
        let mut results: Vec<Value> = Vec::new();
        for t in &titles {
            for a in &artists {
                let url = search_url(t, a);
                if let Some(body) = request_json(&url).await {
                    if let Some(items) = body.as_array() {
                        results.extend(items.clone());
                    }
                }
            }
        }

        // 3. Broad fuzzy search fallback using the cleaned forms.
        let q = format!("{clean_title} {clean_artist}");
        if let Some(body) = request_json(&q_search_url(&q)).await {
            if let Some(items) = body.as_array() {
                results.extend(items.clone());
            }
        }

        pick_best(&results, track, &clean_title, &clean_artist)
    }
}

fn dedup_str<'a>(items: &[&'a str]) -> Vec<&'a str> {
    let mut out: Vec<&'a str> = Vec::new();
    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() || out.iter().any(|e| *e == trimmed) {
            continue;
        }
        out.push(trimmed);
    }
    out
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

/// Fetch a URL on a blocking thread so the async runtime stays responsive.
/// Never errors: any network/parse/status problem collapses to `None`.
async fn request_json(url: &str) -> Option<Value> {
    let url = url.to_string();
    match tokio::task::spawn_blocking(move || fetch_json(&url)).await {
        Ok(value) => value,
        Err(e) => {
            log::warn!("lrclib fetch task aborted: {e}");
            None
        }
    }
}

fn fetch_json(url: &str) -> Option<Value> {
    let response = match ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .timeout(HTTP_TIMEOUT)
        .call()
    {
        Ok(response) => response,
        Err(e) => {
            log::debug!("lrclib request failed: {e}");
            return None;
        }
    };
    let status = response.status();
    if !(200..300).contains(&status) {
        log::debug!("lrclib returned {status} for {url}");
        return None;
    }
    let body = match response.into_string() {
        Ok(body) => body,
        Err(e) => {
            log::debug!("lrclib response body invalid: {e}");
            return None;
        }
    };
    match serde_json::from_str(&body) {
        Ok(value) => Some(value),
        Err(e) => {
            log::debug!("lrclib response parse failed: {e}");
            None
        }
    }
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
        let Some(score) = score_result(result, track, source_title, source_artist) else {
            continue;
        };
        if score < MIN_MATCH_SCORE {
            continue;
        }
        if best.as_ref().map_or(true, |(best_score, _)| score > *best_score) {
            best = Some((score, lines));
        }
    }
    best.map(|(_, lines)| lines)
}

/// Score a candidate record against the requested track. Returns `None` when
/// the candidate is not a credible match (no title or artist correspondence),
/// which prevents obviously-wrong lyrics from being returned.
fn score_result(
    result: &Value,
    track: &Track,
    source_title: &str,
    source_artist: &str,
) -> Option<i64> {
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

    // Both title and artist must correspond; either alone is not enough.
    let title_score = title_match_score(&n_source_title, &n_title)?;
    let artist_score = artist_match_score(&n_source_artist, &n_artist)?;

    let mut score = title_score + artist_score;

    // Duration is a strong signal when both sides know it.
    if let (Some(actual), Some(expected)) =
        (result.get("duration").and_then(Value::as_f64), track.duration)
    {
        let diff = (actual - expected).abs();
        if diff > 10.0 {
            // Different recording length — almost certainly the wrong track.
            return None;
        } else if diff <= 2.0 {
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

    // Prefer synced lyrics, then plain lyrics.
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

    Some(score)
}

/// Compare two normalized title strings. `None` means "not a credible match".
fn title_match_score(a: &str, b: &str) -> Option<i64> {
    if a.is_empty() || b.is_empty() {
        return None;
    }
    if a == b {
        return Some(100);
    }
    let (short, long) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    if short.len() >= 3 && long.contains(short) {
        return Some(80);
    }
    if let Some(s) = subset_score(a, b) {
        return Some(s);
    }
    token_overlap(a, b, 2, 0.6).map(|_| 40)
}

/// Compare two normalized artist strings. Slightly more lenient than titles
/// because artist names often carry "feat.", "&", or "The" differences.
fn artist_match_score(a: &str, b: &str) -> Option<i64> {
    if a.is_empty() || b.is_empty() {
        return None;
    }
    if a == b {
        return Some(80);
    }
    let (short, long) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    if short.len() >= 3 && long.contains(short) {
        return Some(60);
    }
    if subset_score(a, b).is_some() {
        return Some(50);
    }
    token_overlap(a, b, 1, 0.5).map(|_| 30)
}

/// Score when one side's tokens are entirely contained in the other's.
fn subset_score(a: &str, b: &str) -> Option<i64> {
    let ta: HashSet<&str> = a.split_whitespace().collect();
    let tb: HashSet<&str> = b.split_whitespace().collect();
    if ta.is_empty() || tb.is_empty() {
        return None;
    }
    if ta.is_subset(&tb) || tb.is_subset(&ta) {
        Some(70)
    } else {
        None
    }
}

/// Score by Jaccard-like token overlap when there are at least `min_common`
/// shared tokens and the overlap ratio reaches `min_ratio`.
fn token_overlap(a: &str, b: &str, min_common: usize, min_ratio: f64) -> Option<i64> {
    let ta: HashSet<&str> = a.split_whitespace().collect();
    let tb: HashSet<&str> = b.split_whitespace().collect();
    let common = ta.intersection(&tb).count();
    let total = ta.union(&tb).count();
    if total == 0 || common < min_common {
        return None;
    }
    let ratio = common as f64 / total as f64;
    if ratio >= min_ratio {
        Some(40)
    } else {
        None
    }
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
    // LRC files may carry a global signed offset tag — `[offset:1200]`,
    // `[offset:-1200]` (milliseconds) — that shifts every timestamp in the
    // file. Parse it once, strip it from the text, and apply it to all lines.
    let mut offset_ms = 0.0;
    let mut cleaned = Vec::new();
    for raw in input.lines() {
        let (line, off) = strip_offset_tag(raw);
        if let Some(o) = off {
            offset_ms = o;
        }
        cleaned.push(line);
    }
    let mut lines = Vec::new();
    for raw in &cleaned {
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
                start_ms: Some(start_ms + offset_ms),
            });
        }
    }
    lines
}

/// Remove every `[offset:±ms]` tag from a line. Returns the cleaned line and
/// the (last) offset in milliseconds, if the line carried one.
fn strip_offset_tag(line: &str) -> (String, Option<f64>) {
    let lower = line.to_ascii_lowercase();
    let mut out = String::with_capacity(line.len());
    let mut offset: Option<f64> = None;
    let mut i = 0usize;
    while i < line.len() {
        if line.as_bytes()[i] == b'[' && lower[i..].starts_with("[offset:") {
            if let Some(end_rel) = lower[i..].find(']') {
                let inner = line[i + 8..i + end_rel].trim().trim_start_matches('+');
                if let Ok(v) = inner.parse::<f64>() {
                    offset = Some(v);
                }
                i += end_rel + 1;
                continue;
            }
        }
        let ch = line[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    (out, offset)
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

/// Strip the "(Official ...)", "(Lyrics)", "(Live)", "(Remastered)", etc.
/// markers that YouTube appends but LRCLIB does not store.
fn clean_title(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    const MARKERS: &[&str] = &[
        "official video",
        "official audio",
        "official music video",
        "official lyric video",
        "lyric video",
        "music video",
        "lyrics",
        "audio",
        "video",
        "live",
        "remastered",
        "version",
        "official",
        "hd",
        "vevo",
        "topic",
    ];
    loop {
        let mut cut: Option<usize> = None;
        for (open, close) in [('(', ')'), ('[', ']')] {
            if !s.ends_with(close) {
                continue;
            }
            if let Some(pos) = s.rfind(open) {
                let inner = s[pos + 1..s.len() - 1].trim().to_lowercase();
                if MARKERS.iter().any(|m| *m == inner) {
                    cut = Some(pos);
                    break;
                }
            }
        }
        match cut {
            Some(pos) => {
                s = s[..pos].trim_end().to_string();
            }
            None => break,
        }
    }
    s
}

/// Strip the YouTube channel suffixes that LRCLIB never stores.
fn clean_artist(raw: &str) -> String {
    let trimmed = raw.trim();
    let lower = trimmed.to_lowercase();
    for suffix in [" - topic", " topic", " - vevo", " vevo", "-vevo", "vevo"] {
        if lower.ends_with(suffix) {
            return trimmed[..trimmed.len() - suffix.len()]
                .trim_end_matches([' ', '-'])
                .to_string();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lrc_offset_tag_shifts_all_lines() {
        let lines = parse_synced_lyrics("[00:01.000][offset:-1200]Hello\n[00:02.000]World");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].start_ms, Some(-200.0));
        assert_eq!(lines[0].text, "Hello");
        assert_eq!(lines[1].start_ms, Some(800.0));
        assert_eq!(lines[1].text, "World");
        assert!(!lines.iter().any(|l| l.text.contains("offset")), "tag leaked into text");
    }

    #[test]
    fn lrc_offset_tag_standalone_line_applies_to_file() {
        let lines = parse_synced_lyrics("[offset:-1200]\n[00:01.000]Hello\n[00:03.000]World");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].start_ms, Some(-200.0));
        assert_eq!(lines[1].start_ms, Some(1800.0));
    }

    #[test]
    fn lrc_positive_offset_and_plain_unaffected() {
        let lines = parse_synced_lyrics("[offset:+500]\n[00:01.000]Hello");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].start_ms, Some(1500.0));

        let plain = parse_synced_lyrics("[00:01.000]Hello\n[00:02.500]World");
        assert_eq!(plain[0].start_ms, Some(1000.0));
        assert_eq!(plain[1].start_ms, Some(2500.0));
        assert_eq!(plain[0].text, "Hello");
    }
}
