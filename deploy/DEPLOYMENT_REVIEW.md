# Deployment review and improvement plan

Reviewed 2026-11-13. Source: deployment branch through 901e070 and current planning
changes. Independent sub-agent review of the 72-file deployment diff from ae49612 through
901e070, including initial deployment commit 9f25043, plus primary-agent inspection. This is a
static code/configuration review of repository files and recorded deployment
results, not a fresh AWS audit, penetration test, or rerun of recorded tests.

## Assessment

The single-instance, home-restricted deployment is suitable for continued
controlled development. Keep the home restriction and one backend while resolving
multi-instance correctness. The existing health and shutdown work is useful and
does not need a rewrite. Current source hashes match the runtime build record.

Sound choices include CloudFront viewer-IP filtering, private origin ingress,
non-root application execution, pinned model/image references, bounded Docker
logs, host-only secret retrieval, and local health checks that exclude provider
outages. Actual network/IAM state still needs drift verification before rollout.

## Findings and gates

| Priority / gate | Finding and action | Evidence |
| --- | --- | --- |
| High, concurrent claims / overlap | Default-tag insertion ignores conflicts but does not return acquired IDs. Generate only for acquired work; fence result writes and settlement by attempt ownership. Remove global startup resets. | `backend-api/src/db/tags.rs:247`, `backend-api/src/services/default_tags.rs:123`, `backend-api/src/main.rs:99` |
| High, overlap | Album acquisition uses row locks, but global resets and ID-only settlement can invalidate another worker. Protect result storage and settlement together. | `backend-api/src/db/metadata_tags.rs:433`, `:465`, `:495`, `:540`; `backend-api/src/services/metadata_tags.rs:438` |
| High, overlap | Ten DB connections per replica exceed the documented 15-connection pooler capacity with two replicas. Verify the real limit and budget peak rollout capacity plus maintenance headroom. | `backend-api/src/main.rs:48` |
| High, overlap | Like ordering and vector caches are process-local. Put correctness-sensitive ordering in DB writes; evaluate removing the cache before introducing distributed caching. | `backend-api/src/services/social_feed.rs:135` |
| Medium, concurrent/public use | A single inference worker still accepts an unbounded queue. Bound admission and interest/list/text sizes; return deliberate overload responses. | `backend-api/ml-service/main.py:23`, `:31`, `:78` |
| Medium, automatic replacement | Loaded-model readiness can remain healthy while inference is stuck. Document this limitation; test worker-stall handling before claiming automatic recovery covers it. Do not run inference on every health probe. | `backend-api/ml-service/main.py:71` |
| High, public access | Internal error text, paid-request quotas, signup policy, two-account isolation, DB privileges/RLS, and JWT issuer validation need review/hardening. No auth bypass was established by this review. | `backend-api/src/err.rs:112`, `backend-api/src/auth.rs:27`, `PUBLIC_ACCESS_REVIEW.md` |
| Medium, unattended releases | Build from committed source and version the small release/rollback script. Current rollback automation exists in the deployment session rather than the checked-in startup script. Retain matching image/config rollback pairs. | `build-record.json`, `start-release.sh`, `history/build-record.demo-002.json` |
| Low, local defaults | The bind-address comment and README claim loopback while code defaults to all interfaces. Align behavior and documentation; no standalone deployment rebuild is needed for this cleanup. | `backend-api/src/main.rs:185` |

The default-tag race can occur with concurrent requests on one instance; it is
not exclusively a future scaling issue. Public-only gates do not imply the home
restriction substitutes for authentication or correctness.

## Additional whole-branch findings

- `start-release.sh:21` rejects any lifetime container restart count above zero.
  A normal resume can therefore stop a healthy container that recovered earlier.
  Compare against this activation's baseline or deliberately recreate during
  release activation. Keep the existing health and inference verification.
- CloudFront origin timeout is 60 seconds, while individual provider/model calls
  can also take 60 seconds and generation can make sequential calls. Bound total
  operation time below the edge budget with margin, or split requests. Test using
  slow local stubs. The 120-second shutdown allowance is a separate concern.
- `install-host-tools.sh:25` uses current packages and an unversioned root-run AWS
  installer. Before unattended replacement, pin/verify artifacts or use a tested
  versioned AMI. Full apt snapshot reproducibility is unnecessary for this demo.
- Current launch user data only enables SSM. An ASG using it alone would launch
  non-serving replacements. A fresh-host proof is mandatory before automation.
- Consolidate operational instructions in `deploy/README.md` and retain one
  architecture/roadmap source. Mark historical human-only tutorial restrictions
  as historical; later explicit operator authorization governs agent actions.
- No restore rehearsal is established by the current evidence. Supabase data
  needs backup coverage independently of the disposable EC2 model cache.

The recorded SCP exception is workload-account-wide, not ECR-only, and does not
itself grant IAM permissions. Its live attachment was not inspected. Retain both
policy records. Keep the public IPv4 until egress has a replacement; an internal
ALB does not provide outbound internet. Private-origin HTTP is an acceptable
current tradeoff. Steady ASG capacity one will still have an outage after sudden
host loss; launch-before-terminate helps planned updates, not every failure.

## Smallest useful next implementation

Queued default-tag and album enrichment may be discarded on shutdown. There is
no requirement for durable delivery or guaranteed replay. Retain the current
bounded drain for accepted requests and active work.

Evaluate fixed-duration attempts before renewable leases: atomic acquired IDs,
a fresh attempt token, a bounded whole-attempt lifetime, conservative expiry,
owner-scoped cleanup, and transactional ownership checks around result writes.
Use the database clock. A later request can make abandoned work eligible again;
no replay worker is required. A stale attempt must not publish results or clear
a newer claim. External requests already sent cannot be made exactly once.

The whole-attempt bound is essential: tag generation performs sequential chunks,
so a 60-second per-call timeout does not bound an entire job. Bound or split the
attempt before choosing expiry. Add renewal only if legitimate work cannot fit
the chosen bound. Holding advisory locks/connections across provider requests
would consume the scarce DB pool and is not automatically simpler.

This is a proposed implementation direction, not implemented or deployed code.
See `CLAIM_OWNERSHIP_PLAN.md` for the detailed scope and cutover requirements.

## Revised implementation order

1. Fix startup restart-count handling and align total operation/edge timeout
   budgets with focused tests. Confirm backup/restore coverage before schema changes; use focused tests with labeled synthetic records in the existing development
   database, as subsequently authorized by the operator. Clean up test records.
2. Implement bounded claim ownership for default tags and albums. Test concurrent
   acquisition, stale writes, abandoned work, expiry, cleanup, and later demand.
3. Fix social ordering/cache consistency and budget peak DB connections.
4. Bound model admission and sanitize client errors. Complete quotas, signup/auth,
   and two-account tests before removing the home restriction.
5. Make full host bootstrap and a narrow release/rollback procedure reproducible.
   Build from committed source; validate a fresh host and rollback to a retained
   working release. Do not rely on the existing instance's manually installed state.
6. Estimate ALB, replacement/surge capacity, egress, storage, and telemetry costs.
   Provision ALB/ASG only after application prerequisites. Keep steady capacity one
   and rehearse replacement, warmup, graceful termination, updates, and rollback.
7. Add private per-instance operation histograms and a modest Grafana dashboard.
   Choose hosting/retention explicitly; use measurements to decide scaling to two.
8. Complete operational alerts, rotation and recovery procedures, multi-user and
   depleted-credit capacity tests, and a signed standalone phone build.
9. Broaden viewer access only on operator instruction after its gates pass. Freeze
   the demo release and clean up unused billable resources when no longer needed.

Defer OTel spans, Redis/distributed caches, heartbeat renewal, separate worker or
model services, and elaborate telemetry infrastructure until a concrete need
justifies them. Caddy and Kubernetes are unnecessary for this architecture.
Do not repeat a fixed-duration RAM rehearsal without a new question to answer.

## Follow-up implementation status

Startup restart-baseline handling and HTTP/tag-generation budgets are implemented
in source with isolated tests; deployment remains demo-003. HTTP handler timeout
is 50 seconds, and generation across chunks is 40 seconds. These response/provider
budgets do not finish the whole-attempt ownership requirement: detached tasks and
database phases still need explicit lifetime/ownership handling in the next step.
