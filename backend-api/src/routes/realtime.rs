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
    response::{IntoResponse, Response},
    routing::get,
};
use axum_jwt_auth::Decoder;
use chrono::Utc;
use sea_orm::{DatabaseConnection, prelude::Uuid};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{Semaphore, broadcast::error::RecvError, mpsc},
    task::JoinHandle,
};

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::live_sessions::{self, AppLink},
    err::CadenzaError,
    lifecycle::BackgroundTasks,
    services::realtime::{
        Event, EventKind, SharedEventBus, SharedPresence, Topic,
        access::{can_receive, can_subscribe},
        limits::{CONNECTIONS, UserSlot},
        publish_user,
    },
};

/// How long a new socket has to send `auth`.
const AUTH_TIMEOUT: Duration = Duration::from_secs(5);

/// A socket that sends nothing for this long is dropped. The client pings
/// every 25 s, so only a phone that is gone, frozen, or offline goes quiet.
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// The most topics one socket can hold at once.
const MAX_SUBSCRIPTIONS: usize = 200;
const MESSAGE_BYTES: usize = 16 * 1024;
const QUEUED_EVENTS: usize = 64;
const SEND_TIMEOUT: Duration = Duration::from_secs(5);
const ACCESS_TIMEOUT: Duration = Duration::from_secs(10);
const MESSAGES_PER_MINUTE: u32 = 300;

#[derive(Default)]
struct Subscriptions(HashMap<Topic, JoinHandle<()>>);
impl Drop for Subscriptions {
    fn drop(&mut self) {
        for task in self.0.values() {
            task.abort();
        }
    }
}

struct SocketObservation;
impl Drop for SocketObservation {
    fn drop(&mut self) {
        crate::metrics::global().realtime_connections.dec();
    }
}

struct MessageWindow {
    started: tokio::time::Instant,
    used: u32,
}
impl MessageWindow {
    fn new() -> Self {
        Self {
            started: tokio::time::Instant::now(),
            used: 0,
        }
    }
    fn allow(&mut self) -> bool {
        if self.started.elapsed() >= Duration::from_secs(60) {
            self.started = tokio::time::Instant::now();
            self.used = 0;
        }
        self.used += 1;
        self.used <= MESSAGES_PER_MINUTE
    }
}

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
    State(presence): State<SharedPresence>,
    State(work): State<BackgroundTasks>,
) -> Response {
    static SLOTS: Semaphore = Semaphore::const_new(CONNECTIONS);
    let Ok(permit) = SLOTS.try_acquire() else {
        crate::metrics::global()
            .refusals
            .with_label_values(&["realtime_capacity"])
            .inc();
        return CadenzaError::ServiceUnavailable.into_response();
    };
    ws.max_message_size(MESSAGE_BYTES)
        .max_frame_size(MESSAGE_BYTES)
        .write_buffer_size(0)
        .max_write_buffer_size(MESSAGE_BYTES * 2)
        .on_upgrade(move |socket| async move {
            let _ = work
                .clone()
                .spawn(async move {
                    let _permit = permit;
                    crate::metrics::global().realtime_connections.inc();
                    let _observation = SocketObservation;
                    let Some((user_id, link)) = run_socket(
                        socket,
                        db.clone(),
                        decoder,
                        bus.clone(),
                        presence.clone(),
                        work.clone(),
                    )
                    .await
                    else {
                        return;
                    };
                    if presence.disconnect(user_id) {
                        publish_user(&bus, user_id, EventKind::Presence);
                        // a host who closed the app: their session ends in a minute, and a
                        // member leaves theirs
                        if let Err(err) = live_sessions::set_app_link(&db, user_id, link).await {
                            eprintln!("realtime: could not mark {user_id} away: {err}");
                        }
                    }
                })
                .await;
        })
}

async fn send(socket: &mut WebSocket, message: &ServerMessage) -> bool {
    match serde_json::to_string(message) {
        Ok(text) => matches!(
            tokio::time::timeout(SEND_TIMEOUT, socket.send(Message::Text(text.into()))).await,
            Ok(Ok(()))
        ),
        Err(_) => true,
    }
}

async fn close(mut socket: WebSocket, reason: &str) {
    let _ = tokio::time::timeout(
        SEND_TIMEOUT,
        socket.send(Message::Close(Some(CloseFrame {
            code: CLOSE_POLICY,
            reason: reason.to_owned().into(),
        }))),
    )
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

/// Runs one socket to its end. Returns the user once they authenticated, who
/// was counted online for its whole life and is the caller's to count off,
/// and how it ended: closed by the phone, or gone quiet past [`IDLE_TIMEOUT`].
async fn run_socket(
    mut socket: WebSocket,
    db: DatabaseConnection,
    decoder: Decoder<SupabaseClaims>,
    bus: SharedEventBus,
    presence: SharedPresence,
    work: BackgroundTasks,
) -> Option<(Uuid, AppLink)> {
    let authenticated = tokio::select! {
        biased;
        _ = work.cancelled() => return None,
        result = tokio::time::timeout(AUTH_TIMEOUT, authenticate(&mut socket, &decoder)) => result.ok().flatten(),
    };
    let Some((user_id, expires_at)) = authenticated else {
        close(socket, "auth failed").await;
        return None;
    };
    let Some(_user_slot) = UserSlot::acquire(user_id) else {
        crate::metrics::global()
            .refusals
            .with_label_values(&["realtime_user_capacity"])
            .inc();
        close(socket, "too many connections").await;
        return None;
    };
    if presence.connect(user_id) {
        publish_user(&bus, user_id, EventKind::Presence);
        if let Err(err) = live_sessions::set_app_link(&db, user_id, AppLink::Back).await {
            eprintln!("realtime: could not mark {user_id} back: {err}");
        }
    }
    if !send(&mut socket, &ServerMessage::Ready { user_id }).await {
        return Some((user_id, AppLink::Closed));
    }

    let until_expiry = (expires_at - Utc::now().timestamp()).max(0) as u64;
    let (link, reason) = tokio::select! {
        biased;
        _ = work.cancelled() => (AppLink::Quiet, "server shutting down"),
        _ = tokio::time::sleep(Duration::from_secs(until_expiry)) => (AppLink::Quiet, "token expired"),
        link = socket_loop(&mut socket, &db, &bus, user_id) => (link, "connection closed"),
    };
    close(socket, reason).await;
    Some((user_id, link))
}

async fn socket_loop(
    socket: &mut WebSocket,
    db: &DatabaseConnection,
    bus: &SharedEventBus,
    user_id: Uuid,
) -> AppLink {
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(QUEUED_EVENTS);
    let mut subscriptions = Subscriptions::default();
    let mut messages = MessageWindow::new();

    let idle = tokio::time::sleep(IDLE_TIMEOUT);
    tokio::pin!(idle);
    // how it ended: the phone closing it, unless it went quiet
    let mut link = AppLink::Closed;

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else { break };
                if !messages.allow() {
                    crate::metrics::global().refusals.with_label_values(&["realtime_message_quota"]).inc();
                    break;
                }
                idle.as_mut().reset(tokio::time::Instant::now() + IDLE_TIMEOUT);
                let text = match message {
                    Message::Text(text) => text,
                    Message::Close(_) => break,
                    _ => continue,
                };
                let reply = match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Subscribe { topic }) => {
                        subscribe(db, bus, user_id, topic, &mut subscriptions.0, &tx).await
                    }
                    Ok(ClientMessage::Unsubscribe { topic }) => {
                        if let Some(task) = subscriptions.0.remove(&topic) {
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
                    Err(_) => ServerMessage::Error {
                        message: "could not read that message".into(),
                        topic: None,
                    },
                };
                if !send(socket, &reply).await {
                    break;
                }
            }
            Some(outgoing) = rx.recv() => {
                let topic = match &outgoing {
                    ServerMessage::Event { event } => &event.topic,
                    ServerMessage::Lagged { topic } => topic,
                    _ => continue,
                };
                // Recheck before delivery, including events already queued at revocation.
                let ended = matches!(&outgoing, ServerMessage::Event { event } if event.kind == EventKind::Ended);
                let allowed = tokio::time::timeout(ACCESS_TIMEOUT, can_receive(db, user_id, topic, ended)).await;
                if !matches!(allowed, Ok(Ok(true))) {
                    // Reconnect and refetch rather than leave a silently stalled subscription.
                    break;
                }
                if !send(socket, &outgoing).await {
                    break;
                }
            }
            _ = &mut idle => {
                link = AppLink::Quiet;
                break;
            }
        }
    }
    link
}

/// Checks access and starts forwarding the topic's events into `tx`.
async fn subscribe(
    db: &DatabaseConnection,
    bus: &SharedEventBus,
    user_id: Uuid,
    topic: Topic,
    subscriptions: &mut HashMap<Topic, JoinHandle<()>>,
    tx: &mpsc::Sender<ServerMessage>,
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
    match tokio::time::timeout(ACCESS_TIMEOUT, can_subscribe(db, user_id, &topic)).await {
        Ok(Ok(true)) => {}
        Ok(Ok(false)) => {
            return ServerMessage::Error {
                message: "not allowed".into(),
                topic: Some(topic),
            };
        }
        _ => {
            return ServerMessage::Error {
                message: "subscription temporarily unavailable".into(),
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
            if tx.send(message).await.is_err() {
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
            event: Event::new(Topic::SharedPlaylist(3), 9, EventKind::Playlist),
        };
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["type"], "event");
        assert_eq!(json["version"], 9);
        assert_eq!(json["topic"]["kind"], "shared_playlist");
        assert_eq!(json["kind"], "playlist");
    }

    #[test]
    fn chat_events_carry_the_message() {
        let session = Uuid::from_u128(1);
        let message = ServerMessage::Event {
            event: Event::new(Topic::LiveSession(session), 12, EventKind::Chat)
                .with_data(serde_json::json!({ "message_id": 12, "body": "this one!" })),
        };
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["kind"], "chat");
        assert_eq!(json["version"], 12);
        assert_eq!(json["data"]["body"], "this one!");
    }
    #[test]
    fn message_quota_recovers_after_its_window() {
        let mut window = MessageWindow::new();
        for _ in 0..MESSAGES_PER_MINUTE {
            assert!(window.allow());
        }
        assert!(!window.allow());
        window.started -= Duration::from_secs(60);
        assert!(window.allow());
    }

    #[tokio::test]
    async fn cancelling_a_socket_aborts_its_subscription_forwarders() {
        let task = tokio::spawn(std::future::pending::<()>());
        let cancelled = task.abort_handle();
        let mut subscriptions = Subscriptions::default();
        subscriptions.0.insert(Topic::User(Uuid::new_v4()), task);
        drop(subscriptions);
        tokio::task::yield_now().await;
        assert!(cancelled.is_finished());
    }

    // Exercise the real upgrade handler without an external database or JWKS server.
    #[derive(Clone, axum::extract::FromRef)]
    struct SocketState {
        db: DatabaseConnection,
        decoder: Decoder<SupabaseClaims>,
        bus: SharedEventBus,
        presence: SharedPresence,
        work: BackgroundTasks,
    }

    async fn socket_fixture() -> (
        reqwest::Upgraded,
        String,
        Uuid,
        SharedEventBus,
        BackgroundTasks,
        tokio::task::JoinHandle<()>,
    ) {
        use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
        use std::sync::Arc;
        let id = Uuid::new_v4();
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&["socket-test"]);
        let decoder: Decoder<SupabaseClaims> = Arc::new(
            axum_jwt_auth::LocalDecoder::new(
                vec![DecodingKey::from_secret(b"local-test-key")],
                validation,
            )
            .unwrap(),
        );
        let bus: SharedEventBus = Arc::new(crate::services::realtime::InMemoryBus::new());
        let presence: SharedPresence = Arc::new(crate::services::realtime::InMemoryPresence::new());
        // Avoid database presence writes; this test has another socket already online.
        presence.connect(id);
        let work = BackgroundTasks::default();
        let state = SocketState {
            db: DatabaseConnection::default(),
            decoder,
            bus: bus.clone(),
            presence,
            work: work.clone(),
        };
        let app = Router::new()
            .route("/ws", get(ws_handler))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let response = reqwest::Client::new()
            .get(format!("http://{addr}/ws"))
            .header("connection", "Upgrade")
            .header("upgrade", "websocket")
            .header("sec-websocket-version", "13")
            .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 101);
        let socket = response.upgrade().await.unwrap();
        let token = jsonwebtoken::encode(&Header::new(Algorithm::HS256), &serde_json::json!({
            "sub": id, "exp": Utc::now().timestamp() + 3600, "email": "test@example.invalid", "aud": "socket-test",
        }), &EncodingKey::from_secret(b"local-test-key")).unwrap();
        (socket, token, id, bus, work, server)
    }

    async fn write_frame(socket: &mut reqwest::Upgraded, text: &str) {
        use tokio::io::AsyncWriteExt;
        let mask = [1, 2, 3, 4];
        let mut frame = vec![0x81];
        if text.len() < 126 {
            frame.push(0x80 | text.len() as u8);
        } else {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(text.len() as u16).to_be_bytes());
        }
        frame.extend_from_slice(&mask);
        frame.extend(text.bytes().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        socket.write_all(&frame).await.unwrap();
    }

    async fn read_frame(socket: &mut reqwest::Upgraded) -> (u8, String) {
        use tokio::io::AsyncReadExt;
        tokio::time::timeout(Duration::from_secs(2), async {
            let opcode = socket.read_u8().await.unwrap() & 0x0f;
            let mut len = (socket.read_u8().await.unwrap() & 0x7f) as usize;
            if len == 126 {
                len = socket.read_u16().await.unwrap() as usize;
            }
            let mut bytes = vec![0; len];
            socket.read_exact(&mut bytes).await.unwrap();
            (opcode, String::from_utf8_lossy(&bytes).into_owned())
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn authenticates_over_socket_delivers_events_and_drains_on_shutdown() {
        let (mut socket, token, id, bus, work, server) = socket_fixture().await;
        write_frame(
            &mut socket,
            &serde_json::json!({"type":"auth", "token":token}).to_string(),
        )
        .await;
        assert!(read_frame(&mut socket).await.1.contains("ready"));
        let topic = Topic::User(id);
        write_frame(
            &mut socket,
            &serde_json::json!({"type":"subscribe", "topic":topic}).to_string(),
        )
        .await;
        assert!(read_frame(&mut socket).await.1.contains("subscribed"));
        bus.publish(Event::new(topic, 1, EventKind::NowPlaying));
        let event = read_frame(&mut socket).await.1;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&event).unwrap()["type"],
            "event"
        );
        work.begin_shutdown();
        assert_eq!(read_frame(&mut socket).await.0, 8);
        assert!(
            work.finish(tokio::time::Instant::now() + Duration::from_secs(2))
                .await
        );
        server.abort();
    }

    #[tokio::test]
    async fn invalid_auth_is_closed_without_echoing_the_token() {
        let (mut socket, _, _, _, work, server) = socket_fixture().await;
        write_frame(
            &mut socket,
            r#"{"type":"auth","token":"credential_marker"}"#,
        )
        .await;
        let (opcode, body) = read_frame(&mut socket).await;
        assert_eq!(opcode, 8);
        assert!(!body.contains("credential_marker"));
        work.begin_shutdown();
        work.finish(tokio::time::Instant::now() + Duration::from_secs(2))
            .await;
        server.abort();
    }
    #[tokio::test]
    async fn oversized_frames_are_disconnected() {
        use tokio::io::AsyncReadExt;
        let (mut socket, token, _, _, work, server) = socket_fixture().await;
        write_frame(
            &mut socket,
            &serde_json::json!({"type":"auth", "token":token}).to_string(),
        )
        .await;
        assert!(read_frame(&mut socket).await.1.contains("ready"));
        write_frame(&mut socket, &"x".repeat(MESSAGE_BYTES + 1)).await;
        let first = tokio::time::timeout(Duration::from_secs(2), socket.read_u8())
            .await
            .unwrap();
        if let Ok(first) = first {
            assert_eq!(first & 0x0f, 8);
        }
        work.begin_shutdown();
        assert!(
            work.finish(tokio::time::Instant::now() + Duration::from_secs(2))
                .await
        );
        server.abort();
    }
}
