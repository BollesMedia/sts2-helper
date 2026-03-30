use std::path::Path;

use super::{Conflict, ConflictSeverity, InstalledMod, RequiredModStatus};

pub const STS2MCP_REQUIRED_VERSION: &str = "0.3.2";

/// Scan the mods directory and return all installed mods.
pub fn list_installed_mods(mods_dir: &Path) -> Vec<InstalledMod> {
    let mut mods = Vec::new();

    if !mods_dir.exists() {
        return mods;
    }

    let entries = match std::fs::read_dir(mods_dir) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!("Failed to read mods directory: {}", e);
            return mods;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // Look for .json files that could be mod manifests
        if path.extension().is_some_and(|e| e == "json") {
            if let Some(m) = parse_mod_manifest(&path) {
                // Avoid duplicates (mod_manifest.json and STS2_MCP.json could both exist)
                if !mods.iter().any(|existing: &InstalledMod| existing.id == m.id) {
                    mods.push(m);
                }
            }
        }
    }

    // Also detect mods by their .dll files even without a manifest
    // (some mods are just a .dll dropped in the folder)
    if let Ok(entries) = std::fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "dll") {
                let stem = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if !mods.iter().any(|m| m.id == stem) {
                    mods.push(InstalledMod {
                        id: stem.clone(),
                        name: stem,
                        version: "unknown".to_string(),
                        affects_gameplay: false,
                        path,
                    });
                }
            }
        }
    }

    mods
}

/// Parse a mod manifest JSON file.
fn parse_mod_manifest(path: &Path) -> Option<InstalledMod> {
    let content = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;

    let id = json.get("id")?.as_str()?.to_string();
    let name = json
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&id)
        .to_string();
    let version = json
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let affects_gameplay = json
        .get("affects_gameplay")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    Some(InstalledMod {
        id,
        name,
        version,
        affects_gameplay,
        path: path.to_path_buf(),
    })
}

/// Check the status of required mods.
pub fn check_required_mods(mods_dir: &Path) -> Vec<RequiredModStatus> {
    let installed = list_installed_mods(mods_dir);

    let sts2mcp = installed.iter().find(|m| m.id == "STS2_MCP");
    let unified = installed
        .iter()
        .find(|m| {
            m.id == "UnifiedSavePath"
                || m.id == "unified_save_path"
                || m.id == "UnifiedSavePath"
        });

    // Also check if saves are already synced (manually or via the mod)
    let saves_synced = check_saves_synced();

    vec![
        RequiredModStatus {
            id: "STS2_MCP".to_string(),
            name: "STS2 MCP".to_string(),
            required_version: STS2MCP_REQUIRED_VERSION.to_string(),
            installed: sts2mcp.is_some(),
            installed_version: sts2mcp.map(|m| m.version.clone()),
            needs_update: sts2mcp
                .map(|m| m.version != STS2MCP_REQUIRED_VERSION)
                .unwrap_or(false),
        },
        RequiredModStatus {
            id: "UnifiedSavePath".to_string(),
            name: "Unified Save Path".to_string(),
            required_version: "latest".to_string(),
            installed: unified.is_some() || saves_synced,
            installed_version: if saves_synced && unified.is_none() {
                Some("synced manually".to_string())
            } else {
                unified.map(|m| m.version.clone())
            },
            needs_update: false,
        },
    ]
}

/// Check if modded and unmodded saves are already synced.
/// This handles the case where the user manually copied saves
/// or the saves happen to be in the same location.
fn check_saves_synced() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Check if modded save directory has real content
        // (not just the default empty save)
        let save_base = dirs::home_dir()
            .map(|h| h.join("Library/Application Support/SlayTheSpire2"));

        if let Some(base) = save_base {
            // Find any steam user directory
            let steam_dir = base.join("steam");
            if let Ok(entries) = std::fs::read_dir(&steam_dir) {
                for entry in entries.flatten() {
                    let user_dir = entry.path();
                    let modded_progress = user_dir.join("modded/profile1/saves/progress.save");
                    let unmodded_progress = user_dir.join("profile1/saves/progress.save");

                    // If both exist and modded has real content, saves are synced
                    if modded_progress.exists() && unmodded_progress.exists() {
                        if let (Ok(modded_meta), Ok(unmodded_meta)) = (
                            std::fs::metadata(&modded_progress),
                            std::fs::metadata(&unmodded_progress),
                        ) {
                            // If modded save is substantial (>10KB), consider it synced
                            if modded_meta.len() > 10000 && unmodded_meta.len() > 10000 {
                                return true;
                            }
                        }
                    }
                }
            }
        }
        false
    }

    #[cfg(not(target_os = "macos"))]
    {
        false // On Windows, UnifiedSavePath handles this
    }
}

/// Detect potential conflicts with existing mods.
pub fn check_conflicts(mods_dir: &Path) -> Vec<Conflict> {
    let installed = list_installed_mods(mods_dir);
    let mut conflicts = Vec::new();

    for m in &installed {
        if m.affects_gameplay && m.id != "STS2_MCP" && m.id != "UnifiedSavePath" {
            conflicts.push(Conflict {
                mod_id: m.id.clone(),
                mod_name: m.name.clone(),
                reason: "This mod affects gameplay, which may reduce evaluation accuracy"
                    .to_string(),
                severity: ConflictSeverity::Warning,
            });
        }
    }

    conflicts
}
