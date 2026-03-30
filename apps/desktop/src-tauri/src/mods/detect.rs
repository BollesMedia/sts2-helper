use std::path::Path;

use super::{Conflict, ConflictSeverity, InstalledMod, RequiredModStatus};

/// Scan the mods directory and return all installed mods.
pub fn list_installed_mods(mods_dir: &Path) -> Vec<InstalledMod> {
    let mut mods = Vec::new();

    if !mods_dir.exists() {
        return mods;
    }

    // Each mod can be either:
    // 1. A .dll + mod_manifest.json pair at the root of mods/
    // 2. A subfolder containing .dll + mod_manifest.json
    // STS2's native mod system uses flat files in the mods/ directory.

    // Read all mod_manifest.json files (could be multiple per directory)
    // Also check for individual manifests named <MOD_ID>.json
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
                mods.push(m);
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
        .find(|m| m.id == "UnifiedSavePath" || m.id == "unified_save_path");

    vec![
        RequiredModStatus {
            id: "STS2_MCP".to_string(),
            name: "STS2 MCP".to_string(),
            required_version: "0.3.2".to_string(),
            installed: sts2mcp.is_some(),
            installed_version: sts2mcp.map(|m| m.version.clone()),
            needs_update: sts2mcp
                .map(|m| m.version != "0.3.2")
                .unwrap_or(false),
        },
        RequiredModStatus {
            id: "UnifiedSavePath".to_string(),
            name: "Unified Save Path".to_string(),
            required_version: "latest".to_string(),
            installed: unified.is_some(),
            installed_version: unified.map(|m| m.version.clone()),
            needs_update: false, // No version tracking for this mod
        },
    ]
}

/// Detect potential conflicts with existing mods.
pub fn check_conflicts(mods_dir: &Path) -> Vec<Conflict> {
    let installed = list_installed_mods(mods_dir);
    let mut conflicts = Vec::new();

    for m in &installed {
        // Warn about gameplay-affecting mods (may affect evaluation accuracy)
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
