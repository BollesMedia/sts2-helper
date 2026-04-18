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

#[derive(Debug)]
pub enum FetchOutcome {
    Ok {
        mode: Mode,
        body: serde_json::Value,
    },
    HttpError {
        status: u16,
        message: String,
    },
    Network(String),
}

/// Fetch once against `base_url`, honoring a single 409 mode-swap retry.
/// Extracted so tests can point at a wiremock server without global state.
pub(crate) async fn fetch_once_against(
    client: &reqwest::Client,
    base_url: &str,
    starting_mode: Mode,
) -> FetchOutcome {
    let mut mode = starting_mode;
    let url = format!("{base_url}{}", endpoint_path(mode));

    let first = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return FetchOutcome::Network(e.to_string()),
    };

    if first.status().as_u16() == 409 {
        mode = mode.toggle();
        let retry_url = format!("{base_url}{}", endpoint_path(mode));
        let retry = match client.get(&retry_url).send().await {
            Ok(r) => r,
            Err(e) => return FetchOutcome::Network(e.to_string()),
        };
        if !retry.status().is_success() {
            return FetchOutcome::HttpError {
                status: retry.status().as_u16(),
                message: format!("STS2MCP responded with {}", retry.status().as_u16()),
            };
        }
        return match retry.json::<serde_json::Value>().await {
            Ok(body) => FetchOutcome::Ok { mode, body },
            Err(e) => FetchOutcome::Network(format!("json parse: {e}")),
        };
    }

    if !first.status().is_success() {
        return FetchOutcome::HttpError {
            status: first.status().as_u16(),
            message: format!("STS2MCP responded with {}", first.status().as_u16()),
        };
    }

    match first.json::<serde_json::Value>().await {
        Ok(body) => FetchOutcome::Ok { mode, body },
        Err(e) => FetchOutcome::Network(format!("json parse: {e}")),
    }
}

fn endpoint_path(mode: Mode) -> &'static str {
    match mode {
        Mode::Singleplayer => "/api/v1/singleplayer",
        Mode::Multiplayer => "/api/v1/multiplayer",
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

    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn fetch_once(
        client: &reqwest::Client,
        base_url: &str,
        mode: Mode,
    ) -> FetchOutcome {
        super::fetch_once_against(client, base_url, mode).await
    }

    #[tokio::test]
    async fn fetch_once_swaps_mode_on_409_and_retries() {
        let server = MockServer::start().await;

        // singleplayer → 409
        Mock::given(method("GET"))
            .and(path("/api/v1/singleplayer"))
            .respond_with(ResponseTemplate::new(409))
            .mount(&server)
            .await;

        // multiplayer → 200 with a minimal state_type body
        Mock::given(method("GET"))
            .and(path("/api/v1/multiplayer"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "state_type": "menu"
            })))
            .mount(&server)
            .await;

        let client = reqwest::Client::new();
        let out = fetch_once(&client, &server.uri(), Mode::Singleplayer).await;

        match out {
            FetchOutcome::Ok { mode, body } => {
                assert_eq!(mode, Mode::Multiplayer);
                assert_eq!(body.get("state_type").and_then(|v| v.as_str()), Some("menu"));
            }
            other => panic!("expected Ok, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_once_returns_err_on_non_409_http_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/singleplayer"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = reqwest::Client::new();
        let out = fetch_once(&client, &server.uri(), Mode::Singleplayer).await;
        match out {
            FetchOutcome::HttpError { status, .. } => assert_eq!(status, 500),
            other => panic!("expected HttpError, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_once_returns_network_err_when_server_down() {
        let client = reqwest::Client::new();
        let out = fetch_once(&client, "http://127.0.0.1:1", Mode::Singleplayer).await;
        assert!(matches!(out, FetchOutcome::Network(_)));
    }
}
