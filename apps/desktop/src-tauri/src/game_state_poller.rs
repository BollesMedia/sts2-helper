//! Background poller that fetches STS2MCP game state and pushes it to the
//! frontend via Tauri events. Owns mode (single vs multi) and per-state_type
//! polling cadence so the JS side doesn't have to run a timer.

use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

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

/// Read an HTTP error response body, capped at 16 KB and decoded lossily as
/// UTF-8. Returns a descriptive placeholder on read failure rather than
/// silently dropping the body. The cap protects against a misbehaving server
/// returning an unbounded payload; real MCP error bodies are < 1 KB JSON.
const MAX_ERROR_BODY_BYTES: usize = 16 * 1024;

async fn read_error_body(resp: reqwest::Response) -> String {
    match resp.bytes().await {
        Ok(bytes) => {
            let slice = if bytes.len() > MAX_ERROR_BODY_BYTES {
                &bytes[..MAX_ERROR_BODY_BYTES]
            } else {
                &bytes[..]
            };
            String::from_utf8_lossy(slice).into_owned()
        }
        Err(e) => format!("(failed to read response body: {e})"),
    }
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
            let status = retry.status().as_u16();
            // Capture the response body so the JS side can pattern-match it
            // (e.g., to detect MissingMethodException → "MCP mod incompatible
            // with current STS2 version" UX). Bounded to ~16KB to avoid
            // unbounded memory growth on a misbehaving server.
            let body = read_error_body(retry).await;
            return FetchOutcome::HttpError { status, message: body };
        }
        return match retry.json::<serde_json::Value>().await {
            Ok(body) => FetchOutcome::Ok { mode, body },
            Err(e) => FetchOutcome::Network(format!("json parse: {e}")),
        };
    }

    if !first.status().is_success() {
        let status = first.status().as_u16();
        let body = read_error_body(first).await;
        return FetchOutcome::HttpError { status, message: body };
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

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
pub enum PollResult {
    #[serde(rename = "ok")]
    Ok { data: serde_json::Value },
    #[serde(rename = "error")]
    Error { status: String, message: String },
}

#[derive(Default)]
pub struct PollerState {
    pub latest: RwLock<Option<PollResult>>,
}

pub type PollerHandle = Arc<PollerState>;

pub fn spawn_poller(app: AppHandle, base_url: String) {
    let state: PollerHandle = Arc::new(PollerState::default());
    app.manage(state.clone());

    // Supervisor: if run_poll_loop panics (or returns, which it shouldn't),
    // log and respawn after a 1s backoff so a transient bug doesn't leave the
    // app stuck on NOT_READY with no visible clue.
    tauri::async_runtime::spawn(async move {
        loop {
            let app_c = app.clone();
            let url_c = base_url.clone();
            let state_c = state.clone();
            let handle = tokio::spawn(async move {
                run_poll_loop(app_c, url_c, state_c).await;
            });
            match handle.await {
                Ok(()) => {
                    log::error!("[poller] run_poll_loop exited; restarting in 1s")
                }
                Err(e) if e.is_panic() => {
                    log::error!("[poller] run_poll_loop panicked: {e}; restarting in 1s")
                }
                Err(e) => {
                    log::error!("[poller] run_poll_loop cancelled: {e}; restarting in 1s")
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

async fn run_poll_loop(app: AppHandle, base_url: String, state: PollerHandle) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .expect("reqwest client build");

    let mut mode = Mode::Singleplayer;

    loop {
        let outcome = fetch_once_against(&client, &base_url, mode).await;

        let (next_state_type, had_error, poll_result) = match outcome {
            FetchOutcome::Ok { mode: new_mode, body } => {
                mode = new_mode;
                let state_type = body
                    .get("state_type")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let result = PollResult::Ok { data: body };
                (state_type, false, result)
            }
            FetchOutcome::HttpError { status, message } => (
                None,
                true,
                PollResult::Error {
                    status: status.to_string(),
                    message,
                },
            ),
            FetchOutcome::Network(msg) => (
                None,
                true,
                PollResult::Error {
                    status: "FETCH_ERROR".to_string(),
                    message: msg,
                },
            ),
        };

        *state.latest.write().await = Some(poll_result.clone());

        let event_name = match &poll_result {
            PollResult::Ok { .. } => "game-state-updated",
            PollResult::Error { .. } => "game-state-error",
        };
        if let Err(e) = app.emit(event_name, &poll_result) {
            log::warn!("[poller] emit {event_name} failed: {e}");
        }

        tokio::time::sleep(next_interval(next_state_type.as_deref(), had_error)).await;
    }
}

#[tauri::command]
pub async fn get_latest_game_state(
    state: tauri::State<'_, PollerHandle>,
) -> Result<PollResult, String> {
    match state.latest.read().await.clone() {
        Some(result) => Ok(result),
        None => Ok(PollResult::Error {
            status: "NOT_READY".to_string(),
            message: "Poller has not completed a fetch yet".to_string(),
        }),
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

    /// HttpError.message must carry the actual response body so the JS layer
    /// can pattern-match it (e.g. detect `MissingMethodException` and switch
    /// the connection banner to "MCP mod incompatible with current STS2
    /// version" instead of the generic "make sure the game is running").
    #[tokio::test]
    async fn fetch_once_carries_response_body_in_http_error_message() {
        let server = MockServer::start().await;
        let body = r#"{"error":"Failed to read game state: Method not found: 'Boolean MegaCrit.Sts2.Core.Combat.CombatManager.get_IsPlayPhase()'.","exception_type":"System.MissingMethodException"}"#;
        Mock::given(method("GET"))
            .and(path("/api/v1/singleplayer"))
            .respond_with(ResponseTemplate::new(500).set_body_string(body))
            .mount(&server)
            .await;

        let client = reqwest::Client::new();
        let out = fetch_once(&client, &server.uri(), Mode::Singleplayer).await;
        match out {
            FetchOutcome::HttpError { status, message } => {
                assert_eq!(status, 500);
                assert!(
                    message.contains("MissingMethodException"),
                    "expected body to be captured in message, got: {message}"
                );
            }
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
