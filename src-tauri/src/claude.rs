use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

const APP_CWD: &str = "/Users/bohdanburukhin/Projects/personal/paddock-ai";

#[derive(Default)]
pub struct ClaudeState {
    inner: Arc<Mutex<Inner>>,
}

impl ClaudeState {
    pub fn handle(&self) -> Arc<Mutex<Inner>> {
        self.inner.clone()
    }
}

#[derive(Default)]
pub struct Inner {
    binary_path: Option<String>,
    running: Option<RunHandle>,
}

struct RunHandle {
    stop_tx: Option<oneshot::Sender<()>>,
    started_at_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct ClaudeStatus {
    pub running: bool,
    pub started_at_ms: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Lifecycle {
    Started { started_at_ms: u64 },
    Exited { exit_code: Option<i32> },
    Error { message: String },
    Stderr { message: String },
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// macOS GUI apps inherit a minimal PATH that excludes nvm/npm-global. Ask a login shell.
async fn resolve_binary() -> Result<String, String> {
    let out = Command::new("/bin/zsh")
        .args(["-ilc", "command -v claude"])
        .output()
        .await
        .map_err(|e| format!("failed to invoke zsh: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "could not locate `claude` via login shell (exit {}): {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        return Err("`claude` not found on PATH (tried login shell)".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn claude_run(
    prompt: String,
    state: State<'_, ClaudeState>,
    app: AppHandle,
) -> Result<(), String> {
    let inner_arc = state.inner.clone();
    let mut inner = inner_arc.lock().await;

    if inner.running.is_some() {
        return Err("a run is already in progress".into());
    }

    if inner.binary_path.is_none() {
        inner.binary_path = Some(resolve_binary().await?);
    }
    let binary = inner.binary_path.clone().expect("binary path set above");

    let mut child = Command::new(&binary)
        .current_dir(APP_CWD)
        .args([
            "-p",
            &prompt,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--include-hook-events",
            "--permission-mode",
            "bypassPermissions",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout pipe missing")?;
    let stderr = child.stderr.take().ok_or("stderr pipe missing")?;

    let started_at_ms = now_ms();
    let _ = app.emit(
        "claude:lifecycle",
        Lifecycle::Started { started_at_ms },
    );

    // stdout: each line is one stream-json event.
    let app_stdout = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let payload = serde_json::from_str::<serde_json::Value>(&line)
                        .unwrap_or_else(|_| serde_json::json!({ "type": "raw", "line": line }));
                    let _ = app_stdout.emit("claude:event", payload);
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = app_stdout.emit(
                        "claude:lifecycle",
                        Lifecycle::Error {
                            message: format!("stdout read error: {e}"),
                        },
                    );
                    break;
                }
            }
        }
    });

    // stderr: forward each line as a lifecycle event for visibility.
    let app_stderr = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stderr.emit(
                "claude:lifecycle",
                Lifecycle::Stderr { message: line },
            );
        }
    });

    // Wait/stop task owns the Child and is the sole writer to inner.running on exit.
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let app_exit = app.clone();
    let state_arc = inner_arc.clone();
    tauri::async_runtime::spawn(async move {
        let exit_code = tokio::select! {
            wait = child.wait() => wait.ok().and_then(|s| s.code()),
            _ = stop_rx => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                None
            }
        };
        {
            let mut inner = state_arc.lock().await;
            inner.running = None;
        }
        let _ = app_exit.emit("claude:lifecycle", Lifecycle::Exited { exit_code });
    });

    inner.running = Some(RunHandle {
        stop_tx: Some(stop_tx),
        started_at_ms,
    });
    Ok(())
}

#[tauri::command]
pub async fn claude_stop(state: State<'_, ClaudeState>) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    let handle = inner
        .running
        .as_mut()
        .ok_or_else(|| "no run is in progress".to_string())?;
    if let Some(tx) = handle.stop_tx.take() {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn claude_status(state: State<'_, ClaudeState>) -> Result<ClaudeStatus, String> {
    let inner = state.inner.lock().await;
    Ok(ClaudeStatus {
        running: inner.running.is_some(),
        started_at_ms: inner.running.as_ref().map(|h| h.started_at_ms),
    })
}

// Called from window-close handler. Signals stop without awaiting confirmation.
pub fn signal_stop_blocking(state: Arc<Mutex<Inner>>) {
    tauri::async_runtime::block_on(async move {
        let mut inner = state.lock().await;
        if let Some(handle) = inner.running.as_mut() {
            if let Some(tx) = handle.stop_tx.take() {
                let _ = tx.send(());
            }
        }
    });
}
