# Candidates before unrestricted public access

These are planned protections, not implemented controls. The user selected no
database schema changes and accepted in-memory quotas resetting on restart or
replacement. Specific quota thresholds and signup admission policy remain to be
chosen. The CloudFront home-IP restriction stays enabled.

## Priorities

- Add per-user limits and quotas for paid tag-generation requests. Existing tag
  count and description caps do not limit request frequency or total spend.
  Provider 429 handling is not an incoming application rate limit.
  Keep counters in this single backend process, with bounded storage and expiry.
  These are request/operation limits, not a durable dollar-spending guarantee.
- Bound expensive work across the server: model concurrency, queued requests,
  database work, and timeouts. Reject overload deliberately instead of allowing
  queues or memory use to grow without a bound. Keep the existing DB pool cap.
- Add explicit semantic limits for interest batches and names, and review other
  list/query inputs. The interest-update route currently validates the interest
  type but has no explicit item-count or name-length limit; missing interest
  embeddings are submitted together. General HTTP body limits are not enough.
- Return generic database/upstream failure messages to clients. Keep diagnostic
  details in private server logs, with credentials and sensitive data redacted.
- Test two authenticated accounts against private reads and writes, including
  guessed resource IDs and account switching. Multi-device use and simultaneous
  user isolation remain unverified. Review Supabase RLS and DB role privileges.
- Review Supabase signup settings and JWT validation. Login is not an invitation
  policy if anyone can create an account. For testing from arbitrary networks,
  app distribution alone does not establish signup eligibility. Manual
  per-user approval and administrator-created accounts were rejected.

## Additional options

- Consider edge request-rate limits, such as AWS WAF, alongside application
  limits. Evaluate cost and legitimate library-sync traffic before enabling.
  Keep the EC2 origin restricted to CloudFront even after broadening viewers.
- Review monitoring, alerts, restore/rollback procedures, dependency updates,
  and service spending controls before a wider release. Budget alerts notify;
  they do not enforce an application spending cap.
- Test realistic concurrent users and performance with depleted Standard CPU
  credits. The current single-user checks do not establish public-load capacity.

## Evidence and current scope

The API verifies Supabase JWTs and the reviewed handlers derive the user ID from
claims. HTTPS, private-origin routing, uncached API forwarding, model inference,
and single-user phone flows have passed. This is not a complete security audit.

Relevant code: `backend-api/src/main.rs`, `backend-api/src/auth.rs`,
`backend-api/src/routes/tags.rs`, `backend-api/src/routes/social.rs`,
`backend-api/src/services/social_feed.rs`, and `backend-api/src/err.rs`.

## Signup investigation (2026-11-13)

A read-only GET to the project's public `/auth/v1/settings` endpoint, using only
its shipped publishable key, reported `disable_signup=false`,
`mailer_autoconfirm=true` and email authentication enabled. No test account was
created and no authentication settings were changed. The client calls
`supabase.auth.signUp` directly from `client-app/src/lib/account.tsx`; its project
URL and publishable key are in `client-app/src/lib/supabase.ts`. Backend JWT
validation does not establish that the request originated in the distributed app.

Consequently, a caller who knows the public project URL/key can attempt signup
outside the app without env-file secrets. Private app distribution and a shared
secret embedded in the app are not enforceable signup restrictions. The user wants recipients of the distributed client to self-register without
manual approval. Do not implement a user-ID allowlist or administrator-created
account flow. Database privileges/RLS still need review. Do not change signup
policy without selecting the intended flow.

References: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).

## Alternatives to manual admission

App attestation is a viable stronger option for the intended experience. Apple
App Attest can verify legitimate signed iOS app instances, including TestFlight
builds. Firebase App Check can wrap platform attestation and issue tokens for
custom backends without replacing Supabase Auth. This requires native client
integration, server-side verification and a rebuilt client. Debug credentials
must not become a public production bypass. Attestation reduces automated abuse;
it does not prevent a recipient from abusing the genuine app.

Supabase does not automatically enforce our custom API's App Check verification.
To protect account creation itself, a Before User Created HTTP hook must enforce
attestation or a short-lived signup authorization bound to the signup data, with
replay handling. Alternatively, an attested signup gateway can create accounts
while direct public signup is disabled. Hook/gateway access and failure behavior
need design because the backend currently has private origin and home-only viewer
access. Direct App Attest also needs key/counter state; do not assume the full
solution can be stateless. A managed verifier can avoid an application schema
change but introduces another service. No attestation design has been selected.

A manually entered cohort code checked by a server-side Auth hook is simpler and
can be configured without schema changes. It is a transferable bearer credential,
not proof of an authentic app; embedding it in the client does not provide strong
protection. Email verification/CAPTCHA can reduce signup abuse but do not restrict
signup to app recipients.

If attestation is deferred, keep self-signup and implement the existing hardening
list. Include global paid-operation and model-capacity limits as well as per-user
quotas: public signup lets an attacker obtain multiple user IDs. Global counters
also remain in memory and reset on restart. Use bounded counter storage/expiry,
exempt health probes from overload admission, and ensure background provider calls
share the same paid-work limits. Complete account-isolation and direct Supabase
permission checks before intentionally opening access. Report any policy/schema
issue for a separate decision under the no-database-change constraint.

Sources: [Apple App Attest](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server),
[Firebase custom backend verification](https://firebase.google.com/docs/app-check/custom-resource-backend),
[Supabase Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).

## Implemented locally, awaiting release and public-access review

- JWT issuer validation; generic database/upstream client errors and request logs.
- 64 active API requests, excluding health; 600 requests per user per minute.
- Tag/default-tag requests: 30 per user per minute and 1000 per 24-hour window.
- Actual OpenAI calls: 7000 per 24-hour window, two concurrent local calls,
  4096 maximum output tokens. Background generation shares the global cap.
- Thresholds are environment settings in deploy/release.env.example and Compose.
  All quotas remain in memory; reset on restart is accepted. Counter storage is
  bounded; provider attempts and endpoint attempts have separate semantics.
- Bounded serial inference: one active plus eight waiting; 40-second caller
  timeout, and running work retains admission after cancellation.
- Interest batch/name/finite-number validation and query-tree complexity bounds.

Focused local tests cover quotas/windows, error non-disclosure, query bounds,
ML input rejection, overload response, and model queue cancellation/liveness.
No account or signup settings, database schema, RLS or AWS resources changed.
Two-account isolation and direct Supabase privilege review remain outstanding.
Do not remove home-only access based only on these unit tests.

For the Prometheus/Grafana step, count incoming requests by bounded route/status,
paid endpoint admissions/rejections, actual provider attempts, and provider
refusals separately. Include active model work and queue occupancy, effective
configured limits and process uptime/reset visibility. Use monotonic metrics
independent of resetting quota windows. Do not label metrics by user IDs, emails,
raw paths or request content. This reporting is planned, not implemented here.

## Live Supabase access audit (2026-11-13)

Critical finding: 36 public tables grant SELECT/INSERT/UPDATE/DELETE to both
anon and authenticated; 34 have RLS disabled. Only user_settings and
live_session_join_requests have RLS enabled. Anonymous REST GET requests with
`limit=0` succeeded for user_songs, tags, saved_queries, listening_events,
notifications, profile, user_settings and posts. Limit zero retrieves no row
contents and does not establish any RLS policy's filtering behavior. Combining
successful REST access, effective grants and disabled RLS establishes the direct
access gap on the unprotected tables. Write exposure is inferred from grants;
no mutation was attempted. No application records were retrieved.

Catalog inspection was SELECT-only and the recorded audit used an explicitly
read-only transaction. Evidence: recovery/verification.supabase_access.json.
The configured database connection uses postgres with BYPASSRLS. Default grants
also expose future public tables to both client roles. The three custom public
functions return trigger/event_trigger, not ordinary user-callable RPC results.
No tables are currently listed in logical replication publications; this audit
does not establish security of every Realtime or Storage configuration.

The current client source uses Supabase Auth only, not direct table/RPC/Realtime
or Storage calls. Rust uses a direct PostgreSQL/pooler connection. Recommend
turning off Enable Data API in the Supabase Data API integration overview, then
checking direct REST denial, Auth endpoints, and normal backend phone flows.
This is a project configuration change, with no table/column/policy migration.
Supabase Auth and direct PostgreSQL are separate access paths and should remain
available; verify after changing the setting. No project setting was changed.

The home-only CloudFront restriction does not protect direct Supabase APIs.
Treat closing this path as urgent even while the backend remains home-only.
Disabling Data API does not repair excessive SQL grants; consider revoking
unneeded current/default client-role privileges as a separately reviewed defense,
especially before any future Data API or Realtime use. Backend ownership checks
still need the two-account review because the backend database role bypasses RLS.

## After Data API was disabled (2026-11-13)

The user saved the disabled setting. Rechecks of user_songs, saved_queries,
listening_events and notifications returned 503/PGRST002 rather than the previous
200. A schema-only GraphQL request also returned 503/PGRST002. Supabase documents
that disabling Data API leaves PostgREST running against a no-exposed-schema
marker, which can generate schema-cache errors. Do not re-enable it to clear
these errors. Auth settings and JWKS still returned 200; signup remains enabled.
Direct Postgres connected and completed a read-only, zero-row table query.
The ALB reported the deployed instance healthy. Workstation CloudFront requests
returned 403, so no authenticated backend business flow was claimed as tested.
The home restriction was not changed. Phone sign-in/data-loading confirmation
and the two-account isolation checks remain outstanding.

Evidence: recovery/verification.supabase_data_api_disabled.json.
Reference: https://supabase.com/kb/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist
Existing grants/RLS were not changed; turning Data API on again would restore
this exposure unless permissions are fixed first.

## Two-account check preparation

Run `python3 scripts/check-account-isolation.py` from an interactive terminal on
an allowed network. It signs in to two existing test accounts with local hidden
password prompts. Tokens stay in memory; test sessions are signed out locally
at the end. It does not register accounts or change existing user content.
It creates a temporary tag and saved query per account, tries cross-account
reads/renames/deletes/reruns, verifies owner state, and cleans up its fixtures.
The report contains check names/statuses and cleanup IDs, not credentials or
response bodies. Expected unowned tag deletion is a successful no-op, so the
owner's unchanged record is checked rather than treating HTTP 200 as a breach.

Initial source review: tag reads/writes and saved-query lookup/update/delete
filter by the caller UUID. Saved-query song reads and reruns check ownership
before accessing stored songs. Library modifications scope deletes/inserts to
the caller; settings/profile handlers derive the user from JWT claims. Social
posts are intentionally readable across accounts, while edit/delete filter by
author. This is selected-path code review, not proof of every authorization path.

The helper's runtime coverage excludes social mutations, library/settings
writes and the full endpoint set. These remain separate checks; do not label
its report a complete account-isolation audit. Deployed tests also do not prove
that the locally pending hardening changes have been released.

## Two-account runtime result (2026-11-13)

The user ran the helper against deployed CloudFront from an allowed network.
The local report matches the supplied result: 38 checks passed, zero failed,
all four fixture cleanup requests succeeded, and both test-session local
logouts returned 204. Anonymous requests were rejected, both profiles matched
their JWT subjects, and tags/saved queries remained isolated in both directions.
Cross-account tag deletion returned its intended no-op 200, with the owner's
unchanged tag independently verified. Saved-query cross-account song reads,
renames, reruns and deletions returned 404; list isolation also passed.

Evidence: recovery/verification.account_isolation.json, completed at
2026-11-13T23:12:31.412175+00:00. The user also confirmed mobile client operation
after disabling the Data API. These supersede the pending status recorded above.

Runtime coverage still excludes social mutations/privacy, library/settings
writes and the complete endpoint set. The hardening changes are still local;
this run does not establish that the new quotas/queue limits are deployed.
Next release step: commit/deploy the hardening, then verify normal mobile flows
and bounded overload behavior while preserving the home restriction.

## Hardening deployed (2026-11-13)

Backend source e55a35654e243f816f1d29fa08a27787d74786a4 is deployed as image
sha256:8c114c88f756a462d0efc6aabcf9ddc3d5f833847803fd0a98ef9378ca832b61.
ASG replacement uses validated AMI ami-0eb1717b4664bc627, template version 12.
Live checks: anonymous/invalid JWT requests 401, oversized model input 422,
valid topic-context inference 200, and all five effective quota settings correct.
An 18-request model burst admitted nine and returned nine busy 503 responses;
all 71 concurrent readiness samples returned 200. No paid provider calls were
used for these automated checks. Container healthy, zero restarts/OOM; off-home
CloudFront request 403; all temporary image builders/validators terminated.
Evidence: recovery/verification.hardening_release.json.

The first image was stopped before activation to allow the topic prefix in model
input (1024 characters internally; public posts remain capped at 500). The
corrected AMI passed fresh offline inference. Activation then safely rejected
new quota configuration keys; the candidate validator now explicitly permits
those five bounded settings. The validated image was resumed through normal
activation/provisioning commands without rebuilding unchanged app code.
Release CLI now prevalidates candidate settings before image building/baking.

Phone smoke confirmation after this release is pending. Previous two-account
results apply to the earlier deployment; they are not a full endpoint audit.
Home-only access and disabled Supabase Data API are preserved. Earlier pending
implementation notes above are historical and superseded by this deployment.
