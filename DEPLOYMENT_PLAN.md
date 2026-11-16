# Cadenza single-backend deployment plan

## Architecture

```text
Phone -> CloudFront HTTPS -> internal ALB -> one t4g.medium -> Axum + local Python
                                                       -> Supabase / Apple / OpenAI
```

Use Northern California (us-west-1), one On-Demand ARM64 t4g.medium (4 GiB), encrypted 16 GiB
gp3 and Standard CPU credits. Supabase holds data/auth. CloudFront retains its
provided HTTPS hostname with public viewer access. The internal ALB spans two
subnets but has one application target. EC2 keeps a public IPv4 for outbound
access; there is no direct public API ingress or NAT gateway.

The team selected a single-target ALB plus an ASG fixed at minimum/desired/maximum
one. There is no load-based scaling or launch-before-terminate application rollout.
Failure recovery and stop-first updates can interrupt service. No Lambda recovery
controller is used: its unused prototype and AWS resources have been removed.

## Health and replacement

ALB checks `GET /health/ready` every 5 seconds, timeout 4 seconds, unhealthy after
three failures and healthy after two successes. Rust responds only when its local
Python process acknowledges the loaded model. External Supabase/OpenAI/Apple
availability is excluded from ongoing health. This detects a dead ML process but
is not proof that a busy/stuck inference worker is making progress; no inference
runs on every health probe. ALB can fail open to its last unhealthy target.

ASG uses ELB health checks, with a 120-second grace period after entering service.
ALB connection draining is 30 seconds. It registers replacement targets automatically. CloudFront points to the stable
ALB, so a new EC2 ID/private address does not require a routing controller.
Maintenance policy is minimum healthy 0%, maximum healthy 100%; AZ rebalancing is
suspended and no scale-out policy/warm pool is configured.

Fresh hosts use a versioned launch template and embedded nonsecret bootstrap:
install tested tool versions, retrieve the two SSM secrets via instance role,
pull the pinned image and cache the pinned model. Before starting Rust, bootstrap
waits for all other `CadenzaBackend=demo` hosts to terminate. ASG may briefly have
an old terminating host and a new booting host; only one backend may execute.
The launch hook completes only after readiness and real inference pass. The
startup-only inference probe allows 300 seconds for first snapshot disk reads;
normal application request/provider deadlines stay unchanged.

The launch-hook timeout is one hour. Native ASG retries and launch/termination
emails expose bootstrap failures; there is no custom automatic circuit breaker.
Repeated failure requires the operator to suspend Launch/ReplaceUnhealthy, fix the
launch template, and resume. Recovery takes additional time for download/model
loading. Record actual rehearsal timings rather than promise a fixed outage bound.

## Deployment speed and replacement startup

AMI baking was retired on 2026-11-15 to shorten developer deployments. The release
command builds and publishes an immutable image, updates the existing host with
rollback/readiness/inference checks, and promotes the verified settings into the
launch template. It does not create builder/validator machines or snapshots.
The serving host keeps its image/model caches between normal releases.

Fresh replacements use the pinned standard ARM64 Ubuntu AMI, install host tools,
fetch fresh secrets, and download the pinned image/model. Native ALB/ASG recovery,
startup exclusivity and real inference verification remain. The tradeoff is slower
replacement and reliance on package/image/model downloads. Historical recovery
measurements below used baked AMIs and are not current recovery promises. No new
failure rehearsal is required just to remove baking from ordinary deployment.
Historical AMIs/snapshots remain for reviewed rollback/pruning; do not delete
images still referenced by older launch templates without checking those uses.

## Historical baked-AMI recovery experiments

This section records retired experiments, not the current deployment procedure.
Baking and prefetch tooling have been removed; use the release command below.

Five-second ALB probes are live, with a four-second timeout and unchanged
three-failure/two-success thresholds. Three immediate failed responses should
usually take about 10-15 seconds to mark an ALB target unhealthy, not to finish
ASG replacement. Measure ALB and ASG transitions separately before attributing
the remaining delay. The ASG periodic-check cadence has no exposed interval
setting in the group configuration.

The completed disk-scan and control probe logs have maximum gaps of 1.182 and
1.453 seconds. The Mac slept later during the standalone watcher smoke test.
The EC2-side scan timestamps also independently show 553.453 seconds. Those
completed measurements remain usable, but a four-reader full-partition scan is
only one initialization method; do not generalize its result to all strategies.
The audit and existing CPU metrics are in
`deploy/recovery/verification.startup_resource_audit.json`.

1. Measurement helpers prevent idle sleep automatically on macOS. They retain
   every external HTTP probe, reject precise claims after gaps over three seconds,
   and record ALB/ASG transitions independently. Host logs separate Docker up,
   first Rust liveness, Python/model readiness, combined readiness, Docker health,
   inference check and direct HTTP verification. Offline model profiling further
   splits imports, construction and first/second encoding with CPU and I/O counters.
2. Completed two matched fresh-volume model-only comparisons on the same AMI.
   No Rust or database credentials were involved. Baselines took 156.616 and
   171.375 seconds; targeted prefetch plus model checks took 132.619 and 166.838.
   Prefetch took 93.981 and 129.986 seconds and first encoding after it took
   0.261 and 0.253 seconds. Baseline first encodes took 26.404 and 34.097 seconds.
   The complete-path gains were modest and varied; do not quote only post-prefetch
   time. Records are in deploy/ami/startup-comparison.json. The production reader
   also includes the small backend executable and Python interpreter/library files.
3. Targeted prefetch is integrated into the regular release path. Baking hashes
   its scripts, validates it before capture, and validates offline inference on a
   fresh boot. Matching warm replacements prefetch automatically while other safe
   preparation runs, then wait before starting Rust. The helper is offline,
   read-only, bounded to 16 readers and 240 seconds, and falls back on failure.
   Activation tools are refreshed from the release rather than kept from an old
   bootstrap. AMIs preserve disk files, not a live model in RAM. Do not enable
   a full-partition scan; its experimental helper was removed.
4. If targeted reads do not meet the recovery goal, test AWS provisioned EBS
   initialization as a separate cost/performance choice. The snapshot contains
   12,425,101,312 bytes (about 11.6 GiB), despite a 16 GiB volume. At 100 or 300
   MiB/s, initialization arithmetic is about 119 or 40 seconds respectively;
   these are not predictions for total recovery. Verify current-region per-GiB pricing
   before selecting a rate. Do not enable continuously billed Fast Snapshot Restore
   or change CPU-credit billing mode without an explicit design/cost decision.
5. Completed a cold replacement rehearsal for targeted reads, recording
   one-second external probes plus server-side stages. Preserve startup exclusivity,
   fresh secrets, real inference, zero OOM/restart checks, and home-only access.
   Rebuild/validate a sanitized AMI only when baked inputs change, then promote
   its matching image/model/bootstrap manifest through the developer release CLI.

The deployed optimized AMI is ami-0379feb57685778c1. Its fresh-boot validator
passed offline finite inference, and matching inputs reuse it without another
builder. The native Python-failure rehearsal recovered in 257.965 seconds
(4m 18s), compared with 611.411 seconds for the previous no-scan control.
Bootstrap-to-public-response fell from 372.941 to 131.440 seconds, including
prefetch. Application start through verification fell from 323.567 to 33.438
seconds; first measured inference fell from 78.147 to 0.317 seconds. AWS failure
detection also happened sooner in this run, so do not attribute the entire
recovery difference to prefetch or promise these times on every replacement.
The one-second public probes had a maximum gap of 1.284 seconds. No manual
recovery was needed. Final checks passed real inference, auth, home-only access,
old-host termination and zero container restarts/OOM. Temporary builders and
validators were terminated. Records: verification.targeted_timing.json,
verification.targeted_boot.json and verification.targeted_runtime.json under
deploy/recovery/. Continue with public-access protections; paid initialization
is optional future work, not part of the current release.

The five-second ALB configuration marked the target unhealthy after about 16
seconds in the optimized rehearsal; ASG showed unhealthy about 12 seconds later.
Optionally reduce failures from three to two (about 5-10 seconds for immediate
failures), accepting less tolerance for transient errors; not applied yet.
The 120-second ASG startup grace is not a delay after every runtime failure.
Our launch hook already verifies readiness, so reducing that grace can be tested
for failures just after launch, but it will not explain steady-state delays.
EC2 application status checks integrate natively but have a fixed 60-second
interval, so they are not the preferred fast detector here.

If periodic ASG handoff is still material, consider a small host-side systemd
watchdog that checks local readiness and calls SetInstanceHealth(Unhealthy) after
sustained failure. Scope its IAM access to this ASG, activate only after successful
bootstrap, suppress it during planned maintenance, and retain ALB/EC2 checks for
host failure. This avoids Lambda but adds custom recovery logic; benchmark and
review that tradeoff before implementing it. Do not let the watchdog contact
external providers or bypass the single-backend gate. Stopped/hibernated warm
pools are a later option only if simpler startup work is insufficient: they add
spare storage, lifecycle and secret-handling complexity even with one serving host.

Sources: [ALB settings](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html),
[ASG health handoff](https://docs.aws.amazon.com/autoscaling/ec2/userguide/health-checks-overview.html),
[application status checks](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/application-status-checks.html),
[custom health status](https://docs.aws.amazon.com/autoscaling/ec2/APIReference/API_SetInstanceHealth.html),
[EBS initialization](https://docs.aws.amazon.com/ebs/latest/userguide/initalize-volume.html).

## Developer-invoked release command

There are no GitLab runners or formal CD jobs. Use one developer entry point,
`./scripts/deploy-backend.sh`, backed by the existing AWS CLI/Docker/Python tools.
No runner, CI service, long-lived access key, or release service is required.

The command checks the workload account/region, clean committed source,
Docker ARM64 builder and AWS session. It builds/tests/publishes an immutable
backend image, performs stop-first activation with rollback, and promotes the
same image/model/bootstrap settings into the launch template. Failed activation
must not advance replacement settings. Failed promotion or public readiness
restores the prior template and release. Readiness and real inference stay
mandatory; monitoring has its own verification result. A release manifest records
the digest, model, base AMI and launch-template version. No custom AMI is created.

## Keep the application small

Keep health checks, 120-second active-request/work draining, bounded child/DB
cleanup, Docker's 150-second stop allowance, 50-second handler responses,
40-second tag-generation budget, and restart-baseline startup validation.
Keep non-root execution, encrypted disks, IMDSv2, private secrets, and immutable
image/model references with a known-working rollback.

No claim-token/lease schema, renewal heartbeats, distributed cache/write ordering,
replica pool budgeting, surge rollout, or separate model/queue service is planned.
Those proposals were not implemented; no ownership schema needs undoing. Existing
single-process caches and claim startup recovery are retained. Queued enrichment
may be discarded. Do not run a developer backend against the same DB concurrently.
A concurrent-request duplicate-generation race remains a separate cost/correctness
issue to address narrowly before broader access, without a replica framework.

## Releases, maintenance and notifications

Updates stop the old backend before starting a new one on the same host. Pull and
validate first; failed startup restores the previous image/env. The operator-side
update helper temporarily keeps EC2 host checks but suppresses ELB app checks,
restoring ELB health in `finally`. If the operator process is killed, restore ELB
health explicitly. Update the pinned launch-template release after success so
replacement runs the intended version. Image rollback does not undo database writes.

SNS email notifications report native ASG launches, terminations and errors,
including planned replacements. The operator confirmed the email subscription.
No notification Lambda is needed. Resource identifiers and evidence live under
[deploy/recovery/](deploy/recovery/README.md); operating instructions are in
[deploy/README.md](deploy/README.md).

## Implementation and remaining work

1. Completed: repeatable bootstrap, stop-first activation/rollback, and the
   one-instance ALB/ASG have been provisioned and verified on fresh hosts.
2. Completed: model-failure and host-loss rehearsals verified native replacement,
   prior-host termination, real inference, home-only HTTPS, automatic target
   registration and email delivery. Evidence is under deploy/recovery/.
   The former warm-AMI baking path was retired on 2026-11-15.
   The unassisted warm-AMI run took 607.56 seconds from Python crash to HTTPS
   readiness and API responses. Precise timing is in verification.warm_timing.json,
   separate from post-recovery checks. This is not a demonstrated speedup: older
   rehearsal durations include verification and are not directly comparable.
   Targeted reads subsequently reduced measured recovery to 257.965 seconds;
   detailed cold-boot stages and limits are recorded above.
3. Public-access protections (hardening deployed; broader review remains):
   Urgent live finding: 34 of 36 public tables lack RLS and both client roles
   have CRUD grants. Anonymous zero-row REST reads succeed. Close the direct
   Supabase path first, preferably by disabling the unused Data API in project
   settings. The user disabled it; REST/GraphQL probes now fail closed while
   Auth endpoints, direct PostgreSQL and ALB health pass. The user confirmed
   mobile flows. The two-account tags/saved-query check passed all 38 assertions
   with fixture cleanup and both local session logouts successful. Evidence is under
   deploy/recovery/verification.supabase{_access,_data_api_disabled}.json. bounded model queues/inputs, generic client
   errors, authenticated in-memory request/paid-operation quotas, two-account
   authorization tests, and signup/JWT/DB privilege review. No database schema
   changes for this work. Deployed limits include 7000 actual provider calls per
   24-hour window and environment-configurable thresholds. Direct Supabase
   exposure has been investigated and Data API disabled. Selected ownership
   paths passed; social mutations/privacy and library/settings writes remain
   untested at runtime. Source e55a356 is deployed in us-west-1 with validated AMI
   ami-04040be0fc1e6cf6d and launch-template version 2. A real inference burst
   admitted nine jobs and rejected nine with 503; readiness stayed 200 for all
   71 samples. Automated checks passed and the user confirmed the post-release
   phone smoke flows. Public CloudFront viewers were explicitly approved and opened.
   Quotas reset on process restart or instance replacement;
   that tradeoff is accepted. Bound limiter memory and expire inactive entries.
   Preserve private ALB/EC2 ingress. Focused development-DB tests are allowed
   with labeled records and cleanup; no separate DB is required.
4. Backups are deferred at user request. Credential review and verified database TLS are complete.
   The live app requires verify-full with the public Supabase CA and hostname
   validation; negative certificate/hostname checks passed. Rotation procedure is documented in deploy/README.md.
   Review provider key scopes/spending controls and basic cost/health visibility.
   ALB hourly and capacity charges apply before credits/free allowances;
   EC2/IPv4/EBS/ECR remain separate.
5. Completed: private Prometheus/Grafana deployed and verified. Operation
   histograms, p50/p95/p99, traffic/statuses, provider calls/window usage,
   refusals and configured limits.
   Run on the existing host with read-only access through an AWS tunnel. Retain
   up to 14 days with a 2 GB block cap; history is intentionally lost on host
   replacement. Pull pinned monitoring images and ship dashboard config with releases.
   No additional EC2 instance, public listener or schema change. Verify deployed
   metrics separately from API readiness. Python queue depth and OTel spans are
   later work; avoid per-user metric labels.
6. Public CloudFront access opened at the user's explicit request before Grafana
   work. The concurrent-user test is skipped by user choice. Prepare a standalone
   signed phone build when needed. OTel spans remain optional later work. Remove
   unused resources after the project.

The earlier deployment review is retained in Git history. Its multi-instance and
custom-controller designs are superseded. Current runbook/evidence take precedence
over the older tutorial/reference documents.

Sources: [ASG ELB health integration](https://docs.aws.amazon.com/autoscaling/ec2/userguide/health-checks-overview.html),
[ALB health settings and fail-open behavior](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html),
[ASG lifecycle hooks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/lifecycle-hooks.html),
[ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/).

## Regional migration completed (2026-11-13)

The AWS backend moved from us-west-2 to us-west-1. Supabase and the CloudFront
hostname did not change. The new region has fresh Standard SecureString
parameters, regional runtime/builder roles, a validated warm AMI, ALB/ASG and
confirmed SNS subscription. Home-only viewers and private origin rules remain.
The old serving instance was terminated before the new application started.
Migration evidence: deploy/recovery/verification.region_migration.json. Earlier
recovery measurements above were taken in Oregon, not a new-region benchmark.

## Public access enabled (2026-11-13)

The home-IP viewer function is detached from CloudFront. HTTPS, disabled caching,
Authorization forwarding, private ALB/EC2 ingress, app authentication/quotas and
verified database TLS remain. The previous function/config is retained for
rollback. Evidence: deploy/recovery/verification.public_access.json and
verification.public_runtime.json. No new application build or DB schema change
was needed. Provider scope/spending review and private Prometheus/Grafana remain
follow-ups, rather than prerequisites imposed on this public opening.

## Metrics deployed (2026-11-14 local date)

Source cd254744d6e6 is live in us-west-1 with warm AMI ami-0f0e8cff161d36cd0
and launch-template version 3. The 17-panel private dashboard is reachable via
`./scripts/open-metrics.py`; no additional Grafana login is needed inside the
AWS-authenticated tunnel. Live application histograms and p95 queries passed.
Prometheus and Grafana are non-root with read-only root filesystems, memory/CPU
limits and private ports. Public `/metrics` returns 404. The existing 16 GiB disk
was retained. Local history lasts up to 14 days or the 2 GB block cap, and is lost
on host replacement. Both temporary AMI machines were terminated. Evidence:
deploy/recovery/verification.metrics.json.

Grafana's initial 384 MiB limit caused OOM restarts under dashboard use. Its
limit is now 768 MiB with a 512 MiB Go memory target, persisted in template
version 4. Backend image/AMI and Prometheus are unchanged. The full 17-panel
query workload completed in 0.327 seconds through the private tunnel after
the fix; see deploy/recovery/verification.metrics_performance.json.

Dashboard layout now includes invocation counts next to percentile summaries.
The route dropdown and the three operation tables sort by call volume over
the selected dashboard range. Counts are Prometheus counter-increase estimates,
not an exact request audit log. Dashboard provisioning polls for file updates;
release labels refresh monitoring container mounts on later app deployments.

Feature dashboards separate Social, Analytics, Tagging, Library & Queries and
Account from the overview. Each feature has p50/p95/p99, call-volume bars,
failed responses and operation tables. Provider budget/limit details live under
Tagging. These views use existing low-cardinality HTTP metrics; span-level
breakdowns will be added with tracing, rather than inferred from HTTP totals.

Feature runtime histograms repeat per observed method/route over the selected
range. An operation selector narrows the charts; disjoint bucket counts include
a 10+ second overflow. Duration buckets with moderate extra detail in the fast and 250-1000 ms ranges use the constant
`histogram_schema="2"` label to avoid mixing incompatible historical schemas.
Duration history starts at this rollout; call-count history is retained.

The feature dashboard release is live from source `004031c09a56`, using warm AMI
`ami-0e69ae1ddde8d6cda` and launch-template version 5. All six provisioned
views and their live queries passed verification. The refined runtime schema
has 17 visible distribution buckets, ending in 10+ seconds, while internal
slow-tail buckets retain percentile precision. API/auth/metrics-isolation checks
passed; temporary builder and validation hosts were terminated. Evidence:
`deploy/recovery/verification.metrics_features.json` and the release manifest
`deploy/releases/git-004031c09a56-20261115042148.json`.
