# routes

HTTP handlers. One module per resource, each exposing a `get_*_router() -> Router<AppState>`
that `main.rs` nests under a path prefix. Handlers stay thin: they pull state, check auth,
call into `src/db/` or `src/services/`, and shape the response.

## Files

| file                   | role                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.rs`               | Declares `json`, `analytics`, `events`, `profile`, `queries`, `settings`, `social`, `tags`, `songs`.                                                                                   |
| `tags.rs`              | Tag CRUD for the signed-in user, default tag search, listing the activity tags, plus LLM tag suggestion. Mounted at `/tags`.                                                           |
| `songs.rs`             | Adding and removing the user's songs, reading and changing user tags, reading default tags, reading activity tags, recording plays, and reporting an opened song. Mounted at `/songs`. |
| `queries.rs`           | Runs a tag query and returns song ids by relevance. Mounted at `/queries`.                                                                                                             |
| `profile.rs`           | Reading, creating, and editing the signed-in user's public profile (username and bio). Mounted at `/profile`.                                                                          |
| `settings.rs`          | Reading and changing the signed-in user's private settings: theme mode, accent, glass, explicit filter, tag suggestions. Mounted at `/settings`.                                       |
| `events.rs`            | Ingests a batch of listening events, and moves the activity tags they feed (plays, favorites) in the same transaction. Mounted at `/events`.                                           |
| `analytics.rs`         | Summary counts, time bucketed trends, the metric list, and the rankings (song, artist, album, playlist, query). Mounted at `/analytics`.                                               |
| `social.rs`            | The social feed, posts, likes, comments, views, topic posts, and interest scores. Calls the python model only for embeddings and similarity. Mounted at `/social`.                     |
| `json/mod.rs`          | `vec_into`, a small `Vec<A> -> Vec<B>` helper. Declares `analytics`, `metadata_tag`, `profile`, `query`, `settings`, `social`, and `tag`.                                              |
| `json/analytics.rs`    | The `/events` request and response shapes, and the `/analytics` response shapes.                                                                                                       |
| `json/tag.rs`          | `TagType`, `Tag`, and `AppliedTag`, the wire shapes of a tag. `From<tags::Model>` drops `user_id` and keeps `is_activity`.                                                             |
| `json/metadata_tag.rs` | `MetadataTag` and `metadata_tags_of`, a song's stored metadata as read-only `{key, type, value}` tags.                                                                                 |
| `json/profile.rs`      | `Profile`, the wire shape of a public profile (`uid`, `username`, `bio`).                                                                                                              |
| `json/settings.rs`     | `UserSettings` and `PatchUserSettings`. A missing key is left alone. `null` resets a color or slot list, and is ignored on the other fields.                                                                                      |
| `json/social.rs`       | `SocialPost`, `SocialComment`, `SocialUserProfile`, and the feed, create-post, user-posts, topic-posts, and comments response envelopes.                                               |
| `json/query.rs`        | `Query`, `QueryNode`, `Filter`, `FilterOp`, `MetadataKey`: the input schema of a tag query. Both client builders produce it.                                                           |

## Endpoints

Every route below requires `Authorization: Bearer <supabase jwt>`.

| method | path                         | input                                                                                           | output                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/tags`                      | none                                                                                            | `{"All": {tags: [Tag], metadata: {tag_id: {count}}}}`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/tags?tag_id=N`             | query param                                                                                     | `{"One": {tag, song_ids}}`, 404 if the tag does not belong to the signed-in user                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/tags`                      | `{name, color, type?}`                                                                          | the new tag id, as a bare number in the body; 409 when the user already owns that normalized name                                                                                                                                                                                                                                                                                                                                                                     |
| PATCH  | `/tags`                      | `{tag_id, name?, color?}`                                                                       | the updated tag. 404 if the tag is not yours; 409 when its new name matches another tag you own                                                                                                                                                                                                                                                                                                                                                                       |
| DELETE | `/tags`                      | `{tag_id}`                                                                                      | empty. Silently no-ops if the tag is not yours                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET    | `/tags/default-tags`         | `?search=...`                                                                                   | `[Tag]`, at most 5 default tags matching the search, most used first                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET    | `/tags/activity`             | none                                                                                            | `[Tag]`, every activity tag in display order. The same for every user                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/tags/suggest`              | `?song_desc=...&requested_tag_count=N`                                                          | `[{name, color}, ...]`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PATCH  | `/songs`                     | `{add: [...], remove: [...]}`                                                                   | empty. Adds and removes the user's songs                                                                                                                                                                                                                                                                                                                                                                                                                              |
| GET    | `/songs/local-tags`          | `?song_id=...`                                                                                  | `[AppliedTag]`, the user's tags on that song                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/songs/local-tags/batch`    | `{song_ids: [...]}`                                                                             | `{song_id: [AppliedTag]}`, an entry per requested song                                                                                                                                                                                                                                                                                                                                                                                                                |
| PATCH  | `/songs/local-tags/batch`    | `{song_ids: [...], tag_ids: [...]}`                                                             | empty. Applies every tag to every song, preserving existing applications and values                                                                                                                                                                                                                                                                                                                                                                                   |
| DELETE | `/songs/local-tags/batch`    | `{song_ids: [...], tag_ids: [...]}`                                                             | empty. Removes every tag from every song; missing applications are ignored                                                                                                                                                                                                                                                                                                                                                                                            |
| GET    | `/songs/default-tags`        | `?song_id=...`                                                                                  | `[Tag]`, the shared default tags on that song, minus the ones this user removed. Generates them first if the song has never had them                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/songs/default-tags/batch`  | `{song_ids: [...]}`                                                                             | `{song_id: [Tag]}`, the same read for a list of songs, an entry per requested song. Generates for any that have never had defaults                                                                                                                                                                                                                                                                                                                                    |
| DELETE | `/songs/default-tags`        | `{song_id, tag_id}`                                                                             | empty. Records that this user removed the suggested tag and counts it. 404 if the tag is not a default tag on the song                                                                                                                                                                                                                                                                                                                                                |
| POST   | `/songs/local-tags`          | `{song_id, tag_id, value?}`                                                                     | empty. Also votes for the tag name                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| PATCH  | `/songs/local-tags`          | `{song_id, tag_id, value}`                                                                      | empty. A null value clears it                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| DELETE | `/songs/local-tags`          | `{song_id, tag_id}`                                                                             | empty. Takes that vote back when it removes the tag                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/songs/activity-tags`       | `?song_id=...`                                                                                  | `[AppliedTag]`, every activity tag with this user's value on that song. Never played: My Plays is `"0"`, the dates `null`                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/songs/activity-tags/batch` | `{song_ids: [...]}`                                                                             | `{song_id: [AppliedTag]}`, the same read for a list of songs, an entry per requested song                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/songs/plays`               | `{song_id}`                                                                                     | empty. Counts one play at the server's clock: My Plays +1, First Played and Last Played moved as needed, and the song's Total Plays +1. Superseded by `POST /events` with a `play_counted` event, which does the same thing and also records the event. Kept for app builds already in the field; the current client does not call it                                                                                                                                 |
| POST   | `/songs/metadata/opened`     | `{song_id}`                                                                                     | empty. The song was opened in the player: stores its Apple Music metadata for metadata queries if it has none, queues its album, and wakes the metadata crawl so the album is stored within seconds. Nothing the client shows depends on it, so the client does not wait on it                                                                                                                                                                                        |
| GET    | `/songs/metadata-tags`       | `?song_id=...`                                                                                  | `[{key, type, value}]`, the song's Apple Music metadata as stored for queries, typed the way a query reads it: title, artist, album, genre (text), release_date (date), duration (number, milliseconds), explicit (checkbox), total_plays (number, every user's counted plays). Stores the song first if it has no row. Empty for a song Apple has no entry for                                                                                                       |
| POST   | `/events`                    | `{events: [{type, song_id?, occurred_at, client_tz?, session_id?, client_event_id, payload?}]}` | `{accepted: [client_event_id]}`, the ids now stored. Idempotent per `client_event_id`, so a retry stores nothing and still reports them. At most 500 events. 422 if any event has an unknown type, a bad payload, or an `occurred_at` over 10 minutes ahead                                                                                                                                                                                                           |
| GET    | `/analytics/summary`         | `?since=&until=&tz=`                                                                            | one flat object of counts, rates, `active_days`, `tags_played`, `plays_by_hour`, `top_tags` (up to 50), `most_replayed`, and `top`: a ranking per dimension keyed by its name, the same way `stats` is keyed by metric. Zeros and empty lists for a user with no events                                                                                                                                                                                               |
| GET    | `/analytics/trends`          | `?metric=&bucket=hour\|two_hour\|day\|week\|month\|year\|auto&since=&until=&tz=`                | `{metric, description, unit, bucket, points: [{bucket, value}]}`. `bucket` on a point is a local `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MI` for an hour. Dense: an empty bucket is a zero, and `until` is exclusive so a seven day window is seven buckets. `unit` is `count` or `milliseconds`, so a client can format any metric without knowing it by name. `bucket` defaults to `week`, `auto` lets the server pick, and the window defaults to the user's whole history |
| GET    | `/analytics/top`             | `?dimension=song\|artist\|album\|playlist\|query&since=&until=&limit=`                          | `{dimension, description, entries: [{key, label, sub_label, entity_id, sample_song_id, plays}]}`, most played first. `label` is null for songs, whose titles live in Apple Music. `limit` defaults to 20, clamped to 1..=100. 422 on an unknown dimension                                                                                                                                                                                                             |
| GET    | `/analytics/top-tags`        | `?since=&until=&limit=`                                                                         | `{entries: [{id, name, color, type, plays, sample_song_id}]}`, the user's own tags by plays of the songs carrying them. `sample_song_id` is the tag's most played song in the window, for a cover. Activity tags are left out                                                                                                                                                                                                                                         |
| GET    | `/analytics/heatmap`         | `?bucket=hour\|two_hour\|day\|week\|month\|year&since=&until=&tz=`                              | `{bucket, cells: [{start, plays, tag_id}], tags: [{id, name, color}]}`. Sparse: only buckets with a play. `two_hour` starts on even local hours and prints like an hour. `tag_id` is the tag played most in that bucket, ties to the name, null when nothing played carried one. `tags` lists each named tag once. `bucket` defaults to `day`, and the window is checked against the bucket cap like a trend                                                          |
| GET    | `/analytics/tag-shares`      | `?since=&until=`                                                                                | `{total_ms, tagged_ms, tags: [{id, name, color, type, listening_ms}]}`. `total_ms` is the window's listening time, the summary's `listening_ms`. `tagged_ms` is the part on songs with any of the tags, each listen once. Each tag's `listening_ms` is the time on songs carrying it, every listen counted in full toward every tag on its song, so tags can sum past the total. Most first, every tag with any time, the user's own only                             |
| POST   | `/queries/results`           | `{query, consider_default_tags?, library_only?, hide_explicit?, sort?}`                         | `{songs: [{song_id, certain}], capped}`, in order. `sort` is `{key, direction}`, key `title`, `artist` or `album`, direction `ascending` or `descending`; without it, most relevant first. Every match that is the caller's own (`certain`) comes back, and the first 1000 of the rest. `capped` is true when more matched. `hide_explicit` drops songs whose stored rating is explicit, before the cap                                                               |
| GET    | `/profile`                   | none                                                                                            | `{uid, username, bio}`, the signed-in user's profile. 404 if there is no row                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/profile`                   | `{username?, bio?}` or empty                                                                    | the new `{uid, username, bio}`. Username defaults to the email local part. 409 `ProfileAlreadyExists` or `UsernameAlreadyTaken`                                                                                                                                                                                                                                                                                                                                       |
| PATCH  | `/profile`                   | `{username?, bio?}`                                                                             | the updated `{uid, username, bio}`. At least one field required. 404 if the user has no profile; 409 `UsernameAlreadyTaken`                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/settings`                  | none                                                                                            | `{theme_mode, accent_color, background_color, glass_tint, glass_style, accent_swatches, glass_tint_swatches, tag_color_swatches, background_swatches, hide_explicit, show_suggested_tags}`. Defaults when the user has no row                                                                                                                                                                                                                                                                                                                                      |
| PATCH  | `/settings`                  | any subset of the GET fields                                                                    | the full settings after the change. Creates the row on first change. 422 `InvalidRequestBody` for an empty body, a color that is not `#rrggbb`, or a swatch list over 24 slots. An unknown `theme_mode` or `glass_style` is axum's plain 422                                                                                                                                                                                                                                                                                         |
| GET    | `/social/feed`               | `?exclude=none\|loaded\|viewed` (default `none`)                                                | `{feed: [SocialPost]}`, at most 10, ranked. Marks returned ids `loaded`. `SocialPost` is `{post_id, content, likes, liked, created_at, author: {user_id, username}, topic_mk_id, comment_count}` (`topic_mk_id` is an Apple Music catalog id or `null`)                                                                                                                                                                                                               |
| PATCH  | `/social/interests/update`   | `{delta_scores: [{name, itype, delta}]}`                                                        | `null`. `itype` is `genre` or `artist`. A new name is embedded on first use                                                                                                                                                                                                                                                                                                                                                                                           |
| PATCH  | `/social/interests/decay`    | none                                                                                            | `null`. No-op when the user decayed in the last 6 hours or their top score is under 5                                                                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/social/posts`              | `{content, topic_mk_id?, topic_song_title?, topic_artist_name?}`                                | `{post_id}`. `content` is at most 500 characters and is stored as sent. `topic_mk_id` is an optional Apple Music catalog id, at most 128 characters. Song and artist names (at most 200 characters) prefix the embedding only: `About the song {title} by {artist}: ` or `About the music artist {name}: `                                                                                                                                                            |
| POST   | `/social/posts/views`        | `{post_ids: [n]}`                                                                               | `null`. Sets those posts to `viewed`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET    | `/social/posts/topic`        | `?topic_mk_id=`                                                                                 | `{posts: [SocialPost]}`, most liked first, then newest, then post id. `topic_mk_id` is required and at most 128 characters; blank is 422                                                                                                                                                                                                                                                                                                                              |
| GET    | `/social/posts/user/:id`     | path author id                                                                                  | `{profile: {user_id, username, bio}, posts: [SocialPost]}`, newest first. A missing profile uses username `"unknown"` and an empty bio                                                                                                                                                                                                                                                                                                                                |
| POST   | `/social/posts/:id/likes`    | `{timestamp}`                                                                                   | `null`. `timestamp` is the click time in ms. An older click for the same user and post is ignored                                                                                                                                                                                                                                                                                                                                                                     |
| DELETE | `/social/posts/:id/likes`    | `{timestamp}`                                                                                   | `null`. Same timestamp rule as like                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/social/posts/:id/comments` | none                                                                                            | `{comments: [SocialComment]}`, most liked first, then newest, then comment id. `SocialComment` is `{comment_id, post_id, content, likes, liked, created_at, author: {user_id, username}}`                                                                                                                                                                                                                                                                             |
| POST   | `/social/posts/:id/comments` | `{content}`                                                                                     | `{comment_id}`. `content` is at most 500 characters. 404 when the post is gone                                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/social/comments/:id/likes` | `{timestamp}`                                                                                   | `null`. Same timestamp rule as post likes, per user and comment                                                                                                                                                                                                                                                                                                                                                                                                       |
| DELETE | `/social/comments/:id/likes` | `{timestamp}`                                                                                   | `null`. Same timestamp rule as like                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/test`                      | none                                                                                            | `server is reachable`. Defined inline in `main.rs`, not here                                                                                                                                                                                                                                                                                                                                                                                                          |

`GET /tags` returns a serde-tagged enum, so the two shapes come back wrapped in `"One"` or
`"All"`. The client mirrors that in `client-app/src/lib/routes/tags.ts`.

`metadata` is keyed by tag id, separate from the `tags` array, so the client can look up a
count without walking the list.

`AppliedTag` is a `Tag` with the applied value flattened in, so it serializes as the tag's own
fields plus `value`. Both local-tag reads use it. `value` is always null for a basic tag, and null
for an attribute tag applied without one. Default tags have no values, so their read returns
`Tag` instead.

`type` on `POST /tags` and `POST` / `PATCH /songs/local-tags` is one of `basic`, `text`, `datetime`,
`date`, `number`, `checkbox` (see `sea_orm_active_enums::TagType`), and defaults to `basic` when omitted.
A `value` that does not fit the tag's type (not a number, not RFC 3339, not a
`YYYY-MM-DD` date, not `true`/`false`, or
any non-blank value on a `basic` tag) is rejected with `CadenzaError::InvalidTagValue` (422). See
[../services/README.md](../services/README.md) for the exact per-type rules.

`/social` reads and writes posts, likes, comments, view status, and interest scores in postgres.
The user id always comes from the JWT. A call the python model cannot answer is
`SocialFeedErr` (502). What that process accepts is in
[../../ml-service/README.md](../../ml-service/README.md). The app hooks are in
`client-app/src/lib/routes/social.ts`.

### Query JSON

`query` on `/queries/results` is a `Query`. There is one query format; the drag
and drop builder is the subset of it that only uses `is_applied` and
`is_not_applied` tag filters:

```json
{
  "where": {
    "and": [
      {
        "filter": {
          "field": "tag",
          "tag_id": 4,
          "op": "on_or_after",
          "value": "1950-01-01"
        }
      },
      {
        "filter": {
          "field": "tag",
          "tag_id": 7,
          "op": "before",
          "value": "2024-06-01T18:30:00Z"
        }
      },
      {
        "not": {
          "or": [
            {
              "filter": {
                "field": "tag_name",
                "op": "contains",
                "value": "live"
              }
            },
            {
              "filter": { "field": "tag_type", "op": "is", "value": "checkbox" }
            }
          ]
        }
      }
    ]
  }
}
```

- `where` is the only top-level key. Anything else, including the old `timezone`, is rejected.
- A node is exactly one of `{"and": [node]}`, `{"or": [node]}`, `{"not": node}`,
  `{"filter": filter}`. The advanced builder's "none of the following" group is
  `{"not": {"or": [...]}}`.
- A filter is tagged by `field`: `tag` (with `tag_id`), `tag_name`, `tag_value`, `tag_type`, or
  `metadata` (with `key`). `value` is always a string, and is omitted (or null) for operators that
  take none.

| field                                    | ops                                                                                           | value                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| `tag`, any tag type                      | `is_applied`, `is_not_applied`                                                                | none                                    |
| `tag`, text tag; `tag_name`; `tag_value` | `is`, `is_not`, `starts_with`, `ends_with`, `contains` / `is_empty`                           | text / none                             |
| `tag`, datetime tag                      | `on`, `not_on`, `before`, `after`, `on_or_before`, `on_or_after` / `is_empty`, `is_not_empty` | RFC 3339, compared to the minute / none |
| `tag`, date tag                          | same as datetime                                                                              | `YYYY-MM-DD` / none                     |
| `tag`, number tag                        | `eq`, `ne`, `lt`, `le`, `gt`, `ge` / `is_empty`, `is_not_empty`                               | a number as a string / none             |
| `tag`, checkbox tag                      | `is_true`, `is_false`, `is_null`                                                              | none                                    |
| `tag_type`                               | `is`, `is_not`                                                                                | a tag type                              |
| `metadata`, a text key                   | same as a text tag, without the applied ops                                                   | text / none                             |
| `metadata`, `release_date`               | same as a date tag, without the applied ops                                                   | `YYYY-MM-DD` / none                     |
| `metadata`, `duration`                   | same as a number tag, without the applied ops                                                 | milliseconds as a string / none         |
| `metadata`, `explicit`                   | `is_true`, `is_false`                                                                         | none                                    |
| `metadata`, `total_plays`                | `eq`, `ne`, `lt`, `le`, `gt`, `ge`                                                            | a number as a string                    |

Basic tags only take `is_applied` / `is_not_applied`. Every other type takes them too, on top of
its own operators, and they ignore the value: an attribute tag applied without one still counts
as applied. `tag_name`, `tag_value`, `tag_type` and `metadata` do not take them.

A `metadata` filter looks at the song's Apple Music metadata rather than its tags, for example
`{"field": "metadata", "key": "artist", "op": "starts_with", "value": "p"}`. The text keys are
`title`, `artist`, `album`, and `genre`, where a genre filter matches if any one of the song's
genres does. `explicit` false covers clean and unrated songs. It only sees songs
whose metadata the backend has stored, which is any song a user has listed, opened, or has in their
library, plus the rest of an opened or library song's album once the crawl reaches it. A song
with none stored counts as having every field empty.

Semantics and limits are in [../db/README.md](../db/README.md). Anything malformed is a
`QueryFormatError` (422) with a message.

## How it works

Handlers take what they need out of `AppState` by `FromRef`, so most take
`State(db): State<DatabaseConnection>` and nothing else. Tag suggestion and default generation
take `State(tag_gen_service)`. Routes that operate only on shared defaults still require credentials
with a bare `_: Claims<SupabaseClaims>`.

`GET /tags/default-tags` searches the shared default tag pool by name and is not song scoped.
It is the odd one out next to `/songs/default-tags`, which reads the defaults applied to one song.
Its results are ordered by how many songs carry the tag, most first.

`GET /songs/default-tags` reads `default_tags_applied` and returns only tags whose `user_id` is
null, leaving out the ones the signed in user removed. `POST /songs/default-tags/batch` is the
same read for a list of songs, and fills in an empty list for the songs
`db::tags::get_default_tags_on_songs` leaves out.
`PATCH /songs` is the only writer of `user_songs`. It removes before it adds, so a song id sent
in both lists ends up in the library, and adding a song already there or removing one already
gone does nothing. It does not touch default tags, and a removal leaves the user's own tags on
the song alone.

Default tags are generated lazily, by the endpoints that read them. Both `GET /songs/default-tags`
and `POST /songs/default-tags/batch` call `services::default_tags::ensure_default_tags_generated`
before the read: it asks `db::tags::get_songs_without_generated_default_tags` which of the
requested songs have no row in `default_tags_generation`, reads their titles from Apple Music
through `SongMetadataService`, claims them with an `in_flight` row, generates with
`TagGenerationService`, stores through `db::tags::set_default_tags_on_songs`, and moves the rows
to `done`. A generator or write failure deletes the rows instead, so the next read tries again.

A song with a row already, `in_flight` or `done`, is skipped, so two readers of the same new song
do not both pay for generation.

Both reads then store the songs' Apple Music metadata for metadata queries, on a task of their
own, for any song without it (`services::metadata_tags::spawn_store_song_metadata`). Every song
list in the app reads default tags, which is what makes any song a user has seen queryable by
its metadata. The response does not wait for it.

The client never sends song descriptions. The backend resolves each id to a title itself, so a
song Apple Music has no catalog entry for is marked `done` with no tags rather than being
retried on every read. This replaced `POST /songs/no-default-tags` and `POST /songs/default-tags`,
which took `[{song_id, desc}]` and are both gone.

`DELETE /songs/default-tags` remembers in `default_tags_removed` that this user removed the song's
suggested tag and counts a remove against that tag name, which makes the name harder to promote
elsewhere. It does not take the default tag off the song: it stays there for everyone else, and
the generation path still treats the song as having defaults. The two reads above and a query run
with `consider_default_tags` all leave out this user's removals, so the tag stops coming back for
them.

Activity tags (My Plays, First Played, Last Played, In My Library, Favorited, Tagged) are shared
tag rows with `is_activity` set.
`GET /tags` leaves them out, since they belong to no user, and so do the default tag routes.
`GET /tags/activity` lists them for the query builders, and `GET /songs/activity-tags` and its
batch read their values per song. The writes are `POST /songs/plays`, which goes to
`db::activity_tags::record_play`, and `POST /events`, whose `play_counted` events move the play
tags and whose `song_favorited` / `song_unfavorited` events move Favorited. In My Library and Tagged
are computed on read from the user's library and own tags, so adding a song or applying a tag
changes them with no activity tag write. Writing one by hand through `/songs/local-tags` fails:
`POST` and `PATCH` are `NotFound` because the tag is not the user's, and `DELETE` is
`ActivityTagReadOnly` (403). The client decides what counts as a play; see
`client-app/src/lib/play-tracker.ts`.

`queries.rs` is one handler. The query arrives already typed, because serde parses the body
straight into `Query`, so a bad shape is a `QueryFormatError` carrying serde's message. The
handler hands it straight to `db::queries::run_query`, which does the compiling, running,
ranking, and sorting, and converts the result to `json::query::QueryResults`.

The query runs over every song Cadenza knows: the caller's `user_songs` rows, every song carrying
one of their tags, and every song stored in `metadata_song_tags_applied`. That is what lets
`is_not_applied` and other negative filters match songs with no Cadenza tag rows, including songs
the caller does not have. The caller's own songs come back `certain` and in full; the rest stop at
1000, with `capped` set when more matched. See the query compiler in `../db/README.md`. The client
used to send its Apple Music library as `song_ids`, capped at 50,000; that field is gone, and
`PATCH /songs` is now how the backend learns what is in the library.

`library_only` defaults to false. True limits the query to the caller's `user_songs` rows: every
match is `certain` and `capped` is false.

`sort` is optional. Without it songs come back most relevant first. With it they come back by the
stored title, artist or album, so a whole result sorts at once rather than one loaded page at a
time. It needs the `natural_sort` collation from `sql/query_sort.sql`.

`consider_default_tags` defaults to false. True widens what counts as a tag on a song to include
the shared default tags, for matching and for ranking, and lets the query name a default tag id.
Default tags the caller removed do not count, same as the reads. The client sets it from the
`Include suggested tags` toggle.

`json/` exists so the wire format is decoupled from the SeaORM models. Anything that leaves the
api as JSON should have a type here rather than serializing an entity model directly.

## Connects to

- `crate::db::tags`, `crate::db::activity_tags`, `crate::db::queries`, and
  `crate::db::user_songs` for all data access.
- `crate::services::tag_generation::TagGenerationService` for `/tags/suggest`, and through
  `crate::services::default_tags` for the default tag reads.
- `crate::services::song_metadata::SongMetadataService` for the titles those reads generate
  default tags from.
- `crate::db::social` and `crate::services::social_feed::SocialFeedService` for `/social`.
- `crate::err::CadenzaError` for every error path.
- Client side: `client-app/src/lib/routes/*.ts` wraps every one of these in an SWR hook.

## Gotchas

- Saved queries are gone from the route. It used to take a `query_id` param whose branch was a
  `todo!()` that panicked the handler.
- `POST /queries/results` ignores an unknown field, so a client still sending `song_ids` gets no
  error, just results over every song Cadenza knows. A user who has never synced their library
  has no songs of their own, only the rest.
- The response used to be a bare array of song ids. A client built before the `songs` / `capped`
  object reads it as no results.
- A like or unlike older than the last one this process accepted for that user and post is
  ignored. Comment likes use the same rule, with their own clock. Both clocks are in memory
  (the last 2000 pairs each), so a restart forgets them.
- The feed reuses a user's interest vector for 10 minutes. The cache holds the last 2000 users
  and lives in this process, so a restart forgets it. An interest update is not reflected in
  the feed until that user's entry is older than 10 minutes.
- `tags.rs::get_songs_with_user_tag_handler` exists but is not routed anywhere. Dead code. The
  same data comes back from `GET /tags?tag_id=N`.
- `GET /tags/suggest` uses `requested_tag_count` as a **required** query param, not optional, so
  a request without it is a 422. The service clamps it to at most 20.
- Anything that reaches the tag generator can come back 429 `TagGenerationRateLimited` when
  OpenAI turns the request away: `GET /tags/suggest`, and the two default tag reads that generate
  on a miss. Nothing retries for the caller, so the client has to.
- `GET /tags/default-tags` treats a missing `search` the same as a blank one, and a blank search
  returns 5 tags rather than none. The cap of 5 is `DEFAULT_TAG_SEARCH_LIMIT` and is not a
  client-settable param.
- `POST /tags` returns the id as a bare string body, not JSON.
- `DELETE /tags` and `DELETE /songs/local-tags` take a JSON body. Some HTTP
  clients will not send one on a DELETE.
- `GET /songs/local-tags` returns only the user's own tags. Default tags (`user_id IS NULL`) are
  available separately from `GET /songs/default-tags`.
- `POST /songs/local-tags/batch`, `POST /songs/default-tags/batch`, and
  `POST /songs/activity-tags/batch` are reads. They are POSTs because their id lists do not belong
  in a query string. All three cap out at 200 ids, as does `PATCH /songs` across its two lists.
  Songs with no tags come back as an empty list from the local and default batches, never
  missing, and every song gets all activity tags.
- `POST /songs/plays` trusts the client to call it once per play. Nothing stops a client from
  calling it in a loop.
- A user tag name becomes a default tag on a song once it has 10 counts in `default_tag_activity`,
  applies and removes together, with more than 1.5 times as many applies as removes. Applying a
  tag counts an apply, unapplying takes that apply back off, and `DELETE /songs/default-tags`
  counts a remove. This never copies the default into user tags, and nothing takes a default tag
  back off a song when the counts stop qualifying.
- `POST /songs/local-tags` inserts without checking first, so re-applying a tag relies on the unique
  violation mapping in `err.rs`. That mapping keys off the table name `applied_tags`, but the
  entity declares `user_tags_applied`, so it falls through to a generic `DatabaseError` instead
  of `TagAlreadyApplied`. See the table naming note in `../db/README.md`.
- `POST /events` validates the whole batch before storing any of it, so one bad event rejects the
  request rather than leaving half the batch in. The response is the ids the client may drop.
- A retried batch is free, but only the events actually inserted move the activity tags. That is
  why `db::events::insert_events` reports `inserted` and `accepted` separately: keying the play
  count off `accepted` would double count every retry.
- Event types are validated in Rust, not by the database. `event_type` is a plain text column, so
  adding a type is a variant in `services::analytics::EventType` and a deploy, never a migration.
- `/analytics/*` cuts day, week, month, and hour boundaries in the `tz` query param, defaulting to
  UTC. The client should always send the device zone; a UTC week is the wrong week for most users.
- Trend buckets use the request's `tz` for the whole series, not each event's stored `client_tz`,
  so the buckets stay contiguous for a user who travelled mid-window.
- `skip_rate` and the other rates are computed in the handler from the counts, not in SQL, because
  the average of per-bucket ratios is not the ratio over the window. A client wanting a skip rate
  trend asks for `skips` and `completions` and divides per bucket.
- `unique_songs` counts distinct per bucket, so its trend buckets do not sum to the summary figure.
- The window's upper bound is exclusive. When `until` is left out, `/analytics/trends` resolves it
  to one millisecond past the user's last event, so the newest event is in the series and a user
  with exactly one event does not read as a backwards window.
- Not every event type has a metric. `query_run`, `tag_applied` and `tag_removed` are accepted and
  stored, but nothing emits them yet, so they are deliberately left out of `Metric::ALL`: the
  client builds its chart picker off that list and an entry with no emitter is a chart that only
  ever shows zeros. `query_play` has an emitter, so it has a metric.
- `hour` is a real bucket, capped at about a month of hours, but `bucket=auto` never picks it. A
  trend is a calendar view; hours are asked for by name, for a heatmap or a single day.
- `bucket=auto` lets the server pick, which is the only way to bucket an all-time window without
  the client first asking how much history there is. The response always echoes a real bucket.
- `/analytics/top` groups artists and albums by the **lowercased name** out of the event payload,
  not by id. An id-first key splits one artist the moment the same artist is played once from the
  catalog, which carries an id, and once from a library copy, which does not. The cost is that two
  genuinely different artists sharing a name merge. The album key includes the artist, or every
  "Greatest Hits" collapses into one row.
- A play recorded before the client started writing `artist_name` into the payload is invisible to
  the artist and album rankings. There is no backfill: Apple Music owns the metadata.
- Playlist and query rankings read `source_kind`, `source_id` and `source_name` off `play_counted`.
  The client sets them when a queue starts from a playlist or a query. A query's `source_id` is the
  query itself, JSON encoded with its suggested flag, so the same query ranks as one row and the
  client can run it again. Plays logged before the client wrote a source rank under neither.
- Payload numbers must be whole and fit in an `i64`. The aggregates cast the stored text straight
  to `bigint` and the log is append only, so one row holding `1.5` would make the summary raise
  for that user with no way to delete it through the api.
- Signup also inserts a `profile` row from an `auth.users` trigger (username = email local part).
  The client still calls `POST /profile` after signup and ignores `ProfileAlreadyExists`.

---

Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).

### Listening calendar endpoints

- `GET /analytics/listening`: required `since`/`until`, optional `bucket`, `tz`, and one of `tag_id`
  or `untagged=true` (songs with none of the user's own tags; suggested tags do not count). Returns
  `total_ms` (unfiltered), `listening_ms`, `plays`, `session_count`, and sparse local-time `cells`
  with `start`, `listening_ms`, and `plays`. The optional filter applies to all fields except `total_ms`. `/analytics/sessions` and
  `/analytics/session-songs` take the same filter.
- `GET /analytics/sessions`: required window, optional `tag_id`, `offset` and `limit`. Returns
  `{entries, has_more}` with session `key`, recorded `start`/`end`, duration, and plays in that span.
- `GET /analytics/session-songs`: the same window/filter/page parameters plus optional
  `session_key`. Returns `{entries, has_more}` with song id, duration, plays and distinct tag names.
  Without a key it covers every listen in the window (the heatmap's hour sheet). `unassigned`
  addresses legacy events without a session id; other keys must be UUIDs.

All reads derive the user from the JWT. Limits default to 25 and cap at 100. Tag selection uses
only that user's non-activity tags. The original analytics endpoints are unchanged.
