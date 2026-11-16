# Deployment status and remaining work

## Current design

The public backend runs in AWS us-west-1 under Cadenza Backend, account
175220118767. CloudFront supplies HTTPS at
https://d1wj9jjqzhjpqq.cloudfront.net, forwarding to a private ALB and one
4 GiB ARM64 EC2 instance. Supabase supplies authentication and Postgres.

The single-instance ASG automatically replaces unhealthy hosts. Five-second
ALB readiness probes cover both Rust and the loaded Python model. Replacement
and deployment can cause downtime; there is no load-based scale-out or rolling
multi-instance rollout. No custom Lambda recovery controller is used.

Developers deploy from macOS or Windows with one command. Releases build/push
an immutable container, update the serving host with rollback and real inference
checks, then update replacement settings. AMI baking was retired to shorten
normal releases. Fresh hosts install/download at boot, so recovery is slower
and depends on download services. Only one backend may use the shared database.
A startup gate waits for other backend hosts to terminate.

## Completed

- Public HTTPS with private ALB/EC2 ingress; no domain purchase or Caddy needed.
- Native ASG recovery and confirmed email notifications.
- Local Rust/model readiness, graceful shutdown and bounded background work.
- Request, provider and model admission limits; bounded inputs and deadlines.
- Sanitized upstream errors and selected two-account ownership checks.
- Disabled unused Supabase Data API and verified database TLS.
- Private Prometheus/Grafana, latency percentiles/distributions, call volume,
  errors and provider budget visibility. Up to 14 days of local history is lost
  on host replacement.
- Developer release command, rollback and replacement configuration, without
  baking AMIs or running CI workers.

## Remaining work

1. Rehearse a fresh cold-bootstrap replacement when a staffed outage is acceptable.
   Current launch settings are verified, but old baked-AMI recovery measurements
   do not establish the new recovery duration.
2. Expand authorization coverage for social privacy/mutations, library writes
   and settings. Existing tag/saved-query ownership checks do not cover every API.
3. Review provider-key scopes and cost alerts. Memory quotas reset on restart
   and are operation limits, not a durable dollar cap. Restrict the DB role and
   the Python child's inherited credentials if stronger isolation is needed.
4. Add Python queue-depth metrics and OpenTelemetry spans for database, model
   and provider work when end-to-end HTTP timings are insufficient.
5. Prepare signed client builds when needed. Backups and concurrent-user load
   testing remain deferred by the team.
6. Prune obsolete AWS AMIs/snapshots after reviewing launch-template references.
   Repository cleanup does not delete AWS storage. Tear down paid resources when
   the project is finished.

See [developer setup](deploy/GETTING_STARTED.md), the [runbook](deploy/README.md),
and [security notes](deploy/PUBLIC_ACCESS_REVIEW.md). Current AWS IDs and the latest
verification report are under `deploy/recovery/`. Retired experiments and old
walkthroughs remain in Git history.
