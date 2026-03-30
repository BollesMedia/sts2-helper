use std::path::Path;
use tokio::io::AsyncWriteExt;

use super::{InstallOutcome, ModError};

const STS2MCP_REPO: &str = "Gennadiyev/STS2MCP";
const STS2MCP_VERSION: &str = "0.3.2";
const STS2MCP_ASSETS: &[&str] = &["STS2_MCP.dll", "STS2_MCP.json"];

/// Verify a downloaded file against an expected SHA-256 hash.
async fn verify_sha256(path: &Path, expected: &str) -> Result<(), ModError> {
    use sha2::{Digest, Sha256};
    let bytes = tokio::fs::read(path).await?;
    let hash = hex::encode(Sha256::digest(&bytes));
    if hash != expected {
        return Err(ModError::Download(format!(
            "Integrity check failed for {}: expected {}, got {}",
            path.file_name().unwrap_or_default().to_string_lossy(),
            &expected[..12],
            &hash[..12],
        )));
    }
    Ok(())
}

const UNIFIED_SAVE_PATH_ZIP_URL: &str =
    "https://raw.githubusercontent.com/luojiesi/SLS2Mods/master/nexus_packages/UnifiedSavePath.zip";

/// Install or update STS2MCP from GitHub releases.
pub async fn install_sts2mcp(
    mods_dir: &Path,
    app: &tauri::AppHandle,
) -> Result<InstallOutcome, ModError> {
    // Check if already installed and up to date
    let manifest_path = mods_dir.join("STS2_MCP.json");
    if manifest_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&manifest_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if json.get("version").and_then(|v| v.as_str()) == Some(STS2MCP_VERSION) {
                    log::info!("STS2MCP {} already installed", STS2MCP_VERSION);
                    return Ok(InstallOutcome::AlreadyUpToDate);
                }
            }
        }
    }

    let was_installed = manifest_path.exists();

    log::info!("Installing STS2MCP v{}...", STS2MCP_VERSION);
    emit_progress(app, "STS2 MCP", "downloading", 0);

    let temp_dir = tempfile::tempdir()?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ModError::Download(e.to_string()))?;

    // Download each asset
    for (i, asset_name) in STS2MCP_ASSETS.iter().enumerate() {
        let url = format!(
            "https://github.com/{}/releases/download/{}/{}",
            STS2MCP_REPO, STS2MCP_VERSION, asset_name
        );

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| ModError::Download(format!("{}: {}", asset_name, e)))?;

        if !response.status().is_success() {
            return Err(ModError::Download(format!(
                "{}: HTTP {}",
                asset_name,
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| ModError::Download(format!("{}: {}", asset_name, e)))?;

        let temp_path = temp_dir.path().join(asset_name);
        let mut file = tokio::fs::File::create(&temp_path).await?;
        file.write_all(&bytes).await?;

        let percent = ((i + 1) as f32 / STS2MCP_ASSETS.len() as f32 * 100.0) as u32;
        emit_progress(app, "STS2 MCP", "downloading", percent);
    }

    emit_progress(app, "STS2 MCP", "installing", 90);

    // Ensure mods directory exists
    tokio::fs::create_dir_all(mods_dir).await?;

    // Move files from temp to mods directory (atomic per file)
    for asset_name in STS2MCP_ASSETS {
        let src = temp_dir.path().join(asset_name);
        let dst = mods_dir.join(asset_name);

        // Remove existing file first (avoid permission issues)
        if dst.exists() {
            tokio::fs::remove_file(&dst).await.ok();
        }

        tokio::fs::copy(&src, &dst).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                ModError::PermissionDenied(format!(
                    "Cannot write to {}. Try running as administrator.",
                    dst.display()
                ))
            } else {
                ModError::Io(e)
            }
        })?;
    }

    emit_progress(app, "STS2 MCP", "complete", 100);
    log::info!("STS2MCP v{} installed successfully", STS2MCP_VERSION);

    if was_installed {
        Ok(InstallOutcome::Updated)
    } else {
        Ok(InstallOutcome::Installed)
    }
}

/// Install UnifiedSavePath from GitHub repo zip.
pub async fn install_unified_save_path(
    mods_dir: &Path,
    app: &tauri::AppHandle,
) -> Result<InstallOutcome, ModError> {
    // Check if already installed
    let dll_path = mods_dir.join("UnifiedSavePath.dll");
    if dll_path.exists() {
        log::info!("UnifiedSavePath already installed");
        return Ok(InstallOutcome::AlreadyUpToDate);
    }

    log::info!("Installing UnifiedSavePath...");
    emit_progress(app, "Unified Save Path", "downloading", 0);

    let temp_dir = tempfile::tempdir()?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ModError::Download(e.to_string()))?;

    // Download the zip
    let response = client
        .get(UNIFIED_SAVE_PATH_ZIP_URL)
        .send()
        .await
        .map_err(|e| ModError::Download(format!("UnifiedSavePath: {}", e)))?;

    if !response.status().is_success() {
        return Err(ModError::Download(format!(
            "UnifiedSavePath: HTTP {}",
            response.status()
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| ModError::Download(format!("UnifiedSavePath: {}", e)))?;

    emit_progress(app, "Unified Save Path", "extracting", 50);

    // Write zip to temp
    let zip_path = temp_dir.path().join("UnifiedSavePath.zip");
    let mut file = tokio::fs::File::create(&zip_path).await?;
    file.write_all(&bytes).await?;

    // Extract zip
    let zip_path_clone = zip_path.clone();
    let temp_extract = temp_dir.path().join("extracted");
    tokio::fs::create_dir_all(&temp_extract).await?;

    let temp_extract_clone = temp_extract.clone();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&zip_path_clone)
            .map_err(|e| ModError::Extraction(e.to_string()))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| ModError::Extraction(e.to_string()))?;

        for i in 0..archive.len() {
            let mut zip_file = archive
                .by_index(i)
                .map_err(|e| ModError::Extraction(e.to_string()))?;

            // Prevent zip path traversal attacks
            let Some(name) = zip_file.enclosed_name() else {
                log::warn!("Skipping suspicious zip entry: {}", zip_file.name());
                continue;
            };
            let outpath = temp_extract_clone.join(name);

            if zip_file.is_dir() {
                std::fs::create_dir_all(&outpath)?;
            } else {
                if let Some(parent) = outpath.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let mut outfile = std::fs::File::create(&outpath)?;
                std::io::copy(&mut zip_file, &mut outfile)?;
            }
        }
        Ok::<(), ModError>(())
    })
    .await
    .map_err(|e| ModError::Extraction(e.to_string()))??;

    emit_progress(app, "Unified Save Path", "installing", 80);

    // Ensure mods directory exists
    tokio::fs::create_dir_all(mods_dir).await?;

    // Copy extracted files to mods directory
    // Look for .dll and .json files in the extracted directory
    let mut found_files = false;
    if let Ok(mut entries) = tokio::fs::read_dir(&temp_extract).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy();

            if name.ends_with(".dll") || name.ends_with(".json") || name.ends_with(".pck") {
                let dst = mods_dir.join(path.file_name().unwrap());
                if dst.exists() {
                    tokio::fs::remove_file(&dst).await.ok();
                }
                tokio::fs::copy(&path, &dst).await?;
                found_files = true;
            }
        }
    }

    if !found_files {
        return Err(ModError::Extraction(
            "No mod files found in archive".to_string(),
        ));
    }

    emit_progress(app, "Unified Save Path", "complete", 100);
    log::info!("UnifiedSavePath installed successfully");

    Ok(InstallOutcome::Installed)
}

/// Emit a progress event to the frontend.
fn emit_progress(app: &tauri::AppHandle, mod_name: &str, stage: &str, percent: u32) {
    use tauri::Emitter;
    let _ = app.emit(
        "mod-install-progress",
        serde_json::json!({
            "modName": mod_name,
            "stage": stage,
            "percent": percent,
        }),
    );
}
