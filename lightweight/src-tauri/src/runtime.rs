use std::path::{Path, PathBuf};

use tauri::Manager;

#[derive(Debug, Clone, Default)]
pub struct RuntimePaths {
    pub mpv: Option<PathBuf>,
    pub ytdlp: Option<PathBuf>,
    pub resource_dir: Option<PathBuf>,
}

fn is_file(path: &Path) -> bool {
    path.is_file()
}

fn candidate(base: &Path, rel: &[&str], name: &str) -> Option<PathBuf> {
    let mut path = base.to_path_buf();
    for part in rel {
        path.push(part);
    }
    path.push(name);
    is_file(&path).then_some(path)
}

/// Resolve the bundled MELO runtime.
///
/// Priority:
///   1. Explicit `MELO_MPV` / `MELO_YTDLP` environment overrides.
///   2. Directory next to the MELO executable.
///   3. Tauri resource directory. With the config mapping
///      `../resources/bin/ -> bin/`, the packaged layout is
///      `$RESOURCE/bin/mpv/mpv.exe` and `$RESOURCE/bin/yt-dlp.exe`.
///   4. Source-tree development fallbacks (`lightweight/resources/bin`, etc).
pub fn discover_runtime(app: &tauri::AppHandle) -> RuntimePaths {
    let mut mpv = std::env::var("MELO_MPV").ok().filter(|s| !s.trim().is_empty()).map(PathBuf::from);
    let mut ytdlp = std::env::var("MELO_YTDLP").ok().filter(|s| !s.trim().is_empty()).map(PathBuf::from);

    let exe = std::env::current_exe().ok();
    let exe_dir = exe.as_deref().and_then(|p| p.parent()).map(Path::to_path_buf);
    let resource_dir = app.path().resource_dir().ok().or_else(|| exe_dir.clone());

    let mut search_bases: Vec<PathBuf> = Vec::new();
    if let Some(dir) = exe_dir.as_deref() {
        search_bases.push(dir.to_path_buf());
    }
    if let Some(dir) = resource_dir.as_deref() {
        search_bases.push(dir.to_path_buf());
        search_bases.push(dir.join("resources"));
        search_bases.push(dir.join("_up_").join("resources"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        search_bases.push(cwd.clone());
        search_bases.push(cwd.join("lightweight"));
        search_bases.push(cwd.join("resources"));
        search_bases.push(cwd.join("lightweight").join("resources"));
    }

    // mpv candidates: bin/mpv, mpv, resources/bin/mpv, and directly at the base.
    let mpv_layouts: &[&[&str]] = &[
        &["bin", "mpv"],
        &["mpv"],
        &["resources", "bin", "mpv"],
        &["_up_", "resources", "bin", "mpv"],
        &["lightweight", "resources", "bin", "mpv"],
        &["resources", "bin", "mpv"],
        &[],
    ];
    if mpv.is_none() {
        'outer: for base in &search_bases {
            for rel in mpv_layouts {
                if let Some(path) = candidate(base, rel, "mpv.exe") {
                    mpv = Some(path);
                    break 'outer;
                }
                if let Some(path) = candidate(base, rel, "mpv.com") {
                    mpv = Some(path);
                    break 'outer;
                }
            }
        }
    }

    let ytdlp_layouts: &[&[&str]] = &[
        &["bin"],
        &[],
        &["resources", "bin"],
        &["_up_", "resources", "bin"],
        &["lightweight", "resources", "bin"],
        &["resources", "bin"],
    ];
    if ytdlp.is_none() {
        'outer: for base in &search_bases {
            for rel in ytdlp_layouts {
                if let Some(path) = candidate(base, rel, "yt-dlp.exe") {
                    ytdlp = Some(path);
                    break 'outer;
                }
            }
        }
    }

    // If `MELO_MPV` pointed at mpv.com (the console wrapper), prefer the
    // sibling mpv.exe when both exist.
    if let Some(path) = mpv.as_deref() {
        if path.file_name().and_then(|n| n.to_str()) == Some("mpv.com") {
            if let Some(parent) = path.parent() {
                let exe_path = parent.join("mpv.exe");
                if exe_path.is_file() {
                    mpv = Some(exe_path);
                }
            }
        }
    }

    RuntimePaths { mpv, ytdlp, resource_dir }
}
