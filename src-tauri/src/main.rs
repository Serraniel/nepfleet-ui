// SPDX-License-Identifier: AGPL-3.0-or-later
//! The desktop shell: a window around the web frontend, connected to the local
//! control daemon. All logic stays in the daemon and the frontend; closing the
//! window leaves the daemon and its tunnels running.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::Command;

/// Where the daemon's port for this app listens.
const DAEMON_ADDR: &str = "127.0.0.1:7481";
/// This app's origins as a browser engine reports them: on Windows
/// http://tauri.localhost, elsewhere tauri://localhost.
const ORIGINS: &str = "tauri://localhost,http://tauri.localhost";

#[derive(serde::Serialize)]
struct Daemon {
    url: String,
    token: String,
}

/// The nepfleet binary: shipped next to this app, or else on PATH.
fn nepfleet() -> PathBuf {
    let name = if cfg!(windows) { "nepfleet.exe" } else { "nepfleet" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(sibling) = exe.parent().map(|dir| dir.join(name)) {
            if sibling.exists() {
                return sibling;
            }
        }
    }
    PathBuf::from(name)
}

/// Runs nepfleet with fixed arguments, without a shell.
fn run(args: &[&str]) -> Result<String, String> {
    let out = Command::new(nepfleet()).args(args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "The nepfleet command was not found. Install NepFleet first.".to_string()
        } else {
            format!("nepfleet: {e}")
        }
    })?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Starts the daemon if needed, turns on its port for this app, and returns how
/// to reach it. The token stays in the app's memory.
#[tauri::command]
fn control_start() -> Result<Daemon, String> {
    run(&["control", "http", DAEMON_ADDR, "--allowed-origins", ORIGINS])?;
    let token = run(&["control", "token"])?;
    Ok(Daemon {
        url: format!("http://{DAEMON_ADDR}"),
        token,
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![control_start])
        .run(tauri::generate_context!())
        .expect("the NepFleet window failed to start");
}
