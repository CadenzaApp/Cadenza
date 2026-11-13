# Background claim ownership: initial audit

Status: design review only. No schema or running-service change has been made.
Ownership implementation is not selected yet. Guaranteed job replay is not required.

## Scope

Two existing workflows already record progress in Postgres:

- Shared default tags: `default_tags_generation`, keyed by song ID. Reading a
  song's default tags can generate them through OpenAI if they have never been
  generated. The optional periodic default-tag backfill uses the same path;
  that periodic backfill is disabled in the current deployment.
- Album metadata crawl: `metadata_albums`, keyed by album ID. Opening a song can
  queue its album. The worker fetches the album's tracks from Apple Music and
  stores their metadata in `metadata_song_tags_applied` for queries, sorting,
  and metadata display. It downloads no audio and does not crawl artist
  discographies. Current deployment batches two albums, wakes when queued, and
  polls every 60 seconds. Successful batches continue after a one-second pause.
  The separate library-walk portion is disabled in the current deployment.

Explicit `GET /tags/suggest` calls are direct request/response operations and are
outside this claim change. Regular CRUD, listening events, model inference, and
feed requests would not become queued jobs. Notification expiry is an idempotent
cleanup; it does not need per-notification claims. Saved-query follow-up updates
remain a separate durability/correctness review.

## Confirmed problems

1. `main.rs` deletes all in-flight default-tag claims at startup. Starting a
   replacement alongside a healthy instance can erase that instance's claim.
2. `start_default_tag_generation` inserts with conflict-ignore but returns no
   ownership result. Two callers that already passed the preliminary read can
   both continue to OpenAI even when only one inserted the claim.
3. Default-tag finish/delete operations filter by song ID alone. A stale attempt
   can settle or remove a newer attempt's claim. Tag replacement itself also
   needs ownership validation, not just a guarded final status update.
4. Album claiming uses `FOR UPDATE SKIP LOCKED`, but global in-flight resets at
   startup and after failures can return another worker's live albums to pending.
   Album finish/release also lacks an attempt token. Metadata writes happen
   before finish, so guarding only the final status would be insufficient.

## Agreed shutdown policy

The operator permits discarding queued default-tag generation and album-crawl
work when an instance shuts down. These are best-effort enrichment tasks. Do not
add durable delivery, a separate queue service, or guaranteed replay just to
preserve this work across replacement or rollout.

Interpret queued work as work that has not started. Accepted HTTP requests and
active work retain the existing bounded drain behavior. Stop taking new work;
unstarted local work may be dropped. This does not authorize dropping user
writes, listening events, or saved-query updates under the same policy.

Abandonment must not mark incomplete work done or leave a claim that permanently
suppresses later legitimate requests. Cleanup must affect only the abandoning
attempt's claims, never another worker's active claim. Future user access may
request the enrichment again; completion after shutdown is not promised.

Existing shared pending rows need not be purged merely because one instance
stops. Discard permission is not a requirement to clear the shared queue.

## Ownership direction, pending discussion

The deployment-wide review recommends evaluating bounded whole attempts with
fixed expiry before adding renewal. Give each attempt a fresh token; claim
atomically and return only acquired items. Bound the entire attempt, including
sequential provider calls, and use database-clock expiry. A worker that loses
ownership must stop and discard its result. Add renewal only if measured work
cannot fit the chosen bound. See DEPLOYMENT_REVIEW.md.

Validate the token and unexpired ownership under a row lock in the same short
transaction that stores results and settles the claim. Keep provider calls
outside transactions; do not hold a DB connection throughout an OpenAI/Apple
request. Recovery can acquire only expired work, never reset all in-flight rows.
A token cannot prevent an external API request already sent by a crashed or
partitioned worker from completing, so this is not exactly-once provider billing.

The earlier two/five-minute recovery and 30-second renewal proposal is not an
agreed requirement. Reassess its complexity under the best-effort policy. Any
expiry retained for claim hygiene prevents permanent suppression after a crash;
it need not imply automatic replay or a recovery-time guarantee. Ownership and
stale-write protection remain necessary even when discarded work is acceptable.

## Implementation and acceptance checklist

- Keep enrichment best effort; choose the smallest ownership mechanism that
  prevents duplicate live claims and stale writes without requiring durable replay.
- Check backup/restore coverage before any live schema change.
- Prepare additive SQL and regenerate affected entities from the changed schema;
  do not hand edit generated entities.
- The operator authorizes focused tests against the existing development
  Supabase database. Use clearly labeled synthetic records, scope every change
  to those records, and clean them up. A separate local database is not required.
- Test two concurrent claimants, returning only claimed IDs, expiry/takeover,
  renewal, stale completion/release, and atomic result writes versus takeover.
- Test worker death, dropping unstarted work, cancellation during draining,
  owner-scoped cleanup, later on-demand eligibility, and repeated migrations.
- Remove global resets only when both default-tag and album paths use ownership.
- Plan one controlled cutover: stop the old binary before enabling the new
  claim protocol. Old versions have unconditional resets and cannot overlap with
  the new version. Recover legacy tokenless claims only after old workers stop.
- Keep the current one-instance deployment until shared-state ordering/caches
  and peak DB connection budgeting are also addressed.

Postgres references:
[INSERT RETURNING and conflicts](https://www.postgresql.org/docs/current/sql-insert.html),
[row locks](https://www.postgresql.org/docs/current/explicit-locking.html).
