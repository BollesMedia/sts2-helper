//! Pure parsing for STS2 save files. No I/O beyond the file read for each
//! path passed in. Tolerant of schema-version drift via `#[serde(default)]`
//! on all optional fields.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RunSummary {
    pub start_time: i64,
    pub seed: String,
    pub ascension: u32,
    pub character: String,
    pub win: bool,
    pub was_abandoned: bool,
    pub killed_by_encounter: String,
    pub run_time: u32,
    pub build_id: String,
    pub act_reached: u32,
    pub players_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActiveRun {
    pub start_time: i64,
    pub seed: String,
    pub ascension: u32,
    pub character: String,
    pub is_mp: bool,
}

#[derive(Debug, Error)]
pub enum SaveError {
    #[error("save file not found: {0}")]
    NotFound(String),
    #[error("save file i/o: {0}")]
    Io(#[from] std::io::Error),
    #[error("save file parse: schema_version={schema_version:?} path={path}: {source}")]
    Parse {
        path: String,
        schema_version: Option<u32>,
        #[source]
        source: serde_json::Error,
    },
}

/// Raw shape of a `history/<start_time>.run` file — only fields we need.
/// Everything else is tolerated via `#[serde(default)]`.
#[derive(Deserialize)]
struct RawRunFile {
    start_time: i64,
    #[serde(default)]
    seed: String,
    #[serde(default)]
    ascension: u32,
    #[serde(default)]
    win: bool,
    #[serde(default)]
    was_abandoned: bool,
    #[serde(default)]
    killed_by_encounter: String,
    #[serde(default)]
    run_time: u32,
    #[serde(default)]
    build_id: String,
    #[serde(default)]
    schema_version: Option<u32>,
    #[serde(default)]
    players: Vec<RawPlayer>,
    #[serde(default)]
    map_point_history: Vec<Vec<serde_json::Value>>,
}

#[derive(Deserialize, Default)]
struct RawPlayer {
    #[serde(default)]
    character: String,
}

pub fn parse_run_file(path: &Path) -> Result<RunSummary, SaveError> {
    let bytes = std::fs::read(path)?;
    let path_str = path.to_string_lossy().to_string();

    // Peek at schema_version even if the full parse fails, for better errors.
    let peeked_version: Option<u32> = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|v| v.get("schema_version").and_then(|x| x.as_u64()).map(|n| n as u32));

    let raw: RawRunFile = serde_json::from_slice(&bytes).map_err(|e| SaveError::Parse {
        path: path_str.clone(),
        schema_version: peeked_version,
        source: e,
    })?;

    let character = raw
        .players
        .first()
        .map(|p| p.character.clone())
        .unwrap_or_default();

    let act_reached = raw.map_point_history.len() as u32;

    Ok(RunSummary {
        start_time: raw.start_time,
        seed: raw.seed,
        ascension: raw.ascension,
        character,
        win: raw.win,
        was_abandoned: raw.was_abandoned,
        killed_by_encounter: raw.killed_by_encounter,
        run_time: raw.run_time,
        build_id: raw.build_id,
        act_reached,
        players_count: raw.players.len() as u32,
    })
}

pub fn parse_active_save(path: &Path) -> Result<ActiveRun, SaveError> {
    let bytes = std::fs::read(path)?;
    let path_str = path.to_string_lossy().to_string();
    let peeked_version: Option<u32> = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|v| v.get("schema_version").and_then(|x| x.as_u64()).map(|n| n as u32));

    let raw: RawRunFile = serde_json::from_slice(&bytes).map_err(|e| SaveError::Parse {
        path: path_str.clone(),
        schema_version: peeked_version,
        source: e,
    })?;

    let character = raw
        .players
        .first()
        .map(|p| p.character.clone())
        .unwrap_or_default();

    Ok(ActiveRun {
        start_time: raw.start_time,
        seed: raw.seed,
        ascension: raw.ascension,
        character,
        is_mp: raw.players.len() > 1,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct RunHistoryListing {
    pub entries: Vec<RunSummary>,
    pub skipped: u32,
}

#[tauri::command]
pub async fn get_active_run_identifier() -> Result<Option<ActiveRun>, String> {
    let saves_dir = match crate::save_dir::resolve_saves_dir(None) {
        Ok(d) => d,
        Err(e) => {
            log::info!("[save_file] saves dir unavailable: {e}");
            return Ok(None);
        }
    };

    // Prefer current_run.save (SP); fall back to current_run_mp.save (MP).
    for name in ["current_run.save", "current_run_mp.save"] {
        let path = saves_dir.join(name);
        if path.exists() {
            match parse_active_save(&path) {
                Ok(active) => return Ok(Some(active)),
                Err(e) => {
                    log::warn!("[save_file] parse {} failed: {e}", name);
                    continue;
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn list_run_history(
    after_start_time: Option<i64>,
) -> Result<RunHistoryListing, String> {
    let saves_dir = match crate::save_dir::resolve_saves_dir(None) {
        Ok(d) => d,
        Err(e) => {
            log::info!("[save_file] saves dir unavailable: {e}");
            return Ok(RunHistoryListing {
                entries: vec![],
                skipped: 0,
            });
        }
    };
    let history_dir = saves_dir.join("history");
    if !history_dir.exists() {
        return Ok(RunHistoryListing {
            entries: vec![],
            skipped: 0,
        });
    }

    let threshold = after_start_time.unwrap_or(0);
    let mut entries: Vec<RunSummary> = vec![];
    let mut skipped: u32 = 0;

    let dir_entries = match std::fs::read_dir(&history_dir) {
        Ok(it) => it,
        Err(e) => return Err(format!("read_dir {}: {e}", history_dir.display())),
    };

    for entry in dir_entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("run") {
            continue;
        }
        // Filename is the start_time; use as a cheap pre-filter before parsing.
        let stem: Option<i64> = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse().ok());
        if let Some(ts) = stem {
            if ts <= threshold {
                continue;
            }
        }
        match parse_run_file(&path) {
            Ok(summary) => {
                if summary.start_time > threshold {
                    entries.push(summary);
                }
            }
            Err(e) => {
                log::warn!("[save_file] skip {}: {e}", path.display());
                skipped += 1;
            }
        }
    }

    entries.sort_by_key(|s| s.start_time);
    Ok(RunHistoryListing { entries, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    #[test]
    fn parse_run_file_ok_for_sp_win() {
        let summary = parse_run_file(&fixture("sp_win.run")).expect("parse");
        assert_eq!(summary.win, true);
        assert_eq!(summary.was_abandoned, false);
        assert_eq!(summary.killed_by_encounter, "NONE.NONE");
        assert_eq!(summary.players_count, 1);
        assert!(summary.start_time > 0);
        assert!(!summary.seed.is_empty());
    }

    #[test]
    fn parse_run_file_ok_for_sp_death() {
        let summary = parse_run_file(&fixture("sp_death.run")).expect("parse");
        assert_eq!(summary.win, false);
        assert_eq!(summary.was_abandoned, false);
        assert_ne!(summary.killed_by_encounter, "NONE.NONE");
        assert_eq!(summary.players_count, 1);
    }

    #[test]
    fn parse_run_file_ok_for_sp_abandon() {
        let summary = parse_run_file(&fixture("sp_abandon.run")).expect("parse");
        assert_eq!(summary.win, false);
        assert_eq!(summary.was_abandoned, true);
        assert_eq!(summary.players_count, 1);
    }

    #[test]
    fn parse_run_file_err_on_corrupt_json() {
        let err = parse_run_file(&fixture("corrupt.run")).unwrap_err();
        assert!(matches!(err, SaveError::Parse { .. }), "got {err:?}");
    }

    #[test]
    fn parse_active_save_detects_singleplayer() {
        let active = parse_active_save(&fixture("sp_win.run")).expect("parse");
        // Reusing sp_win.run as a stand-in for current_run.save shape.
        assert_eq!(active.is_mp, false);
        assert!(active.start_time > 0);
    }

    #[test]
    fn parse_active_save_detects_multiplayer() {
        let active = parse_active_save(&fixture("current_run_mp.save")).expect("parse");
        assert_eq!(active.is_mp, true, "len(players) > 1 should imply MP");
    }

    #[test]
    fn parse_active_save_err_on_corrupt() {
        let err = parse_active_save(&fixture("corrupt.run")).unwrap_err();
        assert!(matches!(err, SaveError::Parse { .. }));
    }
}
