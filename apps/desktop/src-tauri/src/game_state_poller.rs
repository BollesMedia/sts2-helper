//! Background poller that fetches STS2MCP game state and pushes it to the
//! frontend via Tauri events. Owns mode (single vs multi) and per-state_type
//! polling cadence so the JS side doesn't have to run a timer.

use serde::Serialize;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Mode {
    Singleplayer,
    Multiplayer,
}

impl Mode {
    pub fn toggle(self) -> Self {
        match self {
            Mode::Singleplayer => Mode::Multiplayer,
            Mode::Multiplayer => Mode::Singleplayer,
        }
    }
}

/// Returns how long to wait before the NEXT fetch, given the last fetch outcome.
pub fn next_interval(state_type: Option<&str>, had_error: bool) -> Duration {
    if had_error {
        return Duration::from_millis(3000);
    }
    match state_type {
        Some("monster") | Some("elite") | Some("boss") | Some("hand_select") => {
            Duration::from_millis(500)
        }
        Some("combat_rewards") | Some("card_reward") | Some("shop") | Some("event")
        | Some("card_select") | Some("relic_select") | Some("overlay") => {
            Duration::from_millis(2000)
        }
        Some("map") | Some("rest_site") | Some("treasure") => Duration::from_millis(3000),
        Some("menu") => Duration::from_millis(5000),
        Some(_) => Duration::from_millis(2000), // known-other → default
        None => Duration::from_millis(5000),    // no data yet → offline
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_500ms_for_combat_states() {
        for st in ["monster", "elite", "boss", "hand_select"] {
            assert_eq!(
                next_interval(Some(st), false),
                Duration::from_millis(500),
                "{st}"
            );
        }
    }

    #[test]
    fn interval_3000ms_on_error_regardless_of_state() {
        assert_eq!(next_interval(Some("monster"), true), Duration::from_millis(3000));
        assert_eq!(next_interval(None, true), Duration::from_millis(3000));
    }

    #[test]
    fn interval_5000ms_when_no_state_yet() {
        assert_eq!(next_interval(None, false), Duration::from_millis(5000));
    }

    #[test]
    fn interval_defaults_to_2000ms_for_unknown_state() {
        assert_eq!(
            next_interval(Some("totally_new_state"), false),
            Duration::from_millis(2000)
        );
    }

    #[test]
    fn mode_toggle_round_trips() {
        assert_eq!(Mode::Singleplayer.toggle(), Mode::Multiplayer);
        assert_eq!(Mode::Multiplayer.toggle().toggle(), Mode::Multiplayer);
    }
}
