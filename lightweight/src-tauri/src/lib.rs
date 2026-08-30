use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

mod commands;
mod config;
mod engine;
mod mpv;
mod runtime;
mod types;
mod ytdlp;

use crate::engine::Engine;
use crate::types::ConnectionState;

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<Mutex<Engine>>,
    pub connection: Arc<Mutex<ConnectionState>>,
    pub quitting: Arc<AtomicBool>,
}

async fn emit_connection(app: &AppHandle, state: &AppState, value: ConnectionState) {
    *state.connection.lock().await = value;
    let text = value.as_str().to_string();
    let _ = app.emit("backend:connection-state", text.clone());
    let _ = app.emit("backend:connected", text == "connected");
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let runtime = runtime::discover_runtime(app.handle());

            let (event_tx, event_rx) = mpsc::unbounded_channel();
            let engine = Arc::new(Mutex::new(Engine::new(&runtime, event_tx)));
            let connection = Arc::new(Mutex::new(ConnectionState::Starting));
            let quitting = Arc::new(AtomicBool::new(false));
            let state = AppState {
                engine,
                connection,
                quitting,
            };
            app.manage(state.clone());

            // ─── Backend / mpv startup ──────────────────────────────────────
            let app_handle = app.handle().clone();
            let startup_state = state.clone();
            let startup_runtime = runtime.clone();
            tauri::async_runtime::spawn(async move {
                let started = {
                    let mut eng = startup_state.engine.lock().await;
                    eng.start(&startup_runtime).await
                };
                match started {
                    Ok(()) => emit_connection(&app_handle, &startup_state, ConnectionState::Connected).await,
                    Err(e) => {
                        log::error!("MELO backend startup failed: {e}");
                        emit_connection(&app_handle, &startup_state, ConnectionState::Error).await;
                    }
                }
            });

            // ─── Mpv events → renderer + engine auto-advance ─────────────────
            let event_state = state.clone();
            let event_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut rx = event_rx;
                while let Some(event) = rx.recv().await {
                    let event_type = event.get("type").and_then(serde_json::Value::as_str).unwrap_or("");
                    let internal = matches!(event_type, "property-change" | "end-file" | "start-file");
                    if !internal {
                        let _ = event_app.emit("backend:event", &event);
                    }
                    let request = {
                        let mut eng = event_state.engine.lock().await;
                        eng.handle_event(event).await
                    };
                    if request.generation != 0 && !request.from_id.is_empty() {
                        let state = event_state.clone();
                        let from_id = request.from_id.clone();
                        tauri::async_runtime::spawn(async move {
                            let path = { state.engine.lock().await.ytdlp.path.clone() };
                            let yt = crate::ytdlp::YtDlp::new(path);
                            if let Ok(tracks) = yt.fetch_mix(&from_id, 25).await {
                                let mut eng = state.engine.lock().await;
                                eng.apply_refill(request.generation, &from_id, tracks);
                            }
                        });
                    }
                }
            });

            // ─── Playback state polling ──────────────────────────────────────
            let poll_state = state.clone();
            let poll_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    {
                        let mut eng = poll_state.engine.lock().await;
                        eng.tick().await;
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    let _ = &poll_app;
                }
            });

            // ─── Close (X) → hide to tray instead of quitting ───────────────
            let close_state = state.clone();
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if !close_state.quitting.load(Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = win.hide();
                        }
                    }
                });
            }

            // ─── Tray ────────────────────────────────────────────────────────
            if let Some(icon) = app.default_window_icon() {
                let tray_state = state.clone();
                let show_item = MenuItem::with_id(app, "show", "Show MELO", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
                let tray_icon = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .tooltip("MELO — light YouTube Music player")
                    .on_menu_event(move |app, event| {
                        let id = event.id().as_ref();
                        if id == "show" {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        } else if id == "quit" {
                            tray_state.quitting.store(true, Ordering::SeqCst);
                            let state = tray_state.clone();
                            let handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let mut eng = state.engine.lock().await;
                                eng.shutdown().await;
                                drop(eng);
                                handle.exit(0);
                            });
                        }
                    })
                    .build(app)?;
                // Keep the tray icon alive for the lifetime of the app.
                app.manage(tray_icon);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::backend_send,
            commands::backend_is_connected,
            commands::backend_get_connection_state,
            commands::backend_retry,
        ])
        .build(tauri::generate_context!());

    match app {
        Ok(app) => {
            app.run(|app, event| {
                if let RunEvent::Exit = event {
                    if let Some(state) = app.try_state::<AppState>() {
                        state.quitting.store(true, Ordering::SeqCst);
                        let cloned = (*state.inner()).clone();
                        tauri::async_runtime::spawn(async move {
                            let mut eng = cloned.engine.lock().await;
                            eng.shutdown().await;
                        });
                    }
                }
            });
        }
        Err(e) => {
            eprintln!("failed to start MELO: {e}");
            std::process::exit(1);
        }
    }
}
