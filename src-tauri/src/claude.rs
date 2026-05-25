use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

static AGENT_COUNTER: AtomicU64 = AtomicU64::new(1);
static APP_CWD: OnceLock<PathBuf> = OnceLock::new();

fn app_cwd() -> &'static Path {
    APP_CWD.get_or_init(|| {
        if let Ok(p) = std::env::var("PADDOCK_CWD") {
            let buf = PathBuf::from(p);
            if !buf.as_os_str().is_empty() {
                return buf;
            }
        }
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    })
}

fn next_agent_id() -> String {
    let n = AGENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("agent-{n}")
}

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
    running: HashMap<String, RunHandle>,
}

struct RunHandle {
    stop_tx: Option<oneshot::Sender<()>>,
    started_at_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct AgentStatus {
    pub agent_id: String,
    pub started_at_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum LifecycleKind {
    Started { started_at_ms: u64 },
    Exited { exit_code: Option<i32> },
    Error { message: String },
    Stderr { message: String },
}

#[derive(Serialize, Clone)]
struct LifecycleEvent {
    agent_id: String,
    #[serde(flatten)]
    payload: LifecycleKind,
}

#[derive(Serialize, Clone)]
struct StreamEvent {
    agent_id: String,
    payload: serde_json::Value,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

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

async fn spawn_run(
    binary: String,
    prompt: String,
    resume_session: Option<String>,
    model: Option<String>,
    agent_id: String,
    inner_arc: Arc<Mutex<Inner>>,
    app: AppHandle,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        prompt,
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
        "--include-hook-events".into(),
        "--permission-mode".into(),
        "bypassPermissions".into(),
    ];
    if let Some(session) = resume_session {
        args.push("--resume".into());
        args.push(session);
    }
    if let Some(m) = model {
        args.push("--model".into());
        args.push(m);
    }

    let mut child = Command::new(&binary)
        .current_dir(app_cwd())
        .args(&args)
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
        LifecycleEvent {
            agent_id: agent_id.clone(),
            payload: LifecycleKind::Started { started_at_ms },
        },
    );

    let app_stdout = app.clone();
    let agent_id_stdout = agent_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let payload = serde_json::from_str::<serde_json::Value>(&line)
                        .unwrap_or_else(|_| serde_json::json!({ "type": "raw", "line": line }));
                    let _ = app_stdout.emit(
                        "claude:event",
                        StreamEvent {
                            agent_id: agent_id_stdout.clone(),
                            payload,
                        },
                    );
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = app_stdout.emit(
                        "claude:lifecycle",
                        LifecycleEvent {
                            agent_id: agent_id_stdout.clone(),
                            payload: LifecycleKind::Error {
                                message: format!("stdout read error: {e}"),
                            },
                        },
                    );
                    break;
                }
            }
        }
    });

    let app_stderr = app.clone();
    let agent_id_stderr = agent_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stderr.emit(
                "claude:lifecycle",
                LifecycleEvent {
                    agent_id: agent_id_stderr.clone(),
                    payload: LifecycleKind::Stderr { message: line },
                },
            );
        }
    });

    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let app_exit = app.clone();
    let state_arc = inner_arc.clone();
    let agent_id_exit = agent_id.clone();
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
            inner.running.remove(&agent_id_exit);
        }
        let _ = app_exit.emit(
            "claude:lifecycle",
            LifecycleEvent {
                agent_id: agent_id_exit,
                payload: LifecycleKind::Exited { exit_code },
            },
        );
    });

    let mut inner = inner_arc.lock().await;
    inner.running.insert(
        agent_id,
        RunHandle {
            stop_tx: Some(stop_tx),
            started_at_ms,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn claude_run(
    prompt: String,
    model: Option<String>,
    state: State<'_, ClaudeState>,
    app: AppHandle,
) -> Result<String, String> {
    let inner_arc = state.inner.clone();
    {
        let mut inner = inner_arc.lock().await;
        if inner.binary_path.is_none() {
            inner.binary_path = Some(resolve_binary().await?);
        }
    }
    let binary = {
        let inner = inner_arc.lock().await;
        inner.binary_path.clone().expect("binary path set above")
    };
    let agent_id = next_agent_id();
    spawn_run(binary, prompt, None, model, agent_id.clone(), inner_arc, app).await?;
    Ok(agent_id)
}

#[tauri::command]
pub async fn claude_followup(
    agent_id: String,
    prompt: String,
    session_id: String,
    state: State<'_, ClaudeState>,
    app: AppHandle,
) -> Result<(), String> {
    let inner_arc = state.inner.clone();
    {
        let inner = inner_arc.lock().await;
        if inner.running.contains_key(&agent_id) {
            return Err(format!("agent {agent_id} is already running"));
        }
    }
    {
        let mut inner = inner_arc.lock().await;
        if inner.binary_path.is_none() {
            inner.binary_path = Some(resolve_binary().await?);
        }
    }
    let binary = {
        let inner = inner_arc.lock().await;
        inner.binary_path.clone().expect("binary path set above")
    };
    spawn_run(binary, prompt, Some(session_id), None, agent_id, inner_arc, app).await
}

#[tauri::command]
pub async fn claude_stop(
    agent_id: String,
    state: State<'_, ClaudeState>,
) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    let handle = inner
        .running
        .get_mut(&agent_id)
        .ok_or_else(|| format!("no run with id {agent_id}"))?;
    if let Some(tx) = handle.stop_tx.take() {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn claude_status(state: State<'_, ClaudeState>) -> Result<Vec<AgentStatus>, String> {
    let inner = state.inner.lock().await;
    Ok(inner
        .running
        .iter()
        .map(|(id, h)| AgentStatus {
            agent_id: id.clone(),
            started_at_ms: h.started_at_ms,
        })
        .collect())
}

pub fn signal_stop_blocking(state: Arc<Mutex<Inner>>) {
    tauri::async_runtime::block_on(async move {
        let mut inner = state.lock().await;
        for (_, handle) in inner.running.iter_mut() {
            if let Some(tx) = handle.stop_tx.take() {
                let _ = tx.send(());
            }
        }
    });
}
