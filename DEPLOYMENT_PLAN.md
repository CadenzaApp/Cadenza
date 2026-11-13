# Cadenza capstone deployment plan

Run the demo on one EC2 instance in Oregon (us-west-2), using Free Tier and credits
where possible. The operator authorized the existing resources; no paid monthly
cap has been agreed. Keep Supabase for data and login. Keep Rust and Python
together, just as they run locally. CloudFront handles public HTTPS and reaches
Axum directly through a private VPC origin and the Docker port mapping.

Follow [the operator tutorial](DEPLOYMENT_TUTORIAL.md) to deploy. The example
build files and scripts are in [the technical reference](DEPLOYMENT_REFERENCE.md).
The current deployed configuration and verification record are in
[deploy/README.md](deploy/README.md). The runtime uses only the combined backend
container. The reliability/scaling design below is planned only: no load balancer,
Auto Scaling group, launch template, rollout automation, or new instance was
created for this planning update.

## What runs where

```text
Phone -> HTTPS -> CloudFront -> private VPC HTTP -> host 80 -> Axum container port 3000
                                                          Rust -> Python model on local port 3001
                                                          Rust -> Supabase, Apple Music, OpenAI
```

The backend is one image containing Rust, Python, and their dependencies. Rust
starts Python as its child. Restarting or upgrading the backend restarts both.
Docker publishes the Axum listener on host port 80. EC2 allows that port only from CloudFront's
service-managed security group. No public EC2 web ingress is allowed. A CloudFront
viewer-request function restricts the public HTTPS endpoint to the home IPv4.
Python remains private. The instance retains a public IPv4 for outbound access.

There is currently no ALB or Auto Scaling group. CloudFront targets the fixed EC2
instance directly and does not replace it. If Python fails while Rust stays up,
Docker reports unhealthy but does not restart the running container automatically.
The current recovery procedure is a manual backend restart.

## Initial choices

| Choice | Reason and acceptance check |
| --- | --- |
| ARM64 t4g.small, 2 GiB RAM | Lowest-cost candidate; measure startup and realistic inference |
| t4g.medium, 4 GiB fallback | Use if the smaller instance lacks memory or fails the demo flow |
| Encrypted 16 GiB gp3 disk | Stores OS, images, model cache, and logs; keep 25% free |
| CloudFront-provided hostname | Stable HTTPS address without buying a domain or allocating an Elastic IP |
| Standard CPU credits | Avoids surplus-credit charges; test speed when credits are low |
| One pinned model revision | Keeps the vectors and deployment consistent |
| Persistent model cache | Avoids downloading the model during the event |

Earlier single-host estimates do not include the planned load balancer or rollout
surge. Re-estimate Oregon costs before implementation: ALB hours/capacity, one or
two steady instances, temporary rollout capacity, per-host EBS/model cache and
public IPv4, registry/storage, monitoring, and any changed outbound networking.
Supabase and OpenAI costs remain separate. Budget alerts notify; they do not stop
charges. Continue to maximize Free Tier/credits; no new resources are authorized
by this planning update.

The model determines much of the memory requirement even with very few users.
Select the final instance only after a rehearsal with about 20% memory headroom,
no OOM kills or sustained swap, and acceptable response times. Increase disk size
if current and rollback images do not fit comfortably.

The agreed starting instance is t4g.small. Follow the measurable
[2 GiB acceptance rehearsal](deploy/README.md#accept-or-reject-the-2-gib-instance)
before accepting it. Account: 175220118767. Public API:
https://d1wj9jjqzhjpqq.cloudfront.net. Phone flows, real inference, normal TLS
verification, private origin routing, and model-child recovery have passed.
Multi-device testing remains outstanding; the resource record tracks the longer
rehearsal separately.

## Planned reliability and scaling architecture

```text
Phone -> CloudFront HTTPS -> private VPC origin -> internal ALB
                                                    |
                                            ALB target group
                                                    |
                                      EC2 Auto Scaling group
                                      1 normally, up to 2 by load
                                      each: Axum -> local Python
```

- Keep the CloudFront hostname, API forwarding settings, disabled caching, and
  current viewer allowlist. Change its VPC origin from a fixed EC2 instance to
  an internal Application Load Balancer when the prerequisites below are met.
- ALB routes only to ready backend targets. Allow ALB ingress only from the
  CloudFront managed security group; allow backend ingress only from the ALB
  security group. Neither ALB nor EC2 needs direct public API ingress.
- Span at least two suitable Availability Zones/subnets. Keep Rust/Python together
  with one model per replica; do not introduce a separate model service yet.
- An EC2 Auto Scaling group owns replacement and target registration. Initially
  desired/minimum capacity is one; plan for two as the normal load-scaling ceiling.
  ALB alone routes traffic; the ASG is what launches/replaces instances.
- Use EC2 and application-aware ELB health signals, startup grace, and model warmup
  settings. A dead or persistently unhealthy backend/model must trigger replacement.
  Define health so a shared Supabase/OpenAI/Apple outage does not cause a fleet
  replacement loop. `/test` alone is insufficient: it only proves Rust responds.
- One steady instance saves cost but an unexpected failure still causes downtime
  while the replacement boots and loads its model. Continuous service through a
  host failure requires two healthy instances already running.
- Add load-driven scaling from one to two only after concurrent-instance tests.
  Choose thresholds from request volume, latency, queue pressure, and CPU/credit
  observations, not an arbitrary CPU target alone. Use warmup/cooldowns and safe
  scale-in draining; instances still share the same DB and provider quotas.
- Decide replacement-instance egress explicitly. The present public IPv4 supports
  outbound services; an internal ALB does not replace that function. Do not assume
  a new private-only instance can reach ECR, SSM, Supabase, or OpenAI without a
  working outbound design. Avoid adding a NAT gateway by default for this budget.

## Prerequisites before any instance overlap

These apply even to a temporary second instance during an update.

1. Replace global claim resets with ownership/leases and expired-claim recovery.
   `main.rs` clears shared tag-generation claims at startup; metadata workers also
   reset shared in-flight work. A new replica must not clear a live worker's claim.
   Coordinate background jobs with safe claims, a leader, or a dedicated worker;
   idempotent cleanup must also remain safe across replicas.
2. Review process-local state in `SocialFeedService`. Like/comment-like timestamp
   ordering is held in memory, and feed vectors are cached per process. Make
   correctness durable/shared where needed and define cross-replica invalidation.
   Sticky sessions are not a substitute for correct data ownership or write order.
   Define fleet-wide user/provider quotas too; independent per-process counters
   must not accidentally multiply the allowed spend or expensive work on scale-out.
3. Budget DB connections for peak overlap, not just normal capacity. Each backend
   currently allows 10 connections, while code documents a 15-connection session
   pooler budget. Verify the actual limit, reserve maintenance/migration capacity,
   and adjust per-replica pools or DB capacity before running two or more backends.
4. Local readiness and bounded shutdown are implemented in the application:
   `/health/ready` checks Rust and the local loaded model; ongoing Supabase, OpenAI,
   and Apple outages do not drive replacement. SIGTERM stops new periodic passes
   and drains accepted HTTP plus tracked work for 120 seconds, then cancels
   unfinished work. Child/pool cleanup is bounded by another 15 seconds; Docker
   allows 150 seconds. Before fleet rollout, align ALB drain delay and termination
   lifecycle hooks with these deadlines and verify the whole termination path.
5. Make a fresh host self-provisioning. The current launch user data only enables
   SSM; later Docker/tool installation, release files, secrets, and model cache were
   prepared separately. A versioned launch template/AMI and idempotent bootstrap
   must perform the whole process without laptop state or secret-bearing user data.
   Fetch secrets via the instance role, pull a pinned digest, prepare the pinned
   model/cache, start the backend, and withhold traffic until readiness passes.
6. Keep durable state in Supabase and other durable storage, not a replacement
   host's root volume. Each instance gets its own reproducible model cache. Choose
   prewarmed AMI/cache versus bootstrap download based on measured startup time.

## Planned update rollout and rollback

Use versioned launch templates and immutable image/model references. Prefer ASG
instance refresh with explicit launch-before-terminate capacity, health/warmup
checks, checkpoints, and rollback conditions. Do not use the current stop-first
single-host procedure for a future availability-preserving rollout.

1. Build/check/publish the new ARM64 image and record its source commit, image
   digest, model revision, config version, and backward-compatible schema changes.
2. Create a launch-template version for that release and launch a replacement
   while the existing healthy instance continues serving.
3. Complete host bootstrap/model loading, validate candidate readiness and an
   authenticated smoke flow, then require ALB target health and a warmup/bake
   interval before removing old capacity. Failed bootstrap must leave the old
   healthy release serving instead of advancing the rollout.
4. Deregister/drain the old target, stop new background work there, complete graceful
   shutdown, and terminate it only after replacement capacity is ready. Keep the
   public hostname and client configuration unchanged.
5. Watch errors, latency, and readiness. Abort/roll back to the previous launch
   template and known-working image on failed checks. Exercise rollback, including
   loss of a candidate, rather than assuming the automation handles every failure.

For desired capacity one, plan at least 100% minimum healthy capacity and allow
one surge instance (for example 200% maximum healthy capacity): one old plus one
new. Confirm exact settings and quotas during implementation. When normal desired
capacity is two, preserving both while rolling needs an agreed third-instance
surge budget or another explicitly tested strategy. Do not silently permit four
instances through an unreviewed 200% setting, or remove a required healthy target.

Database migrations must work with both old and new app versions during overlap.
Use expand/contract changes and a controlled migration step, not competing startup
migrations. Changing embedding models/revisions needs a separate vector/backfill
compatibility plan; equal vector dimensions do not make models interchangeable.
A bad release rollback does not undo DB writes or schema changes.

## Planned metrics and tracing

This is planned work only. No `/metrics` endpoint, collector, dashboard, tracing
instrumentation, or telemetry service is deployed by this planning change.

### Phase 1: Prometheus operation latency and Grafana

- Instrument the Axum request lifecycle and expose a Prometheus-compatible
  `/metrics` endpoint. Record an operation-duration histogram in seconds, with
  bounded labels for matched route/operation, HTTP method, and status class.
  Derive request rates, error rates, and mean latency from histogram counts/sums
  where possible. This phase is response-time reporting, not detailed span tracing.
- Use stable operation names or matched route templates, never raw paths with IDs.
  Do not label metrics with user IDs, song/post IDs, query strings, request bodies,
  tokens, arbitrary error strings, or trace IDs. Use target/resource metadata for
  environment, service, instance, and release, with a controlled series budget.
- Define the timing boundary. Initially measure application handling from Axum
  middleware entry through response headers being ready, including authentication,
  handler work, and awaited DB/model/provider calls. This is backend operation
  latency, not phone-to-CloudFront network latency. Explicitly instrument body
  completion later if streaming responses require it. Include errors/timeouts and
  document how cancellations are counted. Separate metrics/health probes from
  business operations and use a bounded label for unmatched routes.
- Collect aggregatable histograms, not precomputed per-instance quantile summaries.
  Start with compatible classic histograms unless native-histogram support is
  selected across the whole stack. Choose bucket boundaries covering fast routes
  and longer model/OpenAI operations, with precision near useful latency targets.
  Keep metric names, labels, and bucket boundaries compatible across rollouts.
- Scrape every backend instance over a private path, preferably a separate private
  metrics listener/port. Discover targets from EC2/ASG metadata so replacements
  appear automatically. Do not scrape through the ALB or CloudFront: requests could
  land on different replicas and mix independent counters. Restrict metrics access
  to the collector and exclude it from public CloudFront/ALB API routing.
- Keep Prometheus storage/querying and Grafana independent of replaceable backend
  instances so dashboards/history survive rollouts. Do not assume a full Prometheus
  and Grafana stack will fit on the 2 GiB model hosts. Select self-hosted or managed
  placement after comparing ingestion, retention, storage, scrape frequency,
  cardinality, availability, and cost. No monitoring purchase is approved yet.
- Make the Grafana dashboard and data-source provisioning versioned artifacts.
  Default to all instances, with environment, operation, method, instance, release,
  and time-window filters. Provide an overview of traffic, errors, and p50/p95/p99;
  an operation table of counts and latencies; latency heatmaps/distributions; and
  per-instance/release comparisons for rollouts. Show scrape health and sample
  counts so missing/low traffic is not mistaken for good tail latency.

Fleet percentiles must be computed after summing bucket rates across instances.
Do not average replica p95/p99 values. For a classic histogram, a representative
per-operation p99 query is:

```promql
histogram_quantile(
  0.99,
  sum by (le, operation, method) (
    rate(cadenza_http_request_duration_seconds_bucket{environment="demo"}[5m])
  )
)
```

The metric name and environment above are proposed, not currently exported.
Grafana should use its configured rate interval and selectors. Percentiles are
histogram estimates; bucket resolution and low sample counts limit precision.

Acceptance for phase 1: verify operation/status labels and timing with controlled
requests; check percentile aggregation against known multi-instance distributions;
confirm new/retired targets and counter resets behave correctly; ensure `/metrics`
is unreachable through the public API; and verify dashboard filters, units, and
persistence during replacement. Keep telemetry overhead bounded and measure it
when implementing, rather than starting another RAM rehearsal now.

### Phase 2: OpenTelemetry operation spans

- Add a request root span and meaningful child spans for backend compute stages,
  DB pool wait/query work, local Python/model calls, and outbound OpenAI/Apple
  requests. Expose timeouts/retries and errors without assuming the external
  provider exposes its internal spans. Span elapsed time is not a CPU profile.
- Propagate trace context through Rust async work, HTTP clients, and the Python
  FastAPI service so one operation's work is correlated end to end. Use consistent
  operation/resource naming across metrics and traces, including instance/release.
  Start with useful boundaries rather than a span around every function.
- Export OTLP through an OpenTelemetry Collector to a selected trace backend, such
  as Grafana Tempo or an AWS-compatible option, and inspect traces from Grafana.
  Choose collector placement, sampling, retention, and ingestion budgets before
  provisioning. Trace sampling must not silently sample away the request metrics.
- Do not capture credentials, prompts, user post text, SQL bind values, or sensitive
  payloads by default. Normalize DB operations and redact attributes/error details.
  Add trace correlation to private logs and, where supported, histogram exemplars
  so a latency spike can lead to a representative sampled slow/error trace. Trace
  IDs belong in trace context/exemplars, not high-cardinality Prometheus labels.

References: [Prometheus histograms](https://prometheus.io/docs/practices/histograms/),
[PromQL histogram quantiles](https://prometheus.io/docs/prometheus/latest/querying/functions/#histogram_quantile),
[Grafana Prometheus data source](https://grafana.com/docs/grafana/latest/datasources/prometheus/),
and [OpenTelemetry traces and spans](https://opentelemetry.io/docs/concepts/signals/traces/).

## Remaining deployment work, in order

| Work | Completion evidence |
| --- | --- |
| Release reproducibility | Record committed source and configuration for the next image; build/source/config identities agree; retain a known-working rollback release. demo-001 is broken and cannot serve as that rollback. |
| Data protection | Confirm backup coverage, demo data/schema prerequisites, and rehearse restore without risking the live demo data. |
| Public-access review | Resolve priorities in [PUBLIC_ACCESS_REVIEW.md](deploy/PUBLIC_ACCESS_REVIEW.md): request/cost quotas, bounded inputs and expensive work, sanitized errors, signup/JWT policy, DB role/RLS review, and two-account authorization tests. WAF and user-ID allowlisting remain options to evaluate, not assumed purchases. |
| Multi-instance application work | Local readiness and bounded shutdown are deployed and tested in demo-003. Complete claim ownership, shared-state/caches, peak DB connection budgeting, and ALB/ASG draining integration before any overlapping rollout. |
| Reproducible infrastructure | Codify the launch template/bootstrap, ALB/target group, ASG, health/lifecycle settings, IAM/security groups, CloudFront origin migration, and release versioning. Validate with a fresh host; do not rely on this manually prepared instance. |
| Automatic replacement | Simulate host loss and model/app failure; verify replacement, warmup, target registration, and recovery timing without a replacement storm. A lone instance still has a failure recovery gap. |
| Availability-preserving updates | Rehearse successful and failed candidate rollouts, continuous traffic, draining, schema compatibility, and rollback while an old instance remains healthy. |
| Load scaling and capacity | Test simultaneous authenticated users and account isolation across replicas; measure realistic traffic, queues, latencies, and depleted Standard credits. Set one-to-two scaling/scale-in rules and DB/provider budgets from that evidence. |
| Prometheus metrics and Grafana | Implement private per-instance `/metrics`, aggregatable operation-duration histograms, ASG target discovery, and a versioned fleet/operation latency dashboard. Validate p50/p95/p99, label cardinality, persistence, and private access. |
| Monitoring and operations | Add health/credit/cost visibility, actionable alerts, retained private diagnostics, credential-rotation procedures, and recovery/rollback runbooks. Estimate ALB, surge, and telemetry hosting/retention costs before provisioning. |
| Later OpenTelemetry tracing | Add correlated request/compute/DB/model/OpenAI spans, context propagation into Python, OTLP collection, a trace backend, sampling/redaction policies, and Grafana trace/exemplar navigation. |
| Phone/demo release | Keep using Metro for current iteration. Before a laptop-independent demo, prepare a signed standalone build with the HTTPS URL and test launch, auth, persistence, Apple Music, and venue connectivity. |
| Broaden viewer access | Only after the relevant security checks and an explicit operator instruction; preserve private origin restrictions. Test cellular/off-home access at that point. |
| Final handoff and cleanup | Freeze the chosen release, record tested limitations and operating procedures, retain grading artifacts, and later remove unused billable resources. |

The earlier single-device phone tests, real inference, TLS/home-allowlist checks,
and manual model-child recovery passed. No new RAM comparison was run after proxy
removal; it remains deferred by the operator. A fixed 30-minute test is not a gate
for current development. Additional performance testing should answer the actual
multi-user/scaling questions above, not repeat an arbitrary duration.

## Current operating boundary

Until the multi-instance prerequisites pass, run only one backend against the demo
DB, including local developer instances. Continue the documented single-host
stop/start update procedure and accept its brief interruption. The ALB/ASG and
launch-before-terminate procedures above are a future design, not active safeguards.
No load balancer, ASG, extra instance, scaling policy, or rollout was provisioned
for this planning request.

Implementation references:
[CloudFront VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html),
[ASG health checks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/health-checks-overview.html),
[instance refresh](https://docs.aws.amazon.com/autoscaling/ec2/userguide/instance-refresh-overview.html),
and [maintenance policy and warmup](https://docs.aws.amazon.com/autoscaling/ec2/userguide/instance-maintenance-policy-overview-and-considerations.html).
