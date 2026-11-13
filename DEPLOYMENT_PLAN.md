# Cadenza single-backend deployment plan

## Architecture

```text
Phone -> CloudFront HTTPS -> internal ALB -> one t4g.medium -> Axum + local Python
                                                       -> Supabase / Apple / OpenAI
```

Use Oregon (us-west-2), one On-Demand ARM64 t4g.medium (4 GiB), encrypted 16 GiB
gp3 and Standard CPU credits. Supabase holds data/auth. CloudFront retains its
provided HTTPS hostname and home-IP restriction. The internal ALB spans two
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

## Minimize replacement cold start

The first model-failure rehearsal took about nine minutes including verification.
A sanitized prewarmed ARM64 AMI now contains tested Docker/AWS tools, the pinned
application image, and the pinned model cache. Replacements fetch fresh secrets,
pass the exclusivity gate, and start the cached release instead of installing and
downloading it again.
Measure comparable failure-to-ready timing before and after. An AMI captures
disk contents, not the running model in RAM; EC2 boot, model loading and ALB
registration still take time. Snapshot-backed EBS blocks load lazily, so benchmark
first-read behavior rather than assume instant model loading. Paid Fast Snapshot
Restore is not assumed for this budget.

The initial warm-host attempt exposed a 60-second first-inference timeout while
snapshot blocks were still being read. The startup check now allows 300 seconds
before completing the launch hook. This does not extend normal API deadlines.
Read-only full-partition initialization was tested with four parallel readers.
The scan took 553.453 seconds and total recovery took 743.035 seconds. App startup
and verification after the scan took 38.848 seconds, but the scan cost more than
it saved. The unsuccessful full-scan helper and deployment option have been
removed; keep the measurement evidence. Preserve per-second probes and boot-stage timestamps for comparisons.
A control with 30-second draining and no scan took 611.411 seconds, including
323.567 seconds of application startup/verification. It did not demonstrate a
net improvement over the earlier 607.56-second baseline. Detection and boot
timing varied, so do not treat single-run differences as guarantees.
Targeted file prefetch was subsequently deployed and measured below. Paid initialization remains untested;
[AWS documents initialization options](https://docs.aws.amazon.com/ebs/latest/userguide/initalize-volume.html).


Do not image a live application host as-is. Remove all containers (their Docker
metadata contains environment secrets), secret files, logs, temporary registry
authentication, and machine-specific state before capture. Keep model-cache and
image layers only after checking that they contain no saved tokens. Ensure no
application container auto-starts before fresh-secret retrieval and the single-
backend gate. Use a clean non-serving builder that never handled application
secrets. Deleting secret files from a used server is not reliable sanitization of old disk blocks.
Do not launch a second serving backend just to build an image.

Pin the AMI ID alongside the backend digest, model revision and bootstrap version.
A release change must either publish a compatible warm AMI or use the slower
bootstrap fallback; do not silently use stale cached code. Keep one known-working
AMI for rollback and remove superseded AMIs/snapshots to control EBS storage cost.
Verify a fresh launch: SSM registration, fresh secrets, correct image/model,
startup exclusivity, real inference, ALB health and home-only HTTPS. The AMI is
an optimization, not a backup of Supabase data. The private validated AMI and its
evidence are recorded under deploy/ami/records/. Successful snapshots are retained
for operator-reviewed pruning; protect active/previous launch-template references.

## Recovery optimization results and options

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
   these are not predictions for total recovery. Verify Oregon per-GiB pricing
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
Docker ARM64 builder and AWS session; shows the release summary; builds/tests/publishes
an immutable backend image; prepares and validates a matching sanitized warm AMI;
then performs the existing stop-first activation and promotes the matching launch-
template version. Do not advance replacement config on failed validation. Keep
one matched previous release/AMI/template for rollback and clean up failed builder
hosts automatically. Write a small release manifest and print the stable API URL.

Bake from a clean non-serving builder that never starts Rust or accesses the app
DB. It may temporarily coexist with the serving host, but cannot serve app traffic
or reset DB claims. Use only build-scoped ECR/model access, avoid placing model
tokens in Docker container environment metadata, and sanitize machine-specific
state before snapshot. Cache tools/image/model on disk, not live processes or
secrets. Keep build-time machine costs and retained-snapshot costs visible.

Make bootstrap manifest-aware: when AMI, image digest and model revision match,
skip installation/download and fetch fresh secrets before the exclusivity gate
and start. If they do not match, fail clearly or use an explicit cold-bootstrap
fallback; never silently run a stale cached release. Publish a new AMI when its
baked inputs change, not merely because deployment was invoked again.

The developer release helper is implemented and has passed an actual build,
publication, stop-first activation, ALB health verification and template promotion.
The helper now includes AMI baking before activation. A clean builder never gets
app DB credentials; a separate fresh validator proves offline model inference.
Temporary machines and failed snapshots are cleaned up automatically. Warm-cache
validation and native replacement are exercised separately against the current
immutable application image.

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
   Sanitized warm-AMI baking is integrated into the developer release command.
   The unassisted warm-AMI run took 607.56 seconds from Python crash to HTTPS
   readiness and API responses. Precise timing is in verification.warm_timing.json,
   separate from post-recovery checks. This is not a demonstrated speedup: older
   rehearsal durations include verification and are not directly comparable.
   Targeted reads subsequently reduced measured recovery to 257.965 seconds;
   detailed cold-boot stages and limits are recorded above.
3. Finish public-access protections: bounded model queues/inputs, generic client
   errors, authenticated spend/request quotas, two-account authorization tests,
   and signup/JWT/DB privilege review. Preserve private ingress and the home
   restriction until explicitly opened. Focused development-DB tests are allowed
   with labeled records and cleanup; no separate DB is required.
4. Confirm Supabase backup coverage, credential rotation and basic cost/health
   visibility. ALB Oregon base cost is $0.0225/hour (about $16.43/730 hours) plus
   capacity usage, before credits/free allowances; EC2/IPv4/EBS/ECR remain separate.
5. Add private Prometheus operation histograms and a modest Grafana p50/p95/p99,
   traffic/error dashboard. Use bounded route labels and inexpensive retention;
   fleet discovery is unnecessary. Decide how much history must survive replacement.
6. Test realistic concurrent users on the one backend, prepare a standalone signed
   phone build when needed, then open access only on explicit instruction. OTel
   spans remain optional later work. Remove unused resources after the project.

The earlier deployment review is retained in Git history. Its multi-instance and
custom-controller designs are superseded. Current runbook/evidence take precedence
over the older tutorial/reference documents.

Sources: [ASG ELB health integration](https://docs.aws.amazon.com/autoscaling/ec2/userguide/health-checks-overview.html),
[ALB health settings and fail-open behavior](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html),
[ASG lifecycle hooks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/lifecycle-hooks.html),
[ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/).
