//! What a "most played" ranking can be grouped by.
//!
//! A [`Dimension`] is a name plus the SQL that pulls the group key, the display
//! label, and the entity id out of a `play_counted` row. `db::analytics` reads
//! this to build one query, so adding a dimension is adding an entry to
//! [`Dimension::ALL`], not writing a handler.
//!
//! Playlists and queries are not properties of a song, they are where the play
//! started. The client records that on `play_counted` as `source_kind`,
//! `source_id` and `source_name`, and those two dimensions key on it. A play
//! with no source, or a source of the other kind, keys as null and is dropped.
//!
//! Tags are deliberately not here either. They group through a join to
//! `user_tags_applied` rather than a payload key, so they get their own query,
//! the same split `metrics` already documents for replays.

/// One thing a ranking can be grouped by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Dimension {
    /// What the client asks for it by.
    pub name: &'static str,
    /// The group key. Every expression here is interpolated into SQL, so each
    /// one must stay a literal written in this file and never come from a
    /// request.
    pub key_expr: &'static str,
    /// What to display. Null for songs, which the client resolves from Apple
    /// Music by id.
    pub label_expr: &'static str,
    /// A second line under the label, or null when there is nothing to say.
    pub sub_label_expr: &'static str,
    /// The id needed to open the thing, when the play recorded one.
    pub entity_id_expr: &'static str,
    pub description: &'static str,
}

impl Dimension {
    /// Every dimension a ranking can be grouped by.
    ///
    /// Each key is built from the *name*, not the id. An id-first key splits one
    /// artist into two rows the moment the same artist is played once from the
    /// catalog, where Apple gives an id, and once from a library-only copy,
    /// where it does not. Grouping on the lowercased name merges them. The cost
    /// is that two genuinely different artists who share a name merge too,
    /// which on a page about one person's listening is the better trade.
    pub const ALL: &[Dimension] = &[
        Dimension {
            name: "song",
            key_expr: "song_id",
            // Apple Music owns song titles and we never store one
            label_expr: "null::text",
            sub_label_expr: "null::text",
            entity_id_expr: "song_id",
            description: "Most played songs",
        },
        Dimension {
            name: "artist",
            // nullif comes after the trim, or a name of only spaces keys as an
            // empty string instead of null and survives the filter
            key_expr: "nullif(lower(btrim(payload->>'artist_name')), '')",
            label_expr: "payload->>'artist_name'",
            sub_label_expr: "null::text",
            entity_id_expr: "nullif(payload->>'artist_id', '')",
            description: "Most listened artists",
        },
        Dimension {
            name: "album",
            // the artist is part of the key, or every "Greatest Hits" in the
            // library collapses into one row
            // a blank album name nulls the first half, and null || anything is
            // null in postgres, so the whole key nulls and the row is filtered
            key_expr: "nullif(lower(btrim(payload->>'album_name')), '') || '|' \
                       || lower(btrim(coalesce(payload->>'artist_name', '')))",
            label_expr: "payload->>'album_name'",
            sub_label_expr: "payload->>'artist_name'",
            entity_id_expr: "nullif(payload->>'album_id', '')",
            description: "Most listened albums",
        },
        Dimension {
            name: "playlist",
            key_expr: "case when payload->>'source_kind' = 'playlist' \
                       then nullif(btrim(payload->>'source_id'), '') end",
            label_expr: "payload->>'source_name'",
            sub_label_expr: "null::text",
            entity_id_expr: "case when payload->>'source_kind' = 'playlist' \
                             then nullif(btrim(payload->>'source_id'), '') end",
            description: "Most played playlists",
        },
        Dimension {
            name: "query",
            // the id is the query itself, encoded by the client, so the same
            // query run twice is one row and the row can run it again
            key_expr: "case when payload->>'source_kind' = 'query' \
                       then nullif(btrim(payload->>'source_id'), '') end",
            label_expr: "payload->>'source_name'",
            sub_label_expr: "null::text",
            entity_id_expr: "case when payload->>'source_kind' = 'query' \
                             then nullif(btrim(payload->>'source_id'), '') end",
            description: "Most played queries",
        },
    ];

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|dimension| dimension.name == name)
    }

    /// The names a request may ask for, for an error message that tells the
    /// caller what it could have said instead.
    pub fn known_names() -> String {
        Self::ALL
            .iter()
            .map(|dimension| dimension.name)
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// Every expression, for the checks that apply to all of them.
    #[cfg(test)]
    fn expressions(&self) -> [&'static str; 4] {
        [
            self.key_expr,
            self.label_expr,
            self.sub_label_expr,
            self.entity_id_expr,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_unique() {
        let mut names: Vec<&str> = Dimension::ALL.iter().map(|d| d.name).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), before, "two dimensions share a name");
    }

    #[test]
    fn names_round_trip() {
        for &dimension in Dimension::ALL {
            assert_eq!(Dimension::from_name(dimension.name), Some(dimension));
        }
        assert_eq!(Dimension::from_name("genre"), None);
        assert_eq!(Dimension::from_name(""), None);
    }

    /// Expressions are interpolated into SQL, so nothing in one may end the
    /// expression or start another statement. This is the real guard, since
    /// these never pass through a bound parameter.
    #[test]
    fn expressions_carry_no_statement_breaks() {
        for &dimension in Dimension::ALL {
            for expression in dimension.expressions() {
                assert!(
                    !expression.contains(';'),
                    "{} has a semicolon in {expression}",
                    dimension.name
                );
                assert!(
                    !expression.contains("--"),
                    "{} has a comment in {expression}",
                    dimension.name
                );
            }
        }
    }

    #[test]
    fn every_dimension_is_described_and_complete() {
        for &dimension in Dimension::ALL {
            assert!(!dimension.description.is_empty(), "{}", dimension.name);
            for expression in dimension.expressions() {
                assert!(!expression.is_empty(), "{}", dimension.name);
            }
        }
    }

    /// The id-first key is the bug this guards against: it would split one
    /// artist across a catalog play and a library play.
    #[test]
    fn artist_and_album_group_on_the_name_not_the_id() {
        for name in ["artist", "album"] {
            let dimension = Dimension::from_name(name).unwrap();
            assert!(
                dimension.key_expr.contains("_name"),
                "{name} must key on the name"
            );
            assert!(
                !dimension.key_expr.contains("_id"),
                "{name} must not key on an id"
            );
        }
    }

    #[test]
    fn the_album_key_separates_two_albums_that_share_a_title() {
        let album = Dimension::from_name("album").unwrap();
        assert!(
            album.key_expr.contains("artist_name"),
            "the album key needs the artist in it"
        );
    }

    /// A source dimension has to check the kind, or a playlist's id would
    /// rank as a query too.
    #[test]
    fn source_dimensions_key_on_their_own_kind() {
        for name in ["playlist", "query"] {
            let dimension = Dimension::from_name(name).unwrap();
            let kind = format!("'source_kind' = '{name}'");
            assert!(dimension.key_expr.contains(&kind), "{name}");
            assert!(dimension.entity_id_expr.contains(&kind), "{name}");
        }
    }

    #[test]
    fn known_names_lists_every_dimension() {
        let listed = Dimension::known_names();
        for &dimension in Dimension::ALL {
            assert!(listed.contains(dimension.name), "{listed}");
        }
    }
}
