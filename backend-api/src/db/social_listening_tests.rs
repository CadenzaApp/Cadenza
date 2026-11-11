//! Database tests for invites, shared playlists, live sessions, and now
//! playing. Each runs inside one transaction that is rolled back, against two
//! real accounts from `profile`, so the raw SQL is exercised without leaving
//! anything behind. Ignored by default like the other database tests:
//!
//! ```sh
//! cargo test social_listening -- --ignored
//! ```

use sea_orm::{
    ConnectionTrait, Database, DatabaseTransaction, DbBackend, Statement, TransactionTrait,
    prelude::Uuid,
};

use crate::db::{
    invites::{InviteTargetRef, NewInvite, create_invite, redeem_invite},
    live_sessions::{self as sessions, NewQueueSong, PlaybackCommand},
    now_playing::{self, NowPlayingUpdate},
    shared_playlists::{self as playlists, MemberRemoved, PlaylistRole},
};
use crate::err::CadenzaError;
use crate::services::live_sessions::SessionRole;

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
    assert_eq!(summary.role, "owner");

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
            grants_role: Some("editor".into()),
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
                listen_along: false
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

    sessions::host_report(&txn, host, id, None, 5_000, false)
        .await
        .unwrap();
    let snap = sessions::get_snapshot(&txn, guest, id).await.unwrap();
    assert!(!snap.playback.is_playing);
    assert_eq!(snap.playback.position_ms, 5_000);

    sessions::set_member_role(&txn, host, id, guest, SessionRole::Controller)
        .await
        .unwrap();
    sessions::playback_command(&txn, guest, id, PlaybackCommand::Play)
        .await
        .unwrap();
    sessions::set_listen_mode(&txn, guest, id, "synced")
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
    assert_eq!(snap.my_listen_mode, "synced");
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
    sessions::host_report(&txn, host, id, Some(current), 9_000, false)
        .await
        .unwrap();
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
