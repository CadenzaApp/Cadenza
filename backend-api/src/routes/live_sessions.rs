use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, patch, post},
};
use axum_jwt_auth::Claims;
use chrono::{Duration, Utc};
use sea_orm::{DatabaseConnection, prelude::Uuid};

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        invites::{InviteTargetRef, NewInvite, create_invite},
        live_sessions::{
            self as sessions, AddAt, Joined, Left, NewSession, PlaybackCommand, SessionPatch,
            StartAt,
        },
    },
    err::CadenzaError,
    routes::json::{
        invite::{CreateInvite, Invite},
        live_session::{
            AddToQueue, AnswerJoinRequest, JoinResult, LiveSessionId, LiveSessionSnapshot,
            PatchLiveSession, PlaybackBody, QueueEntryAction, SessionVersion, SetListenMode,
            SetLiveSessionRole, StartLiveSession,
        },
    },
    services::{
        live_sessions::SessionRole,
        realtime::{SharedEventBus, Topic, publish_version},
    },
};

fn changed(bus: &SharedEventBus, session_id: Uuid, version: i64) -> Json<SessionVersion> {
    publish_version(bus, Topic::LiveSession(session_id), version, "session");
    Json(SessionVersion {
        version: Some(version),
        ended: false,
    })
}

fn ended(bus: &SharedEventBus, session_id: Uuid, version: i64) -> Json<SessionVersion> {
    publish_version(bus, Topic::LiveSession(session_id), version, "ended");
    Json(SessionVersion {
        version: Some(version),
        ended: true,
    })
}

/// Tells anyone watching these users to refetch what they are playing, which
/// carries the session they are live in. For a start, an end, a join, or a
/// leave, so friends' Listening now drops or gains the live chip at once.
fn publish_presence(bus: &SharedEventBus, user_ids: &[Uuid]) {
    let at = Utc::now().timestamp_millis();
    for user_id in user_ids {
        publish_version(bus, Topic::User(*user_id), at, "live_session");
    }
}

fn parse_role(role: &str) -> Result<SessionRole, CadenzaError> {
    SessionRole::parse(role).ok_or_else(|| {
        CadenzaError::InvalidRequestBody(
            "role is listener, suggester, queue_editor, or controller".into(),
        )
    })
}

/// Starts a session hosted by the caller, or returns the one they already
/// have open.
///
/// ```json
/// { "session_id": "6f1c..." }
/// ```
async fn start_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<StartLiveSession>,
) -> Result<Json<LiveSessionId>, CadenzaError> {
    let default_role = body
        .default_role
        .as_deref()
        .map(parse_role)
        .transpose()?
        .unwrap_or(SessionRole::Suggester);
    let session_id = sessions::start_session(
        &db,
        claims.user_id,
        NewSession {
            name: &body.name,
            default_role,
            allow_join_without_code: body.allow_join_without_code.unwrap_or(true),
            listen_along: body.listen_along,
            approve_joins: body.approve_joins.unwrap_or(true),
        },
    )
    .await?;
    publish_presence(&bus, &[claims.user_id]);
    Ok(Json(LiveSessionId {
        session_id: Some(session_id),
    }))
}

/// The open session the caller hosts or is in, or null.
///
/// ```json
/// { "session_id": null }
/// ```
async fn current_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<LiveSessionId>, CadenzaError> {
    Ok(Json(LiveSessionId {
        session_id: sessions::current_session_id(&db, claims.user_id).await?,
    }))
}

/// Everything a member sees: settings, members, the current song, up next,
/// suggestions, and playback projected to `playback.as_of`. 404 for a non
/// member, 410 `SessionEnded` once it is over.
///
/// ```json
/// { "session_id": "...", "name": "Friday", "host": { "user_id": "...", "username": "ada", "role": "controller", "listen_mode": "synced", "is_host": true, "joined_at": "..." }, "default_role": "suggester", "allow_join_without_code": true, "version": 41, "my_role": "suggester", "my_listen_mode": "remote", "members": [], "current": { "entry_id": 7, "song_id": "1440857781", "title": "Motion Sickness", "artist": "Phoebe Bridgers", "artwork_url": "https://...", "duration_ms": 229000, "status": "queued", "added_by": "...", "added_by_username": "ada" }, "up_next": [], "suggestions": [], "playback": { "entry_id": 7, "position_ms": 61000, "is_playing": true, "as_of": "...", "command_seq": 3 }, "created_at": "..." }
/// ```
async fn get_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<LiveSessionSnapshot>, CadenzaError> {
    let snapshot = sessions::get_snapshot(&db, claims.user_id, session_id).await?;
    Ok(Json(snapshot.into()))
}

/// Ends the session. Host only. Every write below returns the session's new
/// version:
///
/// ```json
/// { "version": 42, "ended": false }
/// ```
async fn end_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let version = sessions::end_session(&db, claims.user_id, session_id).await?;
    publish_presence(&bus, &sessions::present_member_ids(&db, session_id).await?);
    Ok(ended(&bus, session_id, version))
}

/// Joins without a code: the session must allow it and the host's
/// `session_join` audience must include the caller. With `approve_joins` on,
/// a first join asks the host instead. Codes go through
/// `POST /invites/{code}/redeem`.
///
/// ```json
/// { "version": 42, "status": "asked" }
/// ```
async fn join_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<JoinResult>, CadenzaError> {
    let joined = sessions::join_session(&db, claims.user_id, session_id, false).await?;
    let version = joined.version();
    publish_version(&bus, Topic::LiveSession(session_id), version, "session");
    let status = match joined {
        Joined::Member(_) => {
            publish_presence(&bus, &[claims.user_id]);
            "joined"
        }
        Joined::Asked(_) => "asked",
    };
    Ok(Json(JoinResult { version, status }))
}

/// Lets someone who asked to join in, or turns them away. Host only. 404 when
/// they are not waiting.
async fn answer_join_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((session_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<AnswerJoinRequest>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let version =
        sessions::answer_join_request(&db, claims.user_id, session_id, user_id, body.accept)
            .await?;
    // the person let in refetches their current session off their own topic
    if body.accept {
        publish_presence(&bus, &[user_id]);
    }
    Ok(changed(&bus, session_id, version))
}

/// Leaves. The host leaving hands it to another member, or ends it when
/// nobody else is in it.
async fn leave_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    match sessions::leave_session(&db, claims.user_id, session_id).await? {
        Left::Left(version) => {
            publish_presence(&bus, &[claims.user_id]);
            Ok(changed(&bus, session_id, version))
        }
        Left::HandedOver { version, new_host } => {
            publish_presence(&bus, &[claims.user_id, new_host]);
            Ok(changed(&bus, session_id, version))
        }
        Left::Ended(version) => {
            publish_presence(&bus, &sessions::present_member_ids(&db, session_id).await?);
            Ok(ended(&bus, session_id, version))
        }
    }
}

/// Changes the name, the default role, or whether it is open without a code.
/// Host only.
async fn patch_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<PatchLiveSession>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let patch = SessionPatch {
        name: body.name,
        default_role: body.default_role.as_deref().map(parse_role).transpose()?,
        allow_join_without_code: body.allow_join_without_code,
        listen_along: body.listen_along,
        approve_joins: body.approve_joins,
    };
    let version = sessions::update_session(&db, claims.user_id, session_id, patch).await?;
    Ok(changed(&bus, session_id, version))
}

/// Sets a member's role. Host only.
async fn set_role_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((session_id, member_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<SetLiveSessionRole>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let role = parse_role(&body.role)?;
    let version =
        sessions::set_member_role(&db, claims.user_id, session_id, member_id, role).await?;
    Ok(changed(&bus, session_id, version))
}

/// Removes a member for good. They cannot rejoin, even with a code. Host only.
async fn kick_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((session_id, member_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let version = sessions::kick_member(&db, claims.user_id, session_id, member_id).await?;
    Ok(changed(&bus, session_id, version))
}

/// Sets the caller's own `listen_mode`: `remote` (see and control only) or
/// `synced` (play along on this device).
async fn me_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<SetListenMode>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let version =
        sessions::set_listen_mode(&db, claims.user_id, session_id, &body.listen_mode).await?;
    Ok(changed(&bus, session_id, version))
}

/// Adds songs. Queued for a queue editor, controller, or the host; suggested
/// for a suggester; 403 for a listener. `play_now` also skips to the first
/// one, for a controller or the host.
async fn add_queue_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<AddToQueue>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let songs: Vec<_> = body.songs.into_iter().map(Into::into).collect();
    let at = match (body.play_now, body.position) {
        (true, _) => AddAt::PlayNow,
        (false, Some(position)) => AddAt::Position(position),
        (false, None) => AddAt::End,
    };
    let start = body.start_position_ms.map(|position_ms| StartAt {
        position_ms,
        is_playing: body.start_playing.unwrap_or(true),
    });
    let version = sessions::add_songs(&db, claims.user_id, session_id, &songs, at, start).await?;
    Ok(changed(&bus, session_id, version))
}

/// `{action: "move", position}` for a queue editor, `{action: "approve"}` or
/// `{action: "reject"}` on a suggestion for the host.
async fn queue_entry_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((session_id, entry_id)): Path<(Uuid, i64)>,
    Json(body): Json<QueueEntryAction>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let user = claims.user_id;
    let version = match body {
        QueueEntryAction::Move { position } => {
            sessions::move_entry(&db, user, session_id, entry_id, position).await?
        }
        QueueEntryAction::Approve => {
            sessions::review_suggestion(&db, user, session_id, entry_id, true).await?
        }
        QueueEntryAction::Reject => {
            sessions::review_suggestion(&db, user, session_id, entry_id, false).await?
        }
    };
    Ok(changed(&bus, session_id, version))
}

/// Removes an upcoming entry (queue editor), or withdraws your own suggestion.
async fn remove_queue_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((session_id, entry_id)): Path<(Uuid, i64)>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let version = sessions::remove_entry(&db, claims.user_id, session_id, entry_id).await?;
    Ok(changed(&bus, session_id, version))
}

/// Playback, tagged by `kind`. Controllers and the host: `play`, `pause`,
/// `seek {position_ms}`, `next`, `jump {entry_id}`. The host's device only:
/// `report {entry_id, position_ms, is_playing}` on track change, play or
/// pause, and every 10 s, and `advance {from_entry_id}` when a song ends.
/// `version` is null when a report changed nothing worth telling anyone.
async fn playback_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<PlaybackBody>,
) -> Result<Json<SessionVersion>, CadenzaError> {
    let user = claims.user_id;
    let command = |command| sessions::playback_command(&db, user, session_id, command);
    let version = match body {
        PlaybackBody::Play => Some(command(PlaybackCommand::Play).await?),
        PlaybackBody::Pause => Some(command(PlaybackCommand::Pause).await?),
        PlaybackBody::Seek { position_ms } => {
            Some(command(PlaybackCommand::Seek { position_ms }).await?)
        }
        PlaybackBody::Next => Some(command(PlaybackCommand::Next).await?),
        PlaybackBody::Jump { entry_id } => Some(command(PlaybackCommand::Jump { entry_id }).await?),
        PlaybackBody::Report {
            entry_id,
            position_ms,
            is_playing,
        } => {
            sessions::host_report(&db, user, session_id, entry_id, position_ms, is_playing).await?
        }
        PlaybackBody::Advance { from_entry_id } => {
            sessions::host_advance(&db, user, session_id, from_entry_id).await?
        }
    };
    match version {
        Some(version) => Ok(changed(&bus, session_id, version)),
        None => Ok(Json(SessionVersion {
            version: None,
            ended: false,
        })),
    }
}

/// Makes an invite code. Host only.
///
/// ```json
/// { "code": "K7M2QX9P", "link": "cadenza://join/K7M2QX9P", "grants_role": null, "expires_at": null, "max_uses": null }
/// ```
async fn invite_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(session_id): Path<Uuid>,
    body: Option<Json<CreateInvite>>,
) -> Result<Json<Invite>, CadenzaError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    sessions::check_can_invite(&db, claims.user_id, session_id).await?;
    let invite = create_invite(
        &db,
        claims.user_id,
        &InviteTargetRef::LiveSession(session_id),
        NewInvite {
            grants_role: None,
            expires_in: body.expires_in_hours.map(Duration::hours),
            max_uses: body.max_uses,
        },
    )
    .await?;
    Ok(Json(invite.into()))
}

pub fn get_live_sessions_router() -> Router<AppState> {
    Router::new()
        .route("/", post(start_handler))
        .route("/current", get(current_handler))
        .route(
            "/{id}",
            get(get_handler).delete(end_handler).patch(patch_handler),
        )
        .route("/{id}/join", post(join_handler))
        .route("/{id}/join-requests/{user_id}", post(answer_join_handler))
        .route("/{id}/leave", post(leave_handler))
        .route(
            "/{id}/members/{user_id}",
            patch(set_role_handler).delete(kick_handler),
        )
        .route("/{id}/me", patch(me_handler))
        .route("/{id}/queue", post(add_queue_handler))
        .route(
            "/{id}/queue/{entry_id}",
            patch(queue_entry_handler).delete(remove_queue_handler),
        )
        .route("/{id}/playback", post(playback_handler))
        .route("/{id}/invites", post(invite_handler))
}
