// Prevent an extra console window on Windows in release builds.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

fn main() {
    melo_lightweight_lib::run()
}
