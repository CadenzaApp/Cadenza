# One-backend replacement

One internal ALB is CloudFront's stable private origin. Its instance target group
checks `/health/ready` every 5 seconds, timeout 4 seconds, three failures to mark
unhealthy and two successes to recover. Rust checks the loaded local Python model;
external-provider availability is excluded. ALB health checks alone do not replace
hosts: the ASG must use ELB health and maintain desired capacity one. ALB
connection draining is 30 seconds; application shutdown still has its separate
120-second deadline and Docker allows 150 seconds.

`provision.py` creates/updates the ALB, security groups, target group, pinned launch
template and bootstrap permissions. `resources.json` records their identifiers.
It does not attach a host or switch CloudFront; those are deliberate cutover steps.
No Lambda controller or periodic polling service is used. ALB spans two AZs;
the single application host stays in its existing AZ, On-Demand t4g.medium.

`bootstrap-start.sh` uses matching prewarmed tools/image/model files (or cold
preparation on a mismatch), retrieves fresh SSM secrets, checks the pinned image,
and waits until every other
`CadenzaBackend=demo` host has terminated. Then it starts/verifies Rust/model and
completes the ASG launch hook. The gate's evidence is written to a private host
log. Do not remove the tag or detach a still-running backend to bypass the gate.
Failed bootstrap does not complete the hook. With capacity one, failures and
stop-first replacement cause an outage; ALB can fail open to its last unhealthy
target until replacement. This is not a zero-downtime deployment.

For a new backend release, developers use `./scripts/deploy-backend.sh` from a
clean committed checkout. `--help` lists prerequisites; `CADENZA_AWS_PROFILE`
overrides the default cadenza-project profile. The helper builds/publishes
the container, bakes and validates a private warm AMI, then performs the stop-first
activation/template promotion. Baking never runs a second application backend.

For an already-published candidate, keep a known-working image/config pair.
Set `WARM_AMI_MANIFEST` to its matching validated JSON record under `deploy/ami/records/`.
From the repo root:

```sh
python3 deploy/recovery/update-release.py deploy/release.env.example
python3 deploy/recovery/provision.py --warm-ami-manifest "$WARM_AMI_MANIFEST"
```

The first command temporarily changes ASG health to EC2, runs the host's
`activate-release.sh`, and restores ELB health in a `finally` block. It preserves
host-failure detection while allowing a planned app interruption. Candidate
images are pulled before stopping the old container; failed startup restores the
old env/image. Inspect the private activation log if rollback itself fails.
The second command publishes the same successful release into a new launch-
template version. Without `--warm-ami-manifest`, it deliberately publishes cold
bootstrap using the recorded base AMI. Do not publish an unverified candidate into
replacement config.
If the operator process is killed during maintenance, explicitly restore
`HealthCheckType=ELB`; do not leave expected application failures suppressed.

Native ASG/SNS notifications report launches, terminations and errors. Email
subscriptions need confirmation. Bootstrap may take several minutes for downloads;
the launch-hook timeout is one hour, followed by ASG retry. Native launch retries
are not a custom bounded circuit breaker: respond to repeated failure emails and
suspend Launch/ReplaceUnhealthy if necessary, then fix the launch template.

To stop for the night, first set ASG minimum/desired capacity to zero rather than
stopping its instance directly (the group would replace it). Gracefully stop the
backend before termination. To resume, set minimum/desired to one; bootstrap and
ALB registration restore the same CloudFront URL. Root/model-cache disks are
recreated on replacement. Supabase data and SSM parameters are separate.

Warm baking and cache validation live in `deploy/ami/bake.py` (`--help`). The cold
base AMI stays pinned in resources; do not change it to a baked application AMI.
Never bake a live host or allow cached containers to auto-start before the gate.

`rehearse-warm-recovery.py` deliberately kills the Python child on the live backend.
Run only for a staffed, authorized outage rehearsal from home. It records the
remote crash timestamp, HTTPS readiness plus `/test` probes, and the first
responding replacement. Probe cadence is one second with two-second timeouts;
clock/date checks guard gross clock skew. Detailed post-recovery checks run
separately with `verify-replacement.py --output` so their duration is excluded
from the outage measurement. The evidence is `verification.warm_timing.json`.

For observation without causing an outage, run:

```sh
python3 deploy/recovery/watch-api.py | tee /tmp/cadenza-api-probes.jsonl
```

Each JSON line has request start/end timestamps, status and elapsed time. Stop
with Ctrl-C. Requests start about once per second; a two-second network timeout
can lengthen the interval. The rehearsal also saves every probe to a companion
`.probes.jsonl` file. Use `--output verification.NAME.json` to preserve other runs.
Fresh hosts write UTC stage timestamps to `logs/boot-stages.jsonl`. Release and
rehearsal helpers prevent macOS idle sleep automatically; prefix the standalone
watcher with `caffeinate -i` for long Mac observations. Inspect
`maximum_sample_gap_seconds` before treating a result as precise; the rehearsal
marks sampling gaps over three seconds as unsuitable for precise timing.

The unsuccessful full-disk scan experiment and its deployment option have been
removed. Its timing evidence is retained. Normal warm bootstrap automatically
overlaps targeted file prefetch with other preparation. Prefetch only reads selected runtime/model files, with no
Rust process, network, app secret environment or database access. Failure falls
back to normal startup; readiness and inference remain mandatory.

`start-release.sh` launches the lightweight local endpoint observer, writes finer
Docker/readiness/inference timestamps, and verifies actual inference. The updater
ships these tools automatically before activation. The cold rehearsal also
records ALB target transitions separately from ASG transitions.

The optimized cold rehearsal recovered in 257.965 seconds. These are observed
stages, not fixed deadlines; endpoint observations have about one-second resolution.

| Stage | Seconds |
| --- | ---: |
| Crash to ALB observed unhealthy | 16.146 |
| ALB unhealthy to ASG observed unhealthy | 12.269 |
| ASG unhealthy to replacement first observed pending | 12.687 |
| Replacement pending to bootstrap started | 85.423 |
| Bootstrap to cache checked / prefetch started | 7.740 |
| Targeted prefetch wall time, overlapping secrets and exclusivity | 86.552 |
| Secrets/image preparation, inside prefetch interval | 20.620 |
| App start to Docker up finished | 1.766 |
| App start to first Rust liveness | 4.319 |
| App start to Python/model and combined readiness | 25.322 |
| Combined readiness to Docker health recognized | 7.257 |
| Inference verification command | 0.844 |
| Actual embedding HTTP call within verification | 0.317 |
| Launch hook completed to first public readiness/API success | 2.430 |

Rows overlap and must not be added. Internal prefetch reads took 74.877 seconds;
its host wall time includes starting the helper container. The model-only A/B
records in `../ami/startup-comparison.json` split imports, model construction,
and first/second inference further. The production observer avoids an extra
inference that would warm the model before the measured verification call.
Raw evidence is in `verification.targeted_boot.json` and
`verification.targeted_timing.json`; every external probe is in the companion
`.probes.jsonl` file. Post-recovery checks are separate in
`verification.targeted_runtime.json`.
