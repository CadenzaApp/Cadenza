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

ALB checks `GET /health/ready` every 10 seconds, timeout 5 seconds, unhealthy after
three failures and healthy after two successes. Rust responds only when its local
Python process acknowledges the loaded model. External Supabase/OpenAI/Apple
availability is excluded from ongoing health. This detects a dead ML process but
is not proof that a busy/stuck inference worker is making progress; no inference
runs on every health probe. ALB can fail open to its last unhealthy target.

ASG uses ELB health checks, with a 120-second grace period after entering service.
It registers replacement targets automatically. CloudFront points to the stable
ALB, so a new EC2 ID/private address does not require a routing controller.
Maintenance policy is minimum healthy 0%, maximum healthy 100%; AZ rebalancing is
suspended and no scale-out policy/warm pool is configured.

Fresh hosts use a versioned launch template and embedded nonsecret bootstrap:
install tested tool versions, retrieve the two SSM secrets via instance role,
pull the pinned image and cache the pinned model. Before starting Rust, bootstrap
waits for all other `CadenzaBackend=demo` hosts to terminate. ASG may briefly have
an old terminating host and a new booting host; only one backend may execute.
The launch hook completes only after readiness and real inference pass.

The launch-hook timeout is one hour. Native ASG retries and launch/termination
emails expose bootstrap failures; there is no custom automatic circuit breaker.
Repeated failure requires the operator to suspend Launch/ReplaceUnhealthy, fix the
launch template, and resume. Recovery takes additional time for download/model
loading. Record actual rehearsal timings rather than promise a fixed outage bound.

## Minimize replacement cold start

The first model-failure rehearsal took about nine minutes including verification.
After validating the base recovery path, prepare a sanitized prewarmed ARM64 AMI
with tested Docker/AWS tools, the pinned application image, and the pinned model
cache. Replacements should fetch fresh secrets, pass the exclusivity gate, and
start the already-cached release instead of installing/downloading it again.
Measure comparable failure-to-ready timing before and after. An AMI captures
disk contents, not the running model in RAM; EC2 boot, model loading and ALB
registration still take time. Snapshot-backed EBS blocks load lazily, so benchmark
first-read behavior rather than assume instant model loading. Paid Fast Snapshot
Restore is not assumed for this budget.

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
an optimization, not a backup of Supabase data. No prewarmed AMI is created yet.

## Developer-invoked release command

There are no GitLab runners or formal CD jobs. Provide one developer entry point,
`./scripts/deploy-backend.sh`, backed by the existing AWS CLI/Docker/Python tools.
No runner, CI service, long-lived access key, or release service is required.

The command should check the workload account/region, clean committed source,
Docker ARM64 builder and AWS session; show the release summary; build/test/publish
an immutable backend image; prepare and validate a matching sanitized warm AMI;
then perform the existing stop-first activation and promote the matching launch-
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
It currently reports cold bootstrap. AMI baking is the next implementation within
the same entry point; no prewarmed AMI has been created.

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
   Next optimization: integrate sanitized warm-AMI baking into the developer
   release command as described above.
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
