use std::path::PathBuf;

/// Find the Steam root directory.
pub fn find_steam_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| h.join("Library/Application Support/Steam"))
    }

    #[cfg(target_os = "windows")]
    {
        find_steam_root_windows()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn find_steam_root_windows() -> Option<PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let steam_key = hkcu.open_subkey("Software\\Valve\\Steam").ok()?;
    let path: String = steam_key.get_value("SteamPath").ok()?;
    Some(PathBuf::from(path))
}

/// Find the STS2 game installation by parsing Steam library folders.
pub fn find_game_path() -> Option<PathBuf> {
    let steam_root = find_steam_root()?;
    let vdf_path = steam_root.join("steamapps/libraryfolders.vdf");

    if !vdf_path.exists() {
        log::warn!("libraryfolders.vdf not found at {:?}", vdf_path);
        return None;
    }

    let vdf_content = std::fs::read_to_string(&vdf_path).ok()?;
    let library_paths = parse_library_paths(&vdf_content);

    for library_path in library_paths {
        let game_dir = library_path.join("steamapps/common/Slay the Spire 2");
        if game_dir.exists() {
            log::info!("Found STS2 at {:?}", game_dir);
            return Some(game_dir);
        }
    }

    log::warn!("STS2 not found in any Steam library");
    None
}

/// Parse library folder paths from libraryfolders.vdf content.
/// The VDF format is Valve's KeyValues format — we parse it simply
/// by looking for "path" keys rather than using a full VDF parser,
/// since the structure is simple and well-known.
fn parse_library_paths(content: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut in_library = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // Detect library entries (numbered keys like "0", "1", etc.)
        if trimmed.starts_with('"') && trimmed.ends_with('"') {
            let key = trimmed.trim_matches('"');
            if key.parse::<u32>().is_ok() {
                in_library = true;
            }
        }

        // Extract path values
        if in_library && trimmed.starts_with("\"path\"") {
            if let Some(path_str) = extract_vdf_value(trimmed) {
                paths.push(PathBuf::from(path_str));
                in_library = false;
            }
        }
    }

    paths
}

/// Extract a value from a VDF key-value pair like: "key"  "value"
fn extract_vdf_value(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.splitn(2, "\"path\"").collect();
    if parts.len() < 2 {
        return None;
    }
    let rest = parts[1].trim();
    if rest.starts_with('"') {
        let end = rest[1..].find('"')?;
        Some(rest[1..1 + end].replace("\\\\", "\\"))
    } else {
        None
    }
}

/// Get the mods directory for the detected game path.
pub fn get_mods_dir(game_path: &std::path::Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        game_path.join("SlayTheSpire2.app/Contents/MacOS/mods")
    }

    #[cfg(target_os = "windows")]
    {
        game_path.join("mods")
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        game_path.join("mods")
    }
}

/// Check if the game executable exists at the detected path.
pub fn verify_game_exists(game_path: &std::path::Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        game_path
            .join("SlayTheSpire2.app/Contents/MacOS/Slay the Spire 2")
            .exists()
    }

    #[cfg(target_os = "windows")]
    {
        game_path.join("SlayTheSpire2.exe").exists()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

/// Check if STS2 is currently running.
pub fn is_game_running() -> bool {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for process in sys.processes().values() {
        let name = process.name().to_string_lossy().to_lowercase();
        if name.contains("slay the spire 2") || name.contains("slaythespire2") {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_library_paths() {
        let vdf = r#"
"libraryfolders"
{
    "0"
    {
        "path"		"/Users/test/Library/Application Support/Steam"
        "apps"
        {
            "2868840"		"0"
        }
    }
    "1"
    {
        "path"		"/Volumes/Games/SteamLibrary"
        "apps"
        {
            "440"		"0"
        }
    }
}
"#;
        let paths = parse_library_paths(vdf);
        assert_eq!(paths.len(), 2);
        assert!(paths[0].to_string_lossy().contains("Steam"));
        assert!(paths[1].to_string_lossy().contains("Games"));
    }
}
