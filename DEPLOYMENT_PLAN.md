# Cadenza single-instance deployment plan

## Agreed architecture

Run exactly one application instance in Oregon (us-west-2): ARM64 t4g.medium,
4 GiB RAM, encrypted 16 GiB gp3, Standard CPU credits. Keep Supabase for data/auth,
Rust and its local Python model in one container, and CloudFront's existing HTTPS
hostname and private VPC origin. Retain the home-IP restriction until explicitly
opened. Retain the public IPv4 for outbound access; no NAT gateway is needed.

```text
Phone -> CloudFront HTTPS -> private EC2 origin -> Axum -> local Python
                                                    -> Supabase / Apple / OpenAI
```

No load balancer, load-based scaling, second serving backend, or overlapping
rollout. Updates and failure recovery may interrupt service. The active runbook
and release records are in [deploy/README.md](deploy/README.md). Historical launch
and resource measurements describe the old 2 GiB configuration, not this target.

## Keep and remove

Keep deployed health checks, 120-second request/work draining, bounded child/DB
cleanup, Docker's 150-second stop allowance, 50-second handler responses,
40-second tag-generation budget, and restart-baseline startup checks. These
protect ordinary single-instance operation. Keep non-root execution, secret
retrieval through SSM, pinned image/model versions, and known-working rollback.

Remove the planned claim-token/lease schema, renewable heartbeats, distributed
cache/write-ordering work, replica DB budgets, ALB/target groups, surge capacity,
and launch-before-terminate updates. None was implemented or provisioned; there
is no ownership schema to roll back. Keep current single-process caches and claim
startup recovery. Queued enrichment may be discarded. Never run a local backend
against the same DB while the deployed backend is active: current global resets
still assume one process. Concurrent-request duplicate generation remains a
separate small correctness/cost issue, not a prerequisite for replica support.

## Automatic recovery without a load balancer

Use one EC2 Auto Scaling group solely as a replacement manager, with minimum,
desired, and maximum capacity one, a versioned launch template, and no scaling
policies. Use On-Demand instances in the current AZ, no warm pool, no capacity
rebalancing, and explicit terminate-and-launch maintenance settings (minimum
healthy 0%, maximum healthy 100%). ASG capacity settings alone are not proof of
exclusive application execution: replacement bootstrap must confirm the previous
backend host is stopped/terminated before starting Rust. Fail closed if that
cannot be established. Do not introduce a database lease to solve this.

EC2 health checks cover host failures. Add a small application-health check for
persistent local Rust/model failure, with startup grace and several consecutive
failures before action. First try a bounded container restart; if failure persists,
report the instance unhealthy to the replacement manager. An external missing-
heartbeat check must also cover a dead health checker. Exclude provider outages
from replacement decisions. A loaded-model probe does not detect every inference
stall; add worker-stall detection only if needed, without inference on every probe.

A replacement gets a new instance ID and private address. CloudFront currently
references a specific EC2 ARN; an ASG alone will not restore traffic. Implement a
small, serialized recovery handler that identifies the current replacement,
waits for host/bootstrap/readiness, creates its EC2 VPC origin, updates the existing
CloudFront distribution's origin binding/private DNS, and waits for deployment.
Retire the old VPC origin after detachment. Treat events as repeatable/stale:
re-check the current instance before each routing change. Do not assume an in-use
VPC origin can be edited in place. Keep viewer access, caching, and Authorization
forwarding unchanged. Failed bootstrap must never be published as ready.

The minimal recovery implementation must therefore cover host replacement,
application health, and CloudFront reconnection. Keep it narrow; choose the fewest
AWS automation components after proving the CloudFront switch. Bound retries and
alert on repeated failures instead of endlessly replacing instances. Recovery
includes model loading and CloudFront propagation; measure the actual outage.

## Bootstrap, updates, and rollback

Current user data only enables SSM. Before enabling replacement, automate the
remaining host setup: tested tools or a versioned AMI, release/config delivery,
instance-role secret retrieval, pinned image pull, pinned model cache preparation,
and readiness/inference checks. Fetch no credentials into user data or logs.
Model cache is disposable and reproducible; Supabase data is separate.

Normal updates remain stop-first on the same instance: build from committed
source, publish an immutable digest, stop/drain the old container, start/check the
new image, and restore the previous image plus matching config on failure. No
second host and no zero-downtime guarantee. Update the launch-template release
reference too, so a later replacement runs the intended release. Schema changes,
if ever needed, remain explicit; rolling back an image does not undo DB writes.

## Remaining work, in order

1. Resize the existing instance to t4g.medium. Resume the same release; verify
   readiness, one real inference, HTTPS, and zero new OOMs. No long RAM rehearsal.
2. Make bootstrap and the small stop-first release/rollback workflow repeatable.
   Preserve exact committed source, image, model, and config identities.
3. Prove the CloudFront replacement-origin switch and estimate its outage time.
   Then configure the one-instance replacement group and minimal recovery wiring.
   Ensure the old process is gone before a new one starts, including initial
   migration from the manually managed host. Keep the manual recovery runbook.
4. Rehearse one host failure and one persistent local application/model failure.
   Verify full automatic restoration, stale-event handling, replacement-loop
   limits, and stop-first rollback. Confirm missing health signals are detected.
5. Finish public-access protections: bounded inference admission and inputs,
   generic client errors, authenticated spending/request quotas, two-account
   isolation checks, signup/JWT/DB privileges review. Keep the origin private.
   Focused tests may use labeled development-DB records and clean them up.
6. Confirm Supabase backup coverage, credential rotation, and basic health/cost
   alerts. Estimate t4g.medium, IPv4, EBS/ECR, and recovery automation costs; use
   credits where eligible. No new paid monitoring stack is assumed.
7. Add private Prometheus operation-duration histograms and a small Grafana
   dashboard with p50/p95/p99, counts, and errors. Use bounded route labels;
   keep metrics off CloudFront. Choose inexpensive hosting/retention and either
   preserve telemetry across host replacement or explicitly accept its loss.
   Per-replica discovery and fleet-comparison features are unnecessary.
8. Test realistic concurrent users on the one host, prepare the standalone phone
   build when needed, and open viewer access only on explicit instruction.
   OpenTelemetry spans remain later optional work. Remove unused billable
   resources after the project ends.

## Verification and sources

No new ASG, origin automation, or health-recovery resources are provisioned by
this plan. A same-host resize is separate from automatic replacement. Existing
recorded checks remain historical evidence, not proof of the new recovery path.
The earlier deployment review remains in Git history; its multi-instance roadmap
is superseded by this document. The obsolete review and claim-design documents
are removed from the working tree to keep the change small.

AWS references: [ASG maintenance behavior](https://docs.aws.amazon.com/autoscaling/ec2/userguide/instance-maintenance-policy-overview-and-considerations.html),
[CloudFront VPC-origin update API and restrictions](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_UpdateVpcOrigin.html).
