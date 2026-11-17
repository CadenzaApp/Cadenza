//! Database tests for invites, shared playlists, live sessions, now playing,
//! and what a profile shows. Each runs inside one transaction that is rolled
//! back, against two real accounts from `profile`, so the raw SQL is exercised
//! without leaving anything behind. Ignored by default like the other database
//! tests. One at a time, since they share the two accounts' rows and the
//! session sweep test touches every session:
//!
//! ```sh
//! cargo test social_listening -- --ignored --test-threads=1
//! ```

use sea_orm::{
    ConnectionTrait, Database, DatabaseTransaction, DbBackend, Statement, TransactionTrait,
    prelude::Uuid,
};

use crate::db::entity::sea_orm_active_enums::ListenMode;
use crate::db::{
    invites::{InviteTargetRef, NewInvite, create_invite, redeem_invite},
    live_sessions::{self as sessions, NewQueueSong, PlaybackCommand},
    now_playing::{self, NowPlayingUpdate},
    saved_queries,
    shared_playlists::{self as playlists, MemberRemoved, PlaylistRole},
};
use crate::err::CadenzaError;
use crate::services::live_sessions::{RepeatMode, SessionRole};

async fn scratch() -> DatabaseTransaction {
    dotenvy::dotenv().ok();
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let db = Database::connect(url).await.expect("connect");
    db.begin().await.expect("begin")
}

/// Two accounts that exist, so foreign keys to auth.users hold.
async fn two_users(txn: &DatabaseTransaction) -> (Uuid, Uuid) {
    let rows = txn
        .query_all_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT uid FROM profile ORDER BY uid LIMIT 2",
        ))
        .await
        .unwrap();
    assert_eq!(rows.len(), 2, "needs two profiles in the database");
    (
        rows[0].try_get("", "uid").unwrap(),
        rows[1].try_get("", "uid").unwrap(),
    )
}

fn song(id: &str) -> NewQueueSong {
    NewQueueSong {
        song_id: id.into(),
        title: format!("song {id}"),
        artist: Some("artist".into()),
        album: None,
        album_id: None,
        artist_id: None,
        artwork_url: None,
        duration_ms: Some(180_000),
    }
}

#[tokio::test]
#[ignore]
async fn social_listening_shared_playlist_flow() {
    let txn = scratch().await;
    let (owner, friend) = two_users(&txn).await;

    let id = playlists::create_playlist(&txn, owner, "Road trip", "", &["1".into(), "2".into()])
        .await
        .unwrap();
    let mine = playlists::list_my_playlists(&txn, owner).await.unwrap();
    let summary = mine.iter().find(|p| p.playlist_id == id).unwrap();
    assert_eq!(summary.song_count, 2);
    assert_eq!(summary.role, PlaylistRole::Owner);

    // a stranger cannot see it
    assert!(matches!(
        playlists::get_playlist(&txn, friend, id).await,
        Err(CadenzaError::NotFound)
    ));

    let v = playlists::add_songs(&txn, owner, id, &["3".into()], Some(0), None)
        .await
        .unwrap();
    let detail = playlists::get_playlist(&txn, owner, id).await.unwrap();
    let order: Vec<&str> = detail.entries.iter().map(|e| e.song_id.as_str()).collect();
    assert_eq!(order, vec!["3", "1", "2"]);
    assert_eq!(detail.header.version, v);

    // a stale version is refused
    assert!(matches!(
        playlists::add_songs(&txn, owner, id, &["4".into()], None, Some(v - 1)).await,
        Err(CadenzaError::VersionConflict { .. })
    ));

    let first = detail.entries[0].entry_id;
    playlists::move_entry(&txn, owner, id, first, 2, None)
        .await
        .unwrap();
    let detail = playlists::get_playlist(&txn, owner, id).await.unwrap();
    let order: Vec<&str> = detail.entries.iter().map(|e| e.song_id.as_str()).collect();
    assert_eq!(order, vec!["1", "2", "3"]);

    // a post's card shows the first songs and the counts
    let cards = playlists::playlist_cards(&txn, &[id, -1]).await.unwrap();
    assert_eq!(cards.len(), 1);
    let card = &cards[&id];
    assert_eq!(card.name, "Road trip");
    assert_eq!((card.song_count, card.member_count), (3, 1));
    assert_eq!(card.cover_song_ids, vec!["1", "2", "3"]);

    // a code joins as editor
    let invite = create_invite(
        &txn,
        owner,
        &InviteTargetRef::SharedPlaylist(id),
        NewInvite {
            grants_role: Some(PlaylistRole::Editor),
            max_uses: Some(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let redeemed = redeem_invite(&txn, &invite.code).await.unwrap();
    assert_eq!(redeemed.target, InviteTargetRef::SharedPlaylist(id));
    playlists::join_by_code(&txn, friend, id, PlaylistRole::Editor)
        .await
        .unwrap();
    // used up
    assert!(matches!(
        redeem_invite(&txn, &invite.code).await,
        Err(CadenzaError::InviteCodeInvalid)
    ));

    // the editor edits songs but cannot delete or manage
    playlists::add_songs(&txn, friend, id, &["5".into()], None, None)
        .await
        .unwrap();
    assert!(matches!(
        playlists::delete_playlist(&txn, friend, id).await,
        Err(CadenzaError::Forbidden(_))
    ));
    let entry = playlists::get_playlist(&txn, friend, id)
        .await
        .unwrap()
        .entries[0]
        .entry_id;
    playlists::remove_entry(&txn, friend, id, entry, None)
        .await
        .unwrap();

    playlists::set_member_role(&txn, owner, id, friend, PlaylistRole::Viewer)
        .await
        .unwrap();
    assert!(matches!(
        playlists::add_songs(&txn, friend, id, &["6".into()], None, None).await,
        Err(CadenzaError::Forbidden(_))
    ));

    // the owner leaving deletes it
    assert_eq!(
        playlists::remove_member(&txn, owner, id, owner)
            .await
            .unwrap(),
        MemberRemoved::PlaylistDeleted
    );
    assert!(playlists::get_playlist(&txn, friend, id).await.is_err());

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_live_session_flow() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    // a leftover open session of the host's would be returned instead
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now() WHERE host_id = $1 AND ended_at IS NULL",
        [host.into()],
    ))
    .await
    .unwrap();

    let id = sessions::start_session(
        &txn,
        host,
        sessions::NewSession {
            name: "Friday",
            default_role: SessionRole::Suggester,
            allow_join_without_code: false,
            listen_along: false,
            approve_joins: false,
        },
    )
    .await
    .unwrap();
    // starting again returns the same one
    assert_eq!(
        sessions::start_session(
            &txn,
            host,
            sessions::NewSession {
                name: "Again",
                default_role: SessionRole::Listener,
                allow_join_without_code: true,
                listen_along: false,
                approve_joins: false,
            }
        )
        .await
        .unwrap(),
        id
    );
    assert_eq!(
        sessions::current_session_id(&txn, host).await.unwrap(),
        Some(id)
    );

    // closed to joins without a code
    assert!(matches!(
        sessions::join_session(&txn, guest, id, false).await,
        Err(CadenzaError::Forbidden(_))
    ));
    sessions::join_session(&txn, guest, id, true).await.unwrap();
    assert!(sessions::is_participant(&txn, id, guest).await.unwrap());

    // the host's songs are queued and start playing
    sessions::add_songs(
        &txn,
        host,
        id,
        &[song("10"), song("11")],
        sessions::AddAt::End,
        // the host's phone was 30 s into the first song
        Some(sessions::StartAt {
            position_ms: 30_000,
            is_playing: true,
        }),
    )
    .await
    .unwrap();
    let snap = sessions::get_snapshot(&txn, guest, id).await.unwrap();
    assert_eq!(snap.current.as_ref().unwrap().song_id, "10");
    assert_eq!(snap.up_next.len(), 1);
    assert!(snap.playback.is_playing);
    assert!(snap.playback.position_ms >= 30_000);

    // a suggester's song waits for the host
    sessions::add_songs(&txn, guest, id, &[song("12")], sessions::AddAt::End, None)
        .await
        .unwrap();
    let snap = sessions::get_snapshot(&txn, host, id).await.unwrap();
    assert_eq!(snap.suggestions.len(), 1);
    let suggestion = snap.suggestions[0].entry_id;
    assert!(matches!(
        sessions::playback_command(&txn, guest, id, PlaybackCommand::Next).await,
        Err(CadenzaError::Forbidden(_))
    ));
    sessions::review_suggestion(&txn, host, id, suggestion, true)
        .await
        .unwrap();

    // skip moves on and marks the old one played
    sessions::playback_command(&txn, host, id, PlaybackCommand::Next)
        .await
        .unwrap();
    let snap = sessions::get_snapshot(&txn, host, id).await.unwrap();
    assert_eq!(snap.current.as_ref().unwrap().song_id, "11");
    let upcoming: Vec<&str> = snap.up_next.iter().map(|e| e.song_id.as_str()).collect();
    assert_eq!(upcoming, vec!["12"]);

    // a double advance only advances once
    let current = snap.current.unwrap().entry_id;
    assert!(
        sessions::host_advance(&txn, host, id, current)
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        sessions::host_advance(&txn, host, id, current)
            .await
            .unwrap()
            .is_none()
    );

    let report = sessions::HostReport {
        entry_id: None,
        position_ms: 5_000,
        is_playing: false,
        command_seq: None,
    };
    sessions::host_report(&txn, host, id, report).await.unwrap();
    let snap = sessions::get_snapshot(&txn, guest, id).await.unwrap();
    assert!(!snap.playback.is_playing);
    assert_eq!(snap.playback.position_ms, 5_000);

    sessions::set_member_role(&txn, host, id, guest, SessionRole::Controller)
        .await
        .unwrap();
    sessions::playback_command(&txn, guest, id, PlaybackCommand::Play)
        .await
        .unwrap();
    sessions::set_listen_mode(&txn, guest, id, ListenMode::Synced)
        .await
        .unwrap();

    // play now puts the song first and plays it, for a controller only
    sessions::add_songs(
        &txn,
        guest,
        id,
        &[song("13")],
        sessions::AddAt::PlayNow,
        None,
    )
    .await
    .unwrap();
    let snap = sessions::get_snapshot(&txn, guest, id).await.unwrap();
    assert_eq!(snap.current.as_ref().unwrap().song_id, "13");
    assert!(snap.playback.is_playing);

    // kicked means gone for good, code or not
    sessions::kick_member(&txn, host, id, guest).await.unwrap();
    assert!(matches!(
        sessions::join_session(&txn, guest, id, true).await,
        Err(CadenzaError::Forbidden(_))
    ));

    sessions::end_session(&txn, host, id).await.unwrap();
    assert!(matches!(
        sessions::get_snapshot(&txn, host, id).await,
        Err(CadenzaError::SessionEnded)
    ));

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_host_leaving_hands_the_session_over() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now() WHERE host_id IN ($1, $2) AND ended_at IS NULL",
        [host.into(), guest.into()],
    ))
    .await
    .unwrap();

    let id = sessions::start_session(
        &txn,
        host,
        sessions::NewSession {
            name: "Handover",
            default_role: SessionRole::Suggester,
            allow_join_without_code: true,
            listen_along: false,
            approve_joins: false,
        },
    )
    .await
    .unwrap();
    sessions::join_session(&txn, guest, id, true).await.unwrap();
    sessions::add_songs(&txn, host, id, &[song("20")], sessions::AddAt::End, None)
        .await
        .unwrap();

    // the guest hosts it now, and the old host is out
    assert!(matches!(
        sessions::leave_session(&txn, host, id).await.unwrap(),
        sessions::Left::HandedOver { new_host, .. } if new_host == guest
    ));
    let snap = sessions::get_snapshot(&txn, guest, id).await.unwrap();
    assert_eq!(snap.me, crate::services::live_sessions::Actor::Host);
    assert_eq!(snap.my_listen_mode, ListenMode::Synced);
    assert_eq!(snap.current.as_ref().unwrap().song_id, "20");
    assert!(!sessions::is_participant(&txn, id, host).await.unwrap());

    // the last one out ends it
    assert!(matches!(
        sessions::leave_session(&txn, guest, id).await.unwrap(),
        sessions::Left::Ended(_)
    ));

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_host_makes_someone_else_host_and_stays() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now() WHERE host_id IN ($1, $2) AND ended_at IS NULL",
        [host.into(), guest.into()],
    ))
    .await
    .unwrap();
    let id = sessions::start_session(
        &txn,
        host,
        sessions::NewSession {
            name: "Transfer",
            default_role: SessionRole::Listener,
            allow_join_without_code: true,
            listen_along: false,
            approve_joins: false,
        },
    )
    .await
    .unwrap();
    sessions::join_session(&txn, guest, id, true).await.unwrap();
    sessions::add_songs(&txn, host, id, &[song("20")], sessions::AddAt::End, None)
        .await
        .unwrap();

    // a listener cannot make themselves host
    assert!(
        sessions::transfer_host(&txn, guest, id, guest)
            .await
            .is_err()
    );

    sessions::transfer_host(&txn, host, id, guest)
        .await
        .unwrap();
    let as_guest = sessions::get_snapshot(&txn, guest, id).await.unwrap();
    assert_eq!(as_guest.me, crate::services::live_sessions::Actor::Host);
    assert_eq!(as_guest.current.as_ref().unwrap().song_id, "20");
    // the old host is still in it, as a controller playing along
    let as_old = sessions::get_snapshot(&txn, host, id).await.unwrap();
    assert_eq!(
        as_old.me,
        crate::services::live_sessions::Actor::Member(SessionRole::Controller)
    );
    assert_eq!(as_old.my_listen_mode, ListenMode::Synced);

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_members_who_close_the_app_leave() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now() WHERE host_id IN ($1, $2) AND ended_at IS NULL",
        [host.into(), guest.into()],
    ))
    .await
    .unwrap();
    let id = sessions::start_session(
        &txn,
        host,
        sessions::NewSession {
            name: "Away",
            default_role: SessionRole::Listener,
            allow_join_without_code: true,
            listen_along: false,
            approve_joins: false,
        },
    )
    .await
    .unwrap();
    sessions::join_session(&txn, guest, id, true).await.unwrap();

    // closed a moment ago: still in it
    sessions::set_app_link(&txn, guest, sessions::AppLink::Closed)
        .await
        .unwrap();
    sessions::remove_away_members(&txn).await.unwrap();
    assert!(sessions::is_participant(&txn, id, guest).await.unwrap());

    // closed over a minute ago: out, and the host stays
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_session_members SET away_since = now() - interval '2 minutes'
         WHERE session_id = $1",
        [id.into()],
    ))
    .await
    .unwrap();
    let gone = sessions::remove_away_members(&txn).await.unwrap();
    let ours = gone.iter().find(|g| g.session_id == id).unwrap();
    assert_eq!(ours.user_ids, vec![guest]);
    assert!(!ours.ended);
    assert!(!sessions::is_participant(&txn, id, guest).await.unwrap());
    assert!(sessions::is_participant(&txn, id, host).await.unwrap());

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_listen_along_has_its_own_audience() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now() WHERE host_id = $1 AND ended_at IS NULL",
        [host.into()],
    ))
    .await
    .unwrap();
    // session joins open to everyone, listen along off
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO privacy_settings (user_id, session_join, listen_along)
         VALUES ($1, 'everyone', 'nobody')
         ON CONFLICT (user_id) DO UPDATE SET session_join = 'everyone', listen_along = 'nobody'",
        [host.into()],
    ))
    .await
    .unwrap();

    let id = sessions::start_session(
        &txn,
        host,
        sessions::NewSession {
            name: "Along",
            default_role: SessionRole::Listener,
            allow_join_without_code: true,
            listen_along: true,
            approve_joins: false,
        },
    )
    .await
    .unwrap();
    assert!(matches!(
        sessions::join_session(&txn, guest, id, false).await,
        Err(CadenzaError::Forbidden(_))
    ));

    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE privacy_settings SET listen_along = 'everyone' WHERE user_id = $1",
        [host.into()],
    ))
    .await
    .unwrap();
    sessions::join_session(&txn, guest, id, false)
        .await
        .unwrap();

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_joining_someone_listening_makes_a_session() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now()
         WHERE host_id = ANY(ARRAY[$1, $2]::uuid[]) AND ended_at IS NULL",
        [host.into(), guest.into()],
    ))
    .await
    .unwrap();
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO privacy_settings (user_id, listen_along) VALUES ($1, 'everyone')
         ON CONFLICT (user_id) DO UPDATE SET listen_along = 'everyone'",
        [host.into()],
    ))
    .await
    .unwrap();
    now_playing::upsert_now_playing(
        &txn,
        host,
        NowPlayingUpdate {
            song_id: "1440857781".into(),
            title: "song".into(),
            artist: None,
            album: None,
            artwork_url: None,
            duration_ms: Some(200_000),
            is_playing: true,
            position_ms: 30_000,
            up_next: vec![now_playing::UpNextSong {
                song_id: Some("1440857790".into()),
                title: "next".into(),
                artist: None,
                artwork_url: None,
            }],
        },
    )
    .await
    .unwrap();

    // nothing open, so joining makes one from what is playing, and asks
    let first = sessions::join_listening(&txn, guest, host).await.unwrap();
    assert!(first.created);
    assert!(matches!(first.joined, sessions::Joined::Asked(_)));
    let snap = sessions::get_snapshot(&txn, host, first.session_id)
        .await
        .unwrap();
    assert!(snap.session.listen_along);
    assert_eq!(snap.current.unwrap().song_id, "1440857781");
    let next: Vec<_> = snap.up_next.iter().map(|e| e.song_id.as_str()).collect();
    assert_eq!(next, ["1440857790"]);
    assert_eq!(snap.join_requests.len(), 1);

    // not now, with nobody else in it, ends it
    let answered = sessions::answer_join_request(&txn, host, first.session_id, guest, false)
        .await
        .unwrap();
    assert!(answered.ended);

    // again, let in this time, so it went live: the last guest leaving
    // leaves it open for the host
    let second = sessions::join_listening(&txn, guest, host).await.unwrap();
    assert!(second.created);
    assert_ne!(second.session_id, first.session_id);
    sessions::answer_join_request(&txn, host, second.session_id, guest, true)
        .await
        .unwrap();
    let let_in = sessions::get_snapshot(&txn, host, second.session_id)
        .await
        .unwrap();
    assert!(let_in.session.listen_along && let_in.session.went_live);
    let again = sessions::join_listening(&txn, guest, host).await.unwrap();
    assert!(!again.created);
    assert_eq!(again.session_id, second.session_id);
    assert!(matches!(
        sessions::leave_session(&txn, guest, second.session_id)
            .await
            .unwrap(),
        sessions::Left::Left(_)
    ));

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_sweep_ends_paused_and_closed_sessions() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    let open = |name: &'static str, user| {
        let txn = &txn;
        async move {
            txn.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE live_sessions SET ended_at = now() WHERE host_id = $1 AND ended_at IS NULL",
                [Uuid::into(user)],
            ))
            .await
            .unwrap();
            sessions::start_session(
                txn,
                user,
                sessions::NewSession {
                    name,
                    default_role: SessionRole::Listener,
                    allow_join_without_code: true,
                    listen_along: false,
                    approve_joins: false,
                },
            )
            .await
            .unwrap()
        }
    };
    let set = |sql: &'static str, id: Uuid| {
        let txn = &txn;
        async move {
            txn.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                sql,
                [id.into()],
            ))
            .await
            .unwrap();
        }
    };

    // paused eleven minutes, and playing with the app gone two
    let paused = open("Paused", host).await;
    set(
        "UPDATE live_sessions SET is_playing = false,
             position_at = now() - interval '11 minutes' WHERE session_id = $1",
        paused,
    )
    .await;
    let closed = open("Closed", guest).await;
    set(
        "UPDATE live_sessions SET is_playing = true,
             host_away_since = now() - interval '2 minutes' WHERE session_id = $1",
        closed,
    )
    .await;

    let ended: Vec<Uuid> = sessions::end_timed_out(&txn)
        .await
        .unwrap()
        .into_iter()
        .map(|session| session.session_id)
        .collect();
    assert!(ended.contains(&paused));
    assert!(ended.contains(&closed));

    // swiping the app away pauses it first; the closed connection still ends
    // it, and the host's stale now playing goes with it
    now_playing::upsert_now_playing(
        &txn,
        host,
        NowPlayingUpdate {
            song_id: "1440857781".into(),
            title: "song".into(),
            artist: None,
            album: None,
            artwork_url: None,
            duration_ms: Some(200_000),
            is_playing: true,
            position_ms: 0,
            up_next: vec![],
        },
    )
    .await
    .unwrap();
    let swiped = open("Swiped", host).await;
    set(
        "UPDATE live_sessions SET is_playing = false, host_closed_app = true,
             host_away_since = now() - interval '2 minutes' WHERE session_id = $1",
        swiped,
    )
    .await;
    let ended = sessions::end_timed_out(&txn).await.unwrap();
    assert!(ended.iter().any(|session| session.session_id == swiped));
    let row = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT 1 AS one FROM now_playing WHERE user_id = $1",
            [host.into()],
        ))
        .await
        .unwrap();
    assert!(row.is_none());

    // back within the minute, it keeps going
    let back = open("Back", host).await;
    set(
        "UPDATE live_sessions SET is_playing = true,
             host_away_since = now() - interval '20 seconds' WHERE session_id = $1",
        back,
    )
    .await;
    let ended = sessions::end_timed_out(&txn).await.unwrap();
    assert!(ended.iter().all(|session| session.session_id != back));

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_now_playing_reads_run() {
    let txn = scratch().await;
    let (a, b) = two_users(&txn).await;
    now_playing::upsert_now_playing(
        &txn,
        a,
        NowPlayingUpdate {
            song_id: "1440857781".into(),
            title: "song".into(),
            artist: None,
            album: None,
            artwork_url: None,
            duration_ms: Some(200_000),
            is_playing: true,
            position_ms: 0,
            up_next: vec![],
        },
    )
    .await
    .unwrap();
    // the owner sees their own; the friends list query runs either way
    assert!(
        now_playing::now_playing_for_viewer(&txn, a, a)
            .await
            .unwrap()
            .is_some()
    );
    now_playing::friends_listening(&txn, b).await.unwrap();
    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_only_commands_move_command_seq() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now() WHERE host_id = $1 AND ended_at IS NULL",
        [host.into()],
    ))
    .await
    .unwrap();
    let id = sessions::start_session(
        &txn,
        host,
        sessions::NewSession {
            name: "Seq",
            default_role: SessionRole::Controller,
            allow_join_without_code: true,
            listen_along: false,
            approve_joins: false,
        },
    )
    .await
    .unwrap();
    let seq = || async {
        sessions::get_snapshot(&txn, host, id)
            .await
            .unwrap()
            .session
            .command_seq
    };

    // the host's seed and reports, and a join, leave it alone
    sessions::add_songs(
        &txn,
        host,
        id,
        &[song("20"), song("21")],
        sessions::AddAt::End,
        Some(sessions::StartAt {
            position_ms: 5_000,
            is_playing: true,
        }),
    )
    .await
    .unwrap();
    let current = sessions::get_snapshot(&txn, host, id)
        .await
        .unwrap()
        .current
        .unwrap()
        .entry_id;
    let report = sessions::HostReport {
        entry_id: Some(current),
        position_ms: 9_000,
        is_playing: false,
        command_seq: Some(0),
    };
    sessions::host_report(&txn, host, id, report).await.unwrap();
    sessions::join_session(&txn, guest, id, true).await.unwrap();
    assert_eq!(seq().await, 0);

    // a controller's command moves it
    sessions::playback_command(&txn, guest, id, PlaybackCommand::Play)
        .await
        .unwrap();
    assert_eq!(seq().await, 1);
    sessions::playback_command(&txn, guest, id, PlaybackCommand::Next)
        .await
        .unwrap();
    assert_eq!(seq().await, 2);

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_back_repeat_and_stale_reports() {
    let txn = scratch().await;
    let (host, _) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now() WHERE host_id = $1 AND ended_at IS NULL",
        [host.into()],
    ))
    .await
    .unwrap();
    let id = sessions::start_session(
        &txn,
        host,
        sessions::NewSession {
            name: "Back",
            default_role: SessionRole::Controller,
            allow_join_without_code: true,
            listen_along: false,
            approve_joins: false,
        },
    )
    .await
    .unwrap();
    sessions::add_songs(
        &txn,
        host,
        id,
        &[song("30"), song("31"), song("32")],
        sessions::AddAt::End,
        Some(sessions::StartAt {
            position_ms: 0,
            is_playing: true,
        }),
    )
    .await
    .unwrap();
    let songs = || async {
        let snap = sessions::get_snapshot(&txn, host, id).await.unwrap();
        let mut ids = vec![snap.current.unwrap().song_id];
        ids.extend(snap.up_next.into_iter().map(|entry| entry.song_id));
        ids
    };
    let command = |command| sessions::playback_command(&txn, host, id, command);
    // paused, so positions do not run on: now() is fixed for the transaction
    command(PlaybackCommand::Pause).await.unwrap();

    command(PlaybackCommand::Next).await.unwrap();
    command(PlaybackCommand::Next).await.unwrap();
    assert_eq!(songs().await, ["32"]);

    // back goes to the song before, and again
    command(PlaybackCommand::Previous).await.unwrap();
    assert_eq!(songs().await, ["31", "32"]);
    command(PlaybackCommand::Previous).await.unwrap();
    assert_eq!(songs().await, ["30", "31", "32"]);
    // nothing before the first, so it restarts
    command(PlaybackCommand::Previous).await.unwrap();
    assert_eq!(songs().await, ["30", "31", "32"]);

    // however far into the song, back is the song before: restarting is a
    // seek, which the app sends itself
    command(PlaybackCommand::Next).await.unwrap();
    command(PlaybackCommand::Seek {
        position_ms: 60_000,
    })
    .await
    .unwrap();
    command(PlaybackCommand::Previous).await.unwrap();
    let snap = sessions::get_snapshot(&txn, host, id).await.unwrap();
    assert_eq!(snap.current.unwrap().song_id, "30");
    assert_eq!(snap.playback.position_ms, 0);
    // on to 31 again, for what follows
    command(PlaybackCommand::Next).await.unwrap();

    // a report from before the latest command is only the host being there
    let entry = sessions::get_snapshot(&txn, host, id)
        .await
        .unwrap()
        .current
        .unwrap()
        .entry_id;
    let stale = sessions::HostReport {
        entry_id: Some(entry),
        position_ms: 90_000,
        is_playing: true,
        command_seq: Some(0),
    };
    assert!(
        sessions::host_report(&txn, host, id, stale)
            .await
            .unwrap()
            .is_none()
    );
    let snap = sessions::get_snapshot(&txn, host, id).await.unwrap();
    assert!(snap.playback.position_ms < 4_000);

    // a seek on the phone is news to everyone else
    let seek = sessions::HostReport {
        command_seq: Some(snap.session.command_seq),
        ..stale
    };
    // and carries the new playback, since the queue did not move
    let change = sessions::host_report(&txn, host, id, seek)
        .await
        .unwrap()
        .unwrap();
    let playback = change.playback.unwrap();
    assert!(playback.projected.position_ms >= 90_000);
    assert_eq!(playback.session.version, change.version);

    // repeat all: on the last song, the played ones come back after it.
    // Not on it yet, so only playback moved and the change carries it.
    let change = command(PlaybackCommand::Repeat {
        mode: RepeatMode::All,
    })
    .await
    .unwrap();
    assert_eq!(
        change.playback.unwrap().session.repeat_mode,
        RepeatMode::All
    );
    command(PlaybackCommand::Next).await.unwrap();
    assert_eq!(songs().await, ["32", "30", "31"]);

    // a repeat all that puts songs back moved the queue, so it does not
    let off = command(PlaybackCommand::Repeat {
        mode: RepeatMode::Off,
    })
    .await
    .unwrap();
    assert!(off.playback.is_some());
    command(PlaybackCommand::Next).await.unwrap();
    command(PlaybackCommand::Next).await.unwrap();
    assert_eq!(songs().await, ["31"]);
    let refill = command(PlaybackCommand::Repeat {
        mode: RepeatMode::All,
    })
    .await
    .unwrap();
    assert!(refill.playback.is_none());
    assert_eq!(songs().await.len(), 3);

    // shuffle on reorders the queue; off only flips the flag
    let on = command(PlaybackCommand::Shuffle { on: true })
        .await
        .unwrap();
    assert!(on.playback.is_none());
    let off = command(PlaybackCommand::Shuffle { on: false })
        .await
        .unwrap();
    assert!(!off.playback.unwrap().session.shuffle);

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_joining_without_a_code_asks_the_host() {
    let txn = scratch().await;
    let (host, guest) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE live_sessions SET ended_at = now() WHERE host_id = $1 AND ended_at IS NULL",
        [host.into()],
    ))
    .await
    .unwrap();
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO privacy_settings (user_id, session_join) VALUES ($1, 'everyone')
         ON CONFLICT (user_id) DO UPDATE SET session_join = 'everyone'",
        [host.into()],
    ))
    .await
    .unwrap();
    let id = sessions::start_session(
        &txn,
        host,
        sessions::NewSession {
            name: "Ask",
            default_role: SessionRole::Suggester,
            allow_join_without_code: true,
            listen_along: false,
            approve_joins: true,
        },
    )
    .await
    .unwrap();

    // asking twice files one request
    let asked = sessions::join_session(&txn, guest, id, false)
        .await
        .unwrap();
    assert!(matches!(asked, sessions::Joined::Asked(_)));
    sessions::join_session(&txn, guest, id, false)
        .await
        .unwrap();
    let snapshot = sessions::get_snapshot(&txn, host, id).await.unwrap();
    assert_eq!(snapshot.join_requests.len(), 1);
    assert_eq!(snapshot.members.len(), 1);
    // only the host sees who is waiting, and the guest is not in yet
    assert!(matches!(
        sessions::get_snapshot(&txn, guest, id).await,
        Err(CadenzaError::NotFound)
    ));

    // the guest cannot let themselves in
    assert!(
        sessions::answer_join_request(&txn, guest, id, guest, true)
            .await
            .is_err()
    );
    sessions::answer_join_request(&txn, host, id, guest, true)
        .await
        .unwrap();
    let snapshot = sessions::get_snapshot(&txn, host, id).await.unwrap();
    assert!(snapshot.join_requests.is_empty());
    assert_eq!(snapshot.members.len(), 2);
    // answered once
    assert!(matches!(
        sessions::answer_join_request(&txn, host, id, guest, true).await,
        Err(CadenzaError::NotFound)
    ));

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_favorites_and_blocks() {
    use crate::db::friend_relations as relations;

    let txn = scratch().await;
    let (a, b) = two_users(&txn).await;
    // start from friends with no blocks between them
    relations::unblock_user(&txn, a, b).await.unwrap();
    relations::unblock_user(&txn, b, a).await.unwrap();
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO friendships (user1, user2, status) VALUES (LEAST($1, $2), GREATEST($1, $2), 'complete')
         ON CONFLICT (user1, user2) DO UPDATE SET status = 'complete'",
        vec![a.into(), b.into()],
    ))
    .await
    .unwrap();

    relations::favorite_friend(&txn, a, b).await.unwrap();
    relations::favorite_friend(&txn, a, b).await.unwrap();
    assert!(relations::favorite_ids(&txn, a).await.unwrap().contains(&b));
    relations::unfavorite_friend(&txn, a, b).await.unwrap();
    assert!(!relations::favorite_ids(&txn, a).await.unwrap().contains(&b));

    relations::favorite_friend(&txn, b, a).await.unwrap();
    relations::block_user(&txn, a, b).await.unwrap();
    relations::block_user(&txn, a, b).await.unwrap();
    assert!(relations::has_blocked(&txn, a, b).await.unwrap());
    assert!(!relations::has_blocked(&txn, b, a).await.unwrap());
    assert!(relations::blocked_either_way(&txn, b, a).await.unwrap());
    // the block ended the friendship and both favorites
    assert!(!crate::db::social::is_friend(&txn, a, b).await.unwrap());
    assert!(!relations::favorite_ids(&txn, b).await.unwrap().contains(&a));
    let blocked = relations::blocked_people(&txn, a).await.unwrap();
    assert!(blocked.iter().any(|person| person.user_id == b));

    relations::unblock_user(&txn, a, b).await.unwrap();
    assert!(!relations::blocked_either_way(&txn, a, b).await.unwrap());

    txn.rollback().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn social_listening_profile_shows_what_privacy_allows() {
    let txn = scratch().await;
    let (owner, viewer) = two_users(&txn).await;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO privacy_settings (user_id, profile_playlists, profile_queries)
         VALUES ($1, 'nobody', 'everyone')
         ON CONFLICT (user_id) DO UPDATE
         SET profile_playlists = 'nobody', profile_queries = 'everyone'",
        [owner.into()],
    ))
    .await
    .unwrap();
    let row = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO saved_queries (user_id, name, query)
             VALUES ($1, 'profile test query', '{}'::jsonb) RETURNING saved_query_id",
            [owner.into()],
        ))
        .await
        .unwrap()
        .unwrap();
    let id: i64 = row.try_get("", "saved_query_id").unwrap();

    // playlists hidden from others, never from the owner
    assert!(
        playlists::profile_playlists(&txn, viewer, owner)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        playlists::profile_playlists(&txn, owner, owner)
            .await
            .unwrap()
            .is_some()
    );

    // a query not shared is neither listed nor readable by others
    let listed = |rows: Option<Vec<crate::db::entity::saved_queries::Model>>| {
        rows.unwrap().iter().any(|q| q.saved_query_id == id)
    };
    assert!(!listed(
        saved_queries::profile_queries(&txn, viewer, owner)
            .await
            .unwrap()
    ));
    assert!(matches!(
        saved_queries::get_viewable_saved_query(&txn, viewer, id).await,
        Err(CadenzaError::NotFound)
    ));

    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE saved_queries SET shared = true WHERE saved_query_id = $1",
        [id.into()],
    ))
    .await
    .unwrap();
    assert!(listed(
        saved_queries::profile_queries(&txn, viewer, owner)
            .await
            .unwrap()
    ));
    saved_queries::get_viewable_saved_query(&txn, viewer, id)
        .await
        .unwrap();

    // turned off, a shared query is hidden again
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE privacy_settings SET profile_queries = 'nobody' WHERE user_id = $1",
        [owner.into()],
    ))
    .await
    .unwrap();
    assert!(
        saved_queries::profile_queries(&txn, viewer, owner)
            .await
            .unwrap()
            .is_none()
    );
    assert!(matches!(
        saved_queries::get_viewable_saved_query(&txn, viewer, id).await,
        Err(CadenzaError::NotFound)
    ));

    txn.rollback().await.unwrap();
}
