use std::fmt;

use sea_orm::{
    ActiveValue::Set,
    ColumnTrait, ConnectionTrait, EntityTrait, Insert, QueryFilter, UpdateMany,
    prelude::Uuid,
    sea_query::{Expr, ExprTrait, OnConflict},
};

use crate::db::entity::{default_tag_activity, tags};
use crate::db::tags::add_default_tag_to_song;
use crate::err::CadenzaError;

/// The fewest counts, applies and removes together, a tag name needs on a song
/// before it can become one of the song's default tags.
const MIN_COUNTS_TO_PROMOTE: i32 = 10;

/// What a user did to a tag name on a song, and so which `default_tag_activity`
/// count moved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TagActivity {
    /// A user put a tag of that name on the song, so `apply_count` went up.
    Applied,
    /// A user took their tag of that name back off the song, so `apply_count`
    /// went back down.
    Unapplied,
    /// A user removed the song's suggested tag of that name, so `remove_count`
    /// went up.
    Removed,
}

/// Formats the activity as the middle of the line [`RecordedActivity`] logs.
impl fmt::Display for TagActivity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            TagActivity::Applied => "applied",
            TagActivity::Unapplied => "unapplied",
            TagActivity::Removed => "removed the suggested tag",
        })
    }
}

/// A count this module wrote in a transaction that has not committed yet. Call
/// [`RecordedActivity::log`] once the transaction commits, so a rolled back
/// count is never logged.
#[must_use]
pub struct RecordedActivity {
    user_id: Uuid,
    song_id: String,
    tag_name: String,
    activity: TagActivity,
    /// The row's counts after the change, or `None` if there was no row to take
    /// an apply off.
    counts: Option<(i32, i32)>,
    /// Whether this made the tag name a default tag on the song.
    promoted: bool,
}

impl RecordedActivity {
    /// Logs the count. Call this after the transaction that wrote it commits.
    pub fn log(self) {
        println!("{self}");
    }
}

/// Formats the count as the line [`RecordedActivity::log`] prints, e.g.
/// `tag activity: user 5f0c... applied "rock" on song 1440857781, now 4 applies 1 removes`
impl fmt::Display for RecordedActivity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let RecordedActivity {
            user_id,
            song_id,
            tag_name,
            activity,
            counts,
            promoted,
        } = self;

        write!(
            f,
            "tag activity: user {user_id} {activity} {tag_name:?} on song {song_id}"
        )?;

        match counts {
            Some((applies, removes)) => write!(f, ", now {applies} applies {removes} removes")?,
            None => write!(f, ", nothing to take back")?,
        }

        if *promoted {
            write!(f, ", made it a default tag")?;
        }

        Ok(())
    }
}

/// Adds one to the tag name's `apply_count` on the song in
/// `default_tag_activity`, creating the row if there isn't one. The caller
/// counts only when it really put the tag on the song, so nobody is counted
/// twice.
///
/// If this is the apply that promotes the name (see [`apply_promotes_tag`]), puts
/// it on the song as a default tag with `tags::add_default_tag_to_song`. The
/// activity row stays either way, and users' tags are left alone.
///
/// Returns the count to log with [`RecordedActivity::log`] after the commit.
///
/// Only `tags::apply_user_tag` counts here.
pub async fn count_tag_applied(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    song_id: &str,
    tag: &tags::Model,
) -> Result<RecordedActivity, CadenzaError> {
    let counts = apply_upsert(song_id, &tag.name)
        .exec_with_returning(db)
        .await?;

    let mut recorded = RecordedActivity {
        user_id,
        song_id: song_id.to_owned(),
        tag_name: tag.name.clone(),
        activity: TagActivity::Applied,
        counts: Some((counts.apply_count, counts.remove_count)),
        promoted: false,
    };

    // enough users agree on the name, so it becomes one of the song's default
    // tags. the row stays and keeps counting, so only the apply that crosses the
    // line does this.
    if apply_promotes_tag(counts.apply_count, counts.remove_count) {
        add_default_tag_to_song(db, song_id, &tag.name, &tag.color).await?;
        recorded.promoted = true;
    }

    Ok(recorded)
}

/// Takes one back off the tag name's `apply_count` on the song. The caller counts
/// only when it really took the tag off the song.
///
/// Never counts below zero, and does nothing when there is no row, which only
/// happens for a tag applied before any of this was counted. Cannot promote the
/// name, since it only lowers `apply_count`.
///
/// Returns the count to log with [`RecordedActivity::log`] after the commit.
///
/// Only `tags::unapply_user_tag` counts here.
pub async fn count_tag_unapplied(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    song_id: &str,
    tag_name: &str,
) -> Result<RecordedActivity, CadenzaError> {
    let counts = apply_decrement(song_id, tag_name)
        .exec_with_returning(db)
        .await?;

    Ok(RecordedActivity {
        user_id,
        song_id: song_id.to_owned(),
        tag_name: tag_name.to_owned(),
        activity: TagActivity::Unapplied,
        counts: counts
            .first()
            .map(|row| (row.apply_count, row.remove_count)),
        promoted: false,
    })
}

/// Adds one to the tag name's `remove_count` on the song in
/// `default_tag_activity`, creating the row if there isn't one. The caller counts
/// only on a user's first removal of that suggested tag, so nobody can run the
/// count up.
///
/// Does not promote the name. A user can only remove a suggested tag that is
/// already a default tag on the song, so there is nothing left to promote.
///
/// Returns the count to log with [`RecordedActivity::log`] after the commit.
///
/// Only `tags::remove_default_tag_from_song` counts here.
pub async fn count_tag_removed(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    song_id: &str,
    tag_name: &str,
) -> Result<RecordedActivity, CadenzaError> {
    let counts = remove_upsert(song_id, tag_name)
        .exec_with_returning(db)
        .await?;

    Ok(RecordedActivity {
        user_id,
        song_id: song_id.to_owned(),
        tag_name: tag_name.to_owned(),
        activity: TagActivity::Removed,
        counts: Some((counts.apply_count, counts.remove_count)),
        promoted: false,
    })
}

/// Returns whether a tag name's counts on a song make it one of the song's
/// default tags: at least [`MIN_COUNTS_TO_PROMOTE`] applies and removes together,
/// and more than 1.5 times as many applies as removes.
fn counts_promote_tag(apply_count: i32, remove_count: i32) -> bool {
    let (applies, removes) = (i64::from(apply_count), i64::from(remove_count));

    // applies > 1.5 * removes, kept in integers
    applies + removes >= i64::from(MIN_COUNTS_TO_PROMOTE) && 2 * applies > 3 * removes
}

/// Returns whether the apply that left a tag name at these counts on a song is
/// the one that makes it a default tag there: the counts qualify now and did not
/// before that apply. The activity row is never deleted, so without this every
/// later apply would promote the same name again.
fn apply_promotes_tag(apply_count: i32, remove_count: i32) -> bool {
    counts_promote_tag(apply_count, remove_count)
        && !counts_promote_tag(apply_count - 1, remove_count)
}

/// Returns the upsert that adds one to the tag name's `apply_count` on the song.
fn apply_upsert(song_id: &str, tag_name: &str) -> Insert<default_tag_activity::ActiveModel> {
    let row = default_tag_activity::ActiveModel {
        song_id: Set(song_id.to_owned()),
        tag_name: Set(tag_name.to_owned()),
        apply_count: Set(1),
        remove_count: Set(0),
    };

    count_insert(row, default_tag_activity::Column::ApplyCount)
}

/// Returns the upsert that adds one to the tag name's `remove_count` on the song.
fn remove_upsert(song_id: &str, tag_name: &str) -> Insert<default_tag_activity::ActiveModel> {
    let row = default_tag_activity::ActiveModel {
        song_id: Set(song_id.to_owned()),
        tag_name: Set(tag_name.to_owned()),
        apply_count: Set(0),
        remove_count: Set(1),
    };

    count_insert(row, default_tag_activity::Column::RemoveCount)
}

/// Returns the insert of `row`, which on an existing row adds one to `counted`
/// instead.
fn count_insert(
    row: default_tag_activity::ActiveModel,
    counted: default_tag_activity::Column,
) -> Insert<default_tag_activity::ActiveModel> {
    // qualified, since postgres finds a bare column name ambiguous in DO UPDATE
    let count = Expr::col((default_tag_activity::Entity, counted));

    let mut on_conflict = OnConflict::columns([
        default_tag_activity::Column::SongId,
        default_tag_activity::Column::TagName,
    ]);
    on_conflict.value(counted, count.add(1));

    default_tag_activity::Entity::insert(row).on_conflict(on_conflict)
}

/// Returns the update that takes one off the tag name's `apply_count` on the
/// song. It matches nothing when the row is gone or already at zero, so a count
/// never goes negative.
fn apply_decrement(song_id: &str, tag_name: &str) -> UpdateMany<default_tag_activity::Entity> {
    default_tag_activity::Entity::update_many()
        .col_expr(
            default_tag_activity::Column::ApplyCount,
            Expr::col(default_tag_activity::Column::ApplyCount).sub(1),
        )
        .filter(default_tag_activity::Column::SongId.eq(song_id))
        .filter(default_tag_activity::Column::TagName.eq(tag_name))
        .filter(default_tag_activity::Column::ApplyCount.gt(0))
}

#[cfg(test)]
mod tests {
    use sea_orm::{DbBackend, QueryTrait};

    use super::*;

    /// An activity on a tag name of a song that left the row at `counts`.
    fn recorded(activity: TagActivity, counts: Option<(i32, i32)>) -> RecordedActivity {
        RecordedActivity {
            user_id: Uuid::nil(),
            song_id: "1440857781".to_owned(),
            tag_name: "rock".to_owned(),
            activity,
            counts,
            promoted: false,
        }
    }

    #[test]
    fn counts_promote_tag_needs_ten_counts_and_over_one_and_a_half_times_as_many_applies() {
        // too few counts, however many are applies
        assert!(!counts_promote_tag(9, 0));

        // enough counts, with applies over 1.5 times removes
        assert!(counts_promote_tag(10, 0));
        assert!(counts_promote_tag(9, 1));
        assert!(counts_promote_tag(7, 4));

        // exactly 1.5 times is not more than it
        assert!(!counts_promote_tag(6, 4));
        assert!(!counts_promote_tag(3, 7));
    }

    #[test]
    fn only_the_apply_that_crosses_the_line_promotes_the_tag() {
        // the tenth apply promotes the name
        assert!(!apply_promotes_tag(9, 0));
        assert!(apply_promotes_tag(10, 0));

        // the row is never deleted, so applies past the line keep counting
        // without promoting the name again
        assert!(!apply_promotes_tag(11, 0));

        // removes can hold a name back until the applies outrun them
        assert!(!apply_promotes_tag(6, 4));
        assert!(apply_promotes_tag(7, 4));
        assert!(!apply_promotes_tag(8, 4));
    }

    #[test]
    fn recorded_activity_log_line_shows_how_the_counts_changed() {
        // an apply shows the counts it left
        assert_eq!(
            recorded(TagActivity::Applied, Some((3, 1))).to_string(),
            r#"tag activity: user 00000000-0000-0000-0000-000000000000 applied "rock" on song 1440857781, now 3 applies 1 removes"#
        );

        // the apply that made the name a default tag says so
        let promoted = RecordedActivity {
            promoted: true,
            ..recorded(TagActivity::Applied, Some((10, 0)))
        };
        assert_eq!(
            promoted.to_string(),
            r#"tag activity: user 00000000-0000-0000-0000-000000000000 applied "rock" on song 1440857781, now 10 applies 0 removes, made it a default tag"#
        );

        // an unapply shows the counts it left
        assert_eq!(
            recorded(TagActivity::Unapplied, Some((2, 1))).to_string(),
            r#"tag activity: user 00000000-0000-0000-0000-000000000000 unapplied "rock" on song 1440857781, now 2 applies 1 removes"#
        );

        // there is no row to take an apply off for a tag applied before any of
        // this was counted
        assert_eq!(
            recorded(TagActivity::Unapplied, None).to_string(),
            r#"tag activity: user 00000000-0000-0000-0000-000000000000 unapplied "rock" on song 1440857781, nothing to take back"#
        );

        // a removed suggested tag shows the counts it left
        assert_eq!(
            recorded(TagActivity::Removed, Some((3, 2))).to_string(),
            r#"tag activity: user 00000000-0000-0000-0000-000000000000 removed the suggested tag "rock" on song 1440857781, now 3 applies 2 removes"#
        );
    }

    #[test]
    fn apply_upsert_counts_an_apply() {
        let sql = apply_upsert("song", "rock")
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"INSERT INTO "default_tag_activity" ("song_id", "tag_name", "apply_count", "remove_count") VALUES ('song', 'rock', 1, 0) ON CONFLICT ("song_id", "tag_name") DO UPDATE SET "apply_count" = "default_tag_activity"."apply_count" + 1"#
        );
    }

    #[test]
    fn remove_upsert_counts_a_remove() {
        let sql = remove_upsert("song", "rock")
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"INSERT INTO "default_tag_activity" ("song_id", "tag_name", "apply_count", "remove_count") VALUES ('song', 'rock', 0, 1) ON CONFLICT ("song_id", "tag_name") DO UPDATE SET "remove_count" = "default_tag_activity"."remove_count" + 1"#
        );
    }

    #[test]
    fn apply_decrement_takes_an_apply_off_a_count_above_zero() {
        let sql = apply_decrement("song", "rock")
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"UPDATE "default_tag_activity" SET "apply_count" = "apply_count" - 1 WHERE "default_tag_activity"."song_id" = 'song' AND "default_tag_activity"."tag_name" = 'rock' AND "default_tag_activity"."apply_count" > 0"#
        );
    }
}
