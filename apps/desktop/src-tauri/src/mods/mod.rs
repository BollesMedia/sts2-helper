pub mod detect;
pub mod install;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A mod found in the game's mods directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledMod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub affects_gameplay: bool,
    pub path: PathBuf,
}

/// Status of a required mod.
#[derive(Debug, Clone, Serialize)]
pub struct RequiredModStatus {
    pub id: String,
    pub name: String,
    pub required_version: String,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub needs_update: bool,
}

/// Overall mod status for the setup wizard.
#[derive(Debug, Clone, Serialize)]
pub struct ModStatus {
    pub game_found: bool,
    pub game_path: Option<String>,
    pub mods_dir: Option<String>,
    pub game_running: bool,
    pub required_mods: Vec<RequiredModStatus>,
    pub other_mods: Vec<InstalledMod>,
    pub conflicts: Vec<Conflict>,
}

/// A detected conflict between mods.
#[derive(Debug, Clone, Serialize)]
pub struct Conflict {
    pub mod_id: String,
    pub mod_name: String,
    pub reason: String,
    pub severity: ConflictSeverity,
}

#[derive(Debug, Clone, Serialize)]
pub enum ConflictSeverity {
    Warning,
    Error,
}

/// Result of an install operation.
#[derive(Debug, Clone, Serialize)]
pub struct InstallResult {
    pub sts2mcp: InstallOutcome,
    pub unified_save_path: InstallOutcome,
}

#[derive(Debug, Clone, Serialize)]
pub enum InstallOutcome {
    Installed,
    AlreadyUpToDate,
    Updated,
    Failed(String),
}

/// Game info returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct GameInfo {
    pub found: bool,
    pub path: Option<String>,
    pub mods_dir: Option<String>,
    pub game_running: bool,
}

/// Error type for mod operations.
#[derive(Debug, thiserror::Error)]
pub enum ModError {
    #[error("Steam installation not found")]
    SteamNotFound,
    #[error("Slay the Spire 2 not found in any Steam library")]
    GameNotFound,
    #[error("Game is currently running — close it before installing mods")]
    GameRunning,
    #[error("Failed to download: {0}")]
    Download(String),
    #[error("Failed to extract archive: {0}")]
    Extraction(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
}

impl Serialize for ModError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
