use std::ffi::OsString;
use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::mpsc::UnboundedSender;

use crate::types::RepeatMode;

const IPC_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Default)]
pub struct MpvState {
    pub title: String,
    pub paused: bool,
    pub muted: bool,
    pub time_pos: f64,
    pub duration: f64,
    pub volume: u64,
    pub repeat_mode: RepeatMode,
    pub idle_active: bool,
}

/// Combined read/write trait used by the MPV IPC stream. Rust does not allow a
/// trait object to contain two non-auto traits directly, so this blends the
/// Tokio async read/write traits into one object-safe trait.
pub trait AsyncReadWrite: AsyncRead + AsyncWrite {}

impl<T> AsyncReadWrite for T where T: AsyncRead + AsyncWrite {}

type MpvStream = Box<dyn AsyncReadWrite + Unpin + Send>;

async fn connect_mpv(pipe: &str) -> io::Result<MpvStream> {
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ClientOptions;
        let client = ClientOptions::new().open(pipe)?;
        Ok(Box::new(client))
    }
    #[cfg(unix)]
    {
        use tokio::net::UnixStream;
        let stream = UnixStream::connect(pipe).await?;
        Ok(Box::new(stream))
    }
    #[cfg(all(not(windows), not(unix)))]
    {
        let _ = pipe;
        Err(io::Error::new(io::ErrorKind::Unsupported, "unsupported platform"))
    }
}

async fn write_line(stream: &mut MpvStream, value: &Value) -> io::Result<()> {
    let mut text = value.to_string();
    text.push('\n');
    stream.write_all(text.as_bytes()).await
}

async fn read_line(stream: &mut MpvStream, carry: &mut String) -> io::Result<Option<String>> {
    let mut buf = [0u8; 2048];
    loop {
        let n = stream.read(&mut buf).await?;
        if n == 0 {
            if carry.is_empty() {
                return Ok(None);
            }
            return Ok(Some(std::mem::take(carry)));
        }
        carry.push_str(&String::from_utf8_lossy(&buf[..n]));
        if let Some(pos) = carry.find('\n') {
            let result = carry[..pos].to_string();
            carry.drain(..=pos);
            return Ok(Some(result));
        }
    }
}

pub struct Mpv {
    pub pipe: String,
    pub state: MpvState,
    child: Option<tokio::process::Child>,
}

impl Mpv {
    pub fn new() -> Self {
        let pid = std::process::id();
        let pipe = if cfg!(windows) {
            format!(r"\\.\pipe\ytmusic-player-mpv-{pid}")
        } else {
            let tmp = std::env::temp_dir();
            tmp.join(format!("ytmusic-player-mpv-{pid}.sock")).to_string_lossy().to_string()
        };
        Mpv {
            pipe,
            state: MpvState::default(),
            child: None,
        }
    }

    pub async fn start(
        &mut self,
        path: &PathBuf,
        event_tx: UnboundedSender<Value>,
        proxy: &str,
        ytdlp_dir: Option<PathBuf>,
    ) -> anyhow::Result<()> {
        let mut args: Vec<String> = vec![
            "--no-video".into(),
            "--no-terminal".into(),
            "--input-ipc-server=".to_string() + &self.pipe,
            "--idle=yes".into(),
            "--no-config".into(),
            "--cache-on-disk=no".into(),
            "--resume-playback=no".into(),
            "--save-watch-history=no".into(),
            "--cookies=no".into(),
            "--ytdl-raw-options=ignore-config=,no-cache-dir=,no-cookies=,no-cookies-from-browser=".into(),
        ];
        if !proxy.is_empty() {
            args.push(format!("--ytdl-raw-options=ignore-config=,no-cache-dir=,no-cookies=,no-cookies-from-browser=,proxy={proxy}"));
            if proxy.starts_with("http://") || proxy.starts_with("https://") {
                args.push(format!("--http-proxy={proxy}"));
            }
        }

        let mut command = Command::new(path);
        command
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // mpv resolves YouTube URLs through its yt-dlp integration. Make the
        // bundled yt-dlp directory visible to that child process without
        // depending on the system PATH.
        if let Some(dir) = ytdlp_dir {
            let current = std::env::var("PATH")
                .or_else(|_| std::env::var("Path"))
                .unwrap_or_default();
            let current_entries: Vec<String> = std::env::split_paths(&current)
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let mut entries = vec![dir.to_string_lossy().to_string()];
            entries.extend(current_entries);
            let new_path: OsString = match std::env::join_paths(entries.iter().map(std::path::Path::new)) {
                Ok(path) => path,
                // If the inherited PATH contains an entry that cannot be joined,
                // fall back to the original value rather than dropping it.
                Err(_) => OsString::from(current),
            };
            command.env("Path", &new_path);
            command.env("PATH", &new_path);
        }

        let mut child = command
            .spawn()
            .map_err(|e| anyhow::anyhow!("Failed to start bundled mpv at {}: {e}", path.display()))?;

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(drain_stream(stderr));
        }

        // Wait for the IPC endpoint.
        let deadline = Instant::now() + IPC_CONNECT_TIMEOUT;
        let mut last_error = String::new();
        loop {
            match self.request(json!(["get_property", "version"]).as_array().cloned().unwrap_or_default()).await {
                Ok(_) => break,
                Err(e) => {
                    last_error = e;
                    if let Some(code) = child.try_wait().ok().flatten() {
                        return Err(anyhow::anyhow!(
                            "mpv exited during startup (code {code}): {last_error}"
                        ));
                    }
                    if Instant::now() >= deadline {
                        return Err(anyhow::anyhow!("mpv IPC did not become ready: {last_error}"));
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }

        self.child = Some(child);
        self.spawn_event_loop(event_tx.clone());
        Ok(())
    }

    fn spawn_event_loop(&self, event_tx: UnboundedSender<Value>) {
        let pipe = self.pipe.clone();
        tokio::spawn(async move {
            if let Err(e) = event_loop(pipe, event_tx).await {
                log::warn!("mpv event loop stopped: {e}");
            }
        });
    }

    async fn request(&self, command: Vec<Value>) -> Result<Value, String> {
        let id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let mut stream = connect_mpv(&self.pipe)
            .await
            .map_err(|e| format!("connect mpv: {e}"))?;

        let payload = json!({ "command": command, "request_id": id });
        write_line(&mut stream, &payload)
            .await
            .map_err(|e| format!("write mpv command: {e}"))?;

        let deadline = Instant::now() + REQUEST_TIMEOUT;
        let mut carry = String::new();
        loop {
            let line = read_line(&mut stream, &mut carry)
                .await
                .map_err(|e| format!("read mpv response: {e}"))?;
            let Some(line) = line else {
                break;
            };
            if line.trim().is_empty() {
                continue;
            }
            let parsed: Value = serde_json::from_str(&line).map_err(|e| format!("parse mpv response: {e}"))?;
            if parsed.get("request_id").and_then(Value::as_u64) == Some(id) {
                if let Some(err) = parsed.get("error") {
                    let err = err.as_str().unwrap_or("unknown");
                    if err != "success" {
                        return Err(format!("mpv command failed: {err}"));
                    }
                }
                return Ok(parsed);
            }
            if Instant::now() >= deadline {
                return Err("mpv request timed out".to_string());
            }
        }
        Err("mpv connection closed before response".to_string())
    }

    pub async fn get_property(&self, name: &str) -> Result<Value, String> {
        let response = self.request(json!(["get_property", name]).as_array().cloned().unwrap_or_default()).await?;
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    }

    pub async fn poll_state(&mut self) -> Result<(), String> {
        let title = self.get_property("media-title").await.unwrap_or(Value::Null);
        let pause = self.get_property("pause").await.unwrap_or(Value::Null);
        let mute = self.get_property("mute").await.unwrap_or(Value::Null);
        let time_pos = self.get_property("time-pos").await.unwrap_or(Value::Null);
        let duration = self.get_property("duration").await.unwrap_or(Value::Null);
        let volume = self.get_property("volume").await.unwrap_or(Value::Null);
        let idle = self.get_property("idle-active").await.unwrap_or(Value::Null);

        if let Some(t) = title.as_str() {
            self.state.title = t.to_string();
        }
        self.state.paused = pause.as_bool().unwrap_or(self.state.paused);
        self.state.muted = mute.as_bool().unwrap_or(self.state.muted);
        self.state.time_pos = time_pos.as_f64().unwrap_or(self.state.time_pos);
        self.state.duration = duration.as_f64().unwrap_or(self.state.duration);
        self.state.volume = volume.as_f64().map(|v| v.round() as u64).unwrap_or(self.state.volume);
        self.state.idle_active = idle.as_bool().unwrap_or(self.state.idle_active);
        Ok(())
    }

    pub async fn load(&mut self, url: &str) -> Result<(), String> {
        let command = json!(["loadfile", url, "replace"]).as_array().cloned().unwrap_or_default();
        self.request(command).await.map(|_| ())
    }

    pub async fn toggle_pause(&mut self) -> Result<bool, String> {
        self.request(json!(["cycle", "pause"]).as_array().cloned().unwrap_or_default()).await?;
        let paused = self.get_property("pause").await.unwrap_or(Value::Bool(self.state.paused)).as_bool().unwrap_or(self.state.paused);
        self.state.paused = paused;
        Ok(paused)
    }

    pub async fn set_paused(&mut self, paused: bool) -> Result<(), String> {
        let command = json!(["set_property", "pause", paused]).as_array().cloned().unwrap_or_default();
        self.request(command).await?;
        self.state.paused = paused;
        Ok(())
    }

    pub async fn toggle_mute(&mut self) -> Result<bool, String> {
        self.request(json!(["cycle", "mute"]).as_array().cloned().unwrap_or_default()).await?;
        let muted = self.get_property("mute").await.unwrap_or(Value::Bool(self.state.muted)).as_bool().unwrap_or(self.state.muted);
        self.state.muted = muted;
        Ok(muted)
    }

    pub async fn seek(&mut self, seconds: f64) -> Result<(), String> {
        let command = json!(["seek", seconds, "relative"]).as_array().cloned().unwrap_or_default();
        self.request(command).await.map(|_| ())
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        let command = json!(["stop"]).as_array().cloned().unwrap_or_default();
        self.request(command).await.map(|_| ())
    }

    pub async fn set_volume(&mut self, level: u64) -> Result<(), String> {
        let clamped = level.min(100);
        let command = json!(["set_property", "volume", clamped]).as_array().cloned().unwrap_or_default();
        self.request(command).await?;
        self.state.volume = clamped;
        Ok(())
    }

    pub async fn set_repeat(&mut self, mode: RepeatMode) -> Result<(), String> {
        let (file, playlist) = match mode {
            RepeatMode::One => ("inf", "no"),
            RepeatMode::All => ("no", "inf"),
            RepeatMode::Off => ("no", "no"),
        };
        self.request(json!(["set_property", "loop-file", file]).as_array().cloned().unwrap_or_default()).await?;
        self.request(json!(["set_property", "loop-playlist", playlist]).as_array().cloned().unwrap_or_default()).await?;
        self.state.repeat_mode = mode;
        Ok(())
    }

    pub async fn shutdown(&mut self) {
        let _ = self.request(json!(["quit"]).as_array().cloned().unwrap_or_default()).await;
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }
}

async fn event_loop(pipe: String, event_tx: UnboundedSender<Value>) -> anyhow::Result<()> {
    let mut stream = connect_mpv(&pipe)
        .await
        .map_err(|e| anyhow::anyhow!("mpv event connect: {e}"))?;

    let observes = ["media-title", "pause", "time-pos", "duration", "volume", "mute", "idle-active"];
    for (idx, name) in observes.iter().enumerate() {
        let payload = json!({ "command": ["observe_property", idx + 1, name], "request_id": 1000 + idx });
        write_line(&mut stream, &payload).await?;
    }

    let mut carry = String::new();
    while let Some(line) = read_line(&mut stream, &mut carry).await? {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        if value.get("event").and_then(Value::as_str) == Some("property-change") {
            if let (Some(name), Some(data)) = (value.get("name").and_then(Value::as_str), value.get("data")) {
                let event = json!({ "type": "property-change", "name": name, "data": data });
                if event_tx.send(event).is_err() {
                    break;
                }
            }
        } else if value.get("event").and_then(Value::as_str) == Some("end-file") {
            let reason = value.get("reason").and_then(Value::as_str).unwrap_or("unknown");
            let event = json!({ "type": "end-file", "reason": reason });
            if event_tx.send(event).is_err() {
                break;
            }
        } else if value.get("event").and_then(Value::as_str) == Some("start-file") {
            let event = json!({ "type": "start-file" });
            if event_tx.send(event).is_err() {
                break;
            }
        }
    }
    Ok(())
}

async fn drain_stream<R>(mut stream: R)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = [0u8; 4096];
    while let Ok(n) = stream.read(&mut buf).await {
        if n == 0 {
            break;
        }
    }
}
