//! `GET /realtime/ws`: one WebSocket per app, push only.
//!
//! Protocol, JSON text frames tagged by `type`:
//!
//! - client `auth {token}` first, within 5 s. The token is the same Supabase
//!   JWT the HTTP routes take. Sent as a message, not in the URL, so it never
//!   lands in a request log. Server answers `ready {user_id}`.
//! - client `subscribe {topic}` / `unsubscribe {topic}`. Topics are
//!   `{kind: "user" | "live_session" | "shared_playlist", id}`. Access is checked
//!   per subscribe; server answers `subscribed` or `error`.
//! - client `ping {id}`, server `pong {id, server_time_ms}`, for keepalive and
//!   for the client's clock offset.
//! - server `event {topic, version, kind, data}` on every change, and
//!   `lagged {topic}` when this socket fell behind, which means refetch.
//!
//! The socket closes when the token expires, so the client reconnects with a
//! fresh one.

use std::{collections::HashMap, time::Duration};

use axum::{
    Router,
    extract::{
        State,
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
    routing::get,
};
use axum_jwt_auth::Decoder;
use chrono::Utc;
use sea_orm::{DatabaseConnection, prelude::Uuid};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{broadcast::error::RecvError, mpsc},
    task::JoinHandle,
};

use crate::{
    AppState,
    auth::SupabaseClaims,
    services::realtime::{Event, SharedEventBus, Topic, access::can_subscribe},
};

/// How long a new socket has to send `auth`.
const AUTH_TIMEOUT: Duration = Duration::from_secs(5);

/// The most topics one socket can hold at once.
const MAX_SUBSCRIPTIONS: usize = 200;

/// Close code for a policy problem: bad auth, or the token expired.
const CLOSE_POLICY: u16 = 4001;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Auth { token: String },
    Subscribe { topic: Topic },
    Unsubscribe { topic: Topic },
    Ping { id: Option<u64> },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    Ready {
        user_id: Uuid,
    },
    Subscribed {
        topic: Topic,
    },
    Unsubscribed {
        topic: Topic,
    },
    Error {
        message: String,
        topic: Option<Topic>,
    },
    Pong {
        id: Option<u64>,
        server_time_ms: i64,
    },
    Event {
        #[serde(flatten)]
        event: Event,
    },
    Lagged {
        topic: Topic,
    },
}

/// Upgrades to the realtime socket. Auth happens over the socket, see the
/// module docs.
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(db): State<DatabaseConnection>,
    State(decoder): State<Decoder<SupabaseClaims>>,
    State(bus): State<SharedEventBus>,
) -> Response {
    ws.on_upgrade(move |socket| run_socket(socket, db, decoder, bus))
}

async fn send(socket: &mut WebSocket, message: &ServerMessage) -> bool {
    match serde_json::to_string(message) {
        Ok(text) => socket.send(Message::Text(text.into())).await.is_ok(),
        Err(_) => true,
    }
}

async fn close(mut socket: WebSocket, reason: &str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: CLOSE_POLICY,
            reason: reason.to_owned().into(),
        })))
        .await;
}

/// Waits for `auth` and returns the user and when their token expires.
async fn authenticate(
    socket: &mut WebSocket,
    decoder: &Decoder<SupabaseClaims>,
) -> Option<(Uuid, i64)> {
    let first = tokio::time::timeout(AUTH_TIMEOUT, socket.recv())
        .await
        .ok()??
        .ok()?;
    let Message::Text(text) = first else {
        return None;
    };
    let Ok(ClientMessage::Auth { token }) = serde_json::from_str(&text) else {
        return None;
    };
    let claims = decoder.decode(&token).await.ok()?.claims;
    Some((claims.user_id, claims.expiration as i64))
}

async fn run_socket(
    mut socket: WebSocket,
    db: DatabaseConnection,
    decoder: Decoder<SupabaseClaims>,
    bus: SharedEventBus,
) {
    let Some((user_id, expires_at)) = authenticate(&mut socket, &decoder).await else {
        close(socket, "auth failed").await;
        return;
    };
    if !send(&mut socket, &ServerMessage::Ready { user_id }).await {
        return;
    }

    let until_expiry = (expires_at - Utc::now().timestamp()).max(0) as u64;
    let expiry = tokio::time::sleep(Duration::from_secs(until_expiry));
    tokio::pin!(expiry);

    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();
    let mut subscriptions: HashMap<Topic, JoinHandle<()>> = HashMap::new();

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else { break };
                let text = match message {
                    Message::Text(text) => text,
                    Message::Close(_) => break,
                    _ => continue,
                };
                let reply = match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Subscribe { topic }) => {
                        subscribe(&db, &bus, user_id, topic, &mut subscriptions, &tx).await
                    }
                    Ok(ClientMessage::Unsubscribe { topic }) => {
                        if let Some(task) = subscriptions.remove(&topic) {
                            task.abort();
                        }
                        ServerMessage::Unsubscribed { topic }
                    }
                    Ok(ClientMessage::Ping { id }) => ServerMessage::Pong {
                        id,
                        server_time_ms: Utc::now().timestamp_millis(),
                    },
                    Ok(ClientMessage::Auth { .. }) => ServerMessage::Error {
                        message: "already authenticated".into(),
                        topic: None,
                    },
                    Err(err) => ServerMessage::Error {
                        message: format!("could not read that message: {err}"),
                        topic: None,
                    },
                };
                if !send(&mut socket, &reply).await {
                    break;
                }
            }
            Some(outgoing) = rx.recv() => {
                if !send(&mut socket, &outgoing).await {
                    break;
                }
            }
            _ = &mut expiry => {
                close(socket, "token expired").await;
                for task in subscriptions.into_values() {
                    task.abort();
                }
                return;
            }
        }
    }

    for task in subscriptions.into_values() {
        task.abort();
    }
}

/// Checks access and starts forwarding the topic's events into `tx`.
async fn subscribe(
    db: &DatabaseConnection,
    bus: &SharedEventBus,
    user_id: Uuid,
    topic: Topic,
    subscriptions: &mut HashMap<Topic, JoinHandle<()>>,
    tx: &mpsc::UnboundedSender<ServerMessage>,
) -> ServerMessage {
    if subscriptions.contains_key(&topic) {
        return ServerMessage::Subscribed { topic };
    }
    if subscriptions.len() >= MAX_SUBSCRIPTIONS {
        return ServerMessage::Error {
            message: format!("at most {MAX_SUBSCRIPTIONS} subscriptions per socket"),
            topic: Some(topic),
        };
    }
    match can_subscribe(db, user_id, &topic).await {
        Ok(true) => {}
        Ok(false) => {
            return ServerMessage::Error {
                message: "not allowed".into(),
                topic: Some(topic),
            };
        }
        Err(err) => {
            return ServerMessage::Error {
                message: err.to_string(),
                topic: Some(topic),
            };
        }
    }

    let mut events = bus.subscribe(&topic);
    let tx = tx.clone();
    let forwarded = topic.clone();
    let task = tokio::spawn(async move {
        loop {
            let message = match events.recv().await {
                Ok(event) => ServerMessage::Event { event },
                Err(RecvError::Lagged(_)) => ServerMessage::Lagged {
                    topic: forwarded.clone(),
                },
                Err(RecvError::Closed) => break,
            };
            if tx.send(message).is_err() {
                break;
            }
        }
    });
    subscriptions.insert(topic.clone(), task);
    ServerMessage::Subscribed { topic }
}

pub fn get_realtime_router() -> Router<AppState> {
    Router::new().route("/ws", get(ws_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_messages_read_by_type() {
        let msg: ClientMessage = serde_json::from_str(
            r#"{"type":"subscribe","topic":{"kind":"live_session","id":"00000000-0000-0000-0000-000000000001"}}"#,
        )
        .unwrap();
        assert!(matches!(
            msg,
            ClientMessage::Subscribe {
                topic: Topic::LiveSession(_)
            }
        ));
    }

    #[test]
    fn events_go_out_flat() {
        let message = ServerMessage::Event {
            event: Event::new(Topic::SharedPlaylist(3), 9, "songs"),
        };
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["type"], "event");
        assert_eq!(json["version"], 9);
        assert_eq!(json["topic"]["kind"], "shared_playlist");
        assert_eq!(json["kind"], "songs");
    }
}
