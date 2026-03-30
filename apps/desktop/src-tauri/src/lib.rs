mod mods;
mod steam;

use mods::{GameInfo, InstallOutcome, InstallResult, ModError, ModStatus};

#[tauri::command]
async fn detect_game() -> Result<GameInfo, ModError> {
    let game_path = steam::find_game_path();
    let game_running = steam::is_game_running();

    match &game_path {
        Some(path) => {
            let mods_dir = steam::get_mods_dir(path);
            Ok(GameInfo {
                found: steam::verify_game_exists(path),
                path: Some(path.to_string_lossy().to_string()),
                mods_dir: Some(mods_dir.to_string_lossy().to_string()),
                game_running,
            })
        }
        None => Ok(GameInfo {
            found: false,
            path: None,
            mods_dir: None,
            game_running,
        }),
    }
}

#[tauri::command]
async fn get_mod_status() -> Result<ModStatus, ModError> {
    let game_path = steam::find_game_path();

    match &game_path {
        Some(path) => {
            let mods_dir = steam::get_mods_dir(path);
            let required = mods::detect::check_required_mods(&mods_dir);
            let all_mods = mods::detect::list_installed_mods(&mods_dir);
            let conflicts = mods::detect::check_conflicts(&mods_dir);

            let other_mods: Vec<_> = all_mods
                .into_iter()
                .filter(|m| m.id != "STS2_MCP" && m.id != "UnifiedSavePath")
                .collect();

            Ok(ModStatus {
                game_found: steam::verify_game_exists(path),
                game_path: Some(path.to_string_lossy().to_string()),
                mods_dir: Some(mods_dir.to_string_lossy().to_string()),
                game_running: steam::is_game_running(),
                required_mods: required,
                other_mods,
                conflicts,
            })
        }
        None => Ok(ModStatus {
            game_found: false,
            game_path: None,
            mods_dir: None,
            game_running: false,
            required_mods: vec![],
            other_mods: vec![],
            conflicts: vec![],
        }),
    }
}

#[tauri::command]
async fn install_required_mods(app: tauri::AppHandle) -> Result<InstallResult, ModError> {
    let game_path = steam::find_game_path().ok_or(ModError::GameNotFound)?;

    if steam::is_game_running() {
        return Err(ModError::GameRunning);
    }

    let mods_dir = steam::get_mods_dir(&game_path);

    let sts2mcp_result = match mods::install::install_sts2mcp(&mods_dir, &app).await {
        Ok(outcome) => outcome,
        Err(e) => {
            log::error!("STS2MCP install failed: {}", e);
            InstallOutcome::Failed(e.to_string())
        }
    };

    let unified_result = match mods::install::install_unified_save_path(&mods_dir, &app).await {
        Ok(outcome) => outcome,
        Err(e) => {
            log::error!("UnifiedSavePath install failed: {}", e);
            InstallOutcome::Failed(e.to_string())
        }
    };

    Ok(InstallResult {
        sts2mcp: sts2mcp_result,
        unified_save_path: unified_result,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            detect_game,
            get_mod_status,
            install_required_mods,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
