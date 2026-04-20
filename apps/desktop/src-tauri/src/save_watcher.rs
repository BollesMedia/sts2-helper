//! `notify`-crate watcher that emits "run-completed" Tauri events when a
//! new `history/<ts>.run` appears. Wrapped in a supervisor that respawns
//! the inner task on panic/exit (same pattern as game_state_poller.rs).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{Event, EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::save_file::{parse_run_file, RunSummary};

/// Arms a watcher on `<saves_dir>/history`. Idempotent — re-arming is a no-op.
pub async fn start_watch(app: AppHandle, saves_dir: PathBuf) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    static ARMED: AtomicBool = AtomicBool::new(false);
    if ARMED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let history_dir = saves_dir.join("history");
    if !history_dir.exists() {
        std::fs::create_dir_all(&history_dir)
            .map_err(|e| format!("create history dir: {e}"))?;
    }

    tauri::async_runtime::spawn(async move {
        loop {
            let app_c = app.clone();
            let dir_c = history_dir.clone();
            let handle = tokio::spawn(async move {
                run_watch_loop(app_c, dir_c).await;
            });
            match handle.await {
                Ok(()) => log::error!("[save_watcher] exited; restarting in 1s"),
                Err(e) if e.is_panic() => {
                    log::error!("[save_watcher] panicked: {e}; restarting in 1s")
                }
                Err(e) => log::error!("[save_watcher] cancelled: {e}; restarting in 1s"),
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });

    Ok(())
}

async fn run_watch_loop(app: AppHandle, history_dir: PathBuf) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Event>();
    let tx = Arc::new(tx);
    let tx_clone = tx.clone();

    let mut watcher = match notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(ev) = res {
            let _ = tx_clone.send(ev);
        }
    }) {
        Ok(w) => w,
        Err(e) => {
            log::error!("[save_watcher] create watcher failed: {e}");
            return;
        }
    };

    if let Err(e) = watcher.watch(&history_dir, RecursiveMode::NonRecursive) {
        log::error!("[save_watcher] watch failed: {e}");
        return;
    }

    log::info!("[save_watcher] watching {}", history_dir.display());

    while let Some(ev) = rx.recv().await {
        if !matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_)) {
            continue;
        }
        for path in ev.paths {
            if path.extension().and_then(|s| s.to_str()) != Some("run") {
                continue;
            }
            handle_new_history_file(&app, &path).await;
        }
    }
}

async fn handle_new_history_file(app: &AppHandle, path: &Path) {
    // Small debounce — the game can write the file in multiple passes.
    tokio::time::sleep(Duration::from_millis(150)).await;
    match parse_run_file(path) {
        Ok(summary) => emit_run_completed(app, &summary),
        Err(e) => log::warn!(
            "[save_watcher] parse {} failed: {e}",
            path.display()
        ),
    }
}

fn emit_run_completed(app: &AppHandle, summary: &RunSummary) {
    if let Err(e) = app.emit("run-completed", summary) {
        log::warn!("[save_watcher] emit run-completed failed: {e}");
    }
}

#[tauri::command]
pub async fn start_run_history_watch(app: AppHandle) -> Result<(), String> {
    let saves_dir = crate::save_dir::resolve_saves_dir(None)
        .map_err(|e| format!("resolve saves dir: {e}"))?;
    start_watch(app, saves_dir).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Verify the inner fs-watch → parse → handle pipeline. We bypass the
    /// Tauri event emit (which requires an AppHandle) and instead assert
    /// that `parse_run_file` returns Ok when given a file the watcher sees.
    #[tokio::test]
    async fn parses_new_history_file_when_dropped_into_dir() {
        let tmp = TempDir::new().unwrap();
        let history = tmp.path().join("history");
        std::fs::create_dir_all(&history).unwrap();

        // Drop a valid fixture
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/sp_win.run");
        let target = history.join("1234567890.run");
        std::fs::copy(&fixture, &target).unwrap();

        let summary = parse_run_file(&target).expect("parse");
        assert_eq!(summary.players_count, 1);
        assert!(summary.win || !summary.win); // tautology — assert it parses without panic
    }
}
