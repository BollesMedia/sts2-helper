//! STS2 save directory resolution. On macOS, STS2 writes saves under
//! `~/Library/Application Support/SlayTheSpire2/steam/<steam_user_id>/modded/profile1/saves`.
//! On Windows, the parent is `%APPDATA%\SlayTheSpire2` instead.
//!
//! Tests inject a fake home directory via the `sts2_home` parameter; production
//! callers pass `None` to use the real one.

use std::path::{Path, PathBuf};

use crate::save_file::SaveError;

/// Returns the `saves/` directory inside the active (numeric) steam user
/// subdirectory, choosing `modded/profile1/saves` first and falling back to
/// `profile1/saves` if modded doesn't exist.
pub fn resolve_saves_dir(home_override: Option<&Path>) -> Result<PathBuf, SaveError> {
    let base = sts2_root(home_override)?;
    let steam_dir = base.join("steam");
    if !steam_dir.exists() {
        return Err(SaveError::NotFound(format!(
            "sts2 steam dir not found at {}",
            steam_dir.display()
        )));
    }

    // Pick the MOST-RECENTLY-MODIFIED subdirectory whose name is an all-digit
    // steam user id. Users with alt accounts have multiple numeric dirs; the
    // currently-active one will be freshest. Falling back to lowest-numeric
    // would silently point at the wrong account.
    let mut candidates: Vec<(PathBuf, std::time::SystemTime)> =
        std::fs::read_dir(&steam_dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
                    .unwrap_or(false)
            })
            .filter_map(|p| {
                let mtime = std::fs::metadata(&p).ok()?.modified().ok()?;
                Some((p, mtime))
            })
            .collect();
    if candidates.len() > 1 {
        log::warn!(
            "[save_dir] {} candidate steam user dirs under {}; picking most recent",
            candidates.len(),
            steam_dir.display()
        );
    }
    candidates.sort_by_key(|(_, t)| *t);
    let user_dir = candidates.pop().map(|(p, _)| p).ok_or_else(|| {
        SaveError::NotFound(format!(
            "no numeric steam user id under {}",
            steam_dir.display()
        ))
    })?;

    let modded = user_dir.join("modded/profile1/saves");
    if modded.exists() {
        return Ok(modded);
    }
    let plain = user_dir.join("profile1/saves");
    if plain.exists() {
        return Ok(plain);
    }
    Err(SaveError::NotFound(format!(
        "no saves directory under {}",
        user_dir.display()
    )))
}

fn sts2_root(home_override: Option<&Path>) -> Result<PathBuf, SaveError> {
    let home = match home_override {
        Some(p) => p.to_path_buf(),
        None => dirs::home_dir()
            .ok_or_else(|| SaveError::NotFound("home directory unavailable".into()))?,
    };

    #[cfg(target_os = "macos")]
    {
        Ok(home.join("Library/Application Support/SlayTheSpire2"))
    }
    #[cfg(target_os = "windows")]
    {
        // When home_override is provided, tests lay out AppData directly inside it.
        if home_override.is_some() {
            Ok(home.join("AppData/Roaming/SlayTheSpire2"))
        } else {
            Ok(home.join("AppData\\Roaming\\SlayTheSpire2"))
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(SaveError::NotFound(format!(
            "sts2 save dir not defined on this platform"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_layout(home: &Path) {
        let base: PathBuf;
        #[cfg(target_os = "macos")]
        {
            base = home.join("Library/Application Support/SlayTheSpire2/steam/987654321/modded/profile1/saves");
        }
        #[cfg(target_os = "windows")]
        {
            base = home.join("AppData/Roaming/SlayTheSpire2/steam/987654321/modded/profile1/saves");
        }
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(base.join("history")).unwrap();
    }

    #[test]
    fn resolves_saves_dir_for_modded_layout() {
        let tmp = TempDir::new().unwrap();
        make_layout(tmp.path());
        let dir = resolve_saves_dir(Some(tmp.path())).expect("resolve");
        assert!(dir.ends_with("modded/profile1/saves") || dir.ends_with("modded\\profile1\\saves"));
    }

    #[test]
    fn returns_not_found_when_no_steam_dir() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_saves_dir(Some(tmp.path())).unwrap_err();
        assert!(matches!(err, SaveError::NotFound(_)));
    }

    #[test]
    fn picks_numeric_steam_user_dir_ignoring_others() {
        let tmp = TempDir::new().unwrap();
        make_layout(tmp.path());
        // Add a non-numeric sibling that must be ignored
        let extra;
        #[cfg(target_os = "macos")]
        {
            extra = tmp.path().join("Library/Application Support/SlayTheSpire2/steam/not_numeric");
        }
        #[cfg(target_os = "windows")]
        {
            extra = tmp.path().join("AppData/Roaming/SlayTheSpire2/steam/not_numeric");
        }
        std::fs::create_dir_all(&extra).unwrap();
        resolve_saves_dir(Some(tmp.path())).expect("resolve");
    }
}
