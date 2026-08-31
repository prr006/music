use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::Command;

use crate::types::Track;

#[derive(Debug, Clone)]
pub struct YtDlp {
    pub path: Option<PathBuf>,
}

impl YtDlp {
    pub fn new(path: Option<PathBuf>) -> Self {
        YtDlp { path }
    }

    fn command(&self) -> Command {
        let mut cmd = if let Some(path) = &self.path {
            Command::new(path)
        } else {
            Command::new("yt-dlp")
        };
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd
    }

    fn privacy_args(&self) -> Vec<String> {
        let mut args = vec![
            "--ignore-config".to_string(),
            "--no-cache-dir".to_string(),
            "--no-cookies".to_string(),
            "--no-cookies-from-browser".to_string(),
            "--no-warnings".to_string(),
        ];
        if let Ok(proxy) = std::env::var("YTMUSIC_PROXY") {
            if !proxy.trim().is_empty() {
                args.push("--proxy".to_string());
                args.push(proxy);
            }
        }
        args
    }

    async fn run(&self, args: &[String]) -> anyhow::Result<String> {
        let mut cmd = self.command();
        cmd.args(self.privacy_args());
        cmd.args(args);
        let output = cmd.output().await.map_err(|e| anyhow::anyhow!("failed to run yt-dlp: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail: String = stderr.chars().rev().take(4000).collect::<Vec<_>>().into_iter().rev().collect();
            return Err(anyhow::anyhow!("{tail}"));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    pub async fn search(&self, query: &str, limit: usize) -> anyhow::Result<Vec<Track>> {
        let args = vec![
            format!("ytsearch{limit}:{query}"),
            "--dump-json".to_string(),
            "--flat-playlist".to_string(),
            "--quiet".to_string(),
        ];
        let text = self.run(&args).await?;
        Ok(parse_tracks(&text))
    }

    pub async fn fetch_mix(&self, video_id: &str, limit: usize) -> anyhow::Result<Vec<Track>> {
        let url = format!("https://www.youtube.com/watch?v={video_id}&list=RD{video_id}");
        let args = vec![
            url,
            "--dump-json".to_string(),
            "--flat-playlist".to_string(),
            "--quiet".to_string(),
            "--playlist-end".to_string(),
            limit.to_string(),
        ];
        let text = self.run(&args).await?;
        Ok(parse_tracks(&text))
    }
}

fn parse_tracks(text: &str) -> Vec<Track> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let value: serde_json::Value = serde_json::from_str(line).ok()?;
            let id = value.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            if id.is_empty() {
                return None;
            }
            let title = value.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            Some(Track {
                id: id.to_string(),
                title,
                url: format!("https://www.youtube.com/watch?v={id}"),
                duration: value.get("duration").and_then(|v| v.as_f64()),
                uploader: value.get("uploader").or_else(|| value.get("channel")).and_then(|v| v.as_str()).map(str::to_string),
                artwork: None,
                album: None,
            })
        })
        .collect()
}
