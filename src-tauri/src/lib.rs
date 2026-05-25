mod claude;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(claude::ClaudeState::default())
        .invoke_handler(tauri::generate_handler![
            claude::claude_run,
            claude::claude_followup,
            claude::claude_stop,
            claude::claude_status,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<claude::ClaudeState>();
                claude::signal_stop_blocking(state.handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
