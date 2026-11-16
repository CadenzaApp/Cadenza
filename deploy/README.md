# Backend deployment runbook

Start with [GETTING_STARTED.md](GETTING_STARTED.md) for workstation setup,
macOS/Windows commands, AWS login and private Grafana access.

## Running architecture

```text
Phone -> CloudFront HTTPS -> private ALB -> one EC2 -> Rust + local Python model
                                                    -> Supabase / Apple / OpenAI
```

Account 175220118767 is named Cadenza Backend. Workloads run in us-west-1;
AWS CLI browser login uses us-east-2. Settings are in `aws-config.json` and
`recovery/resources.json`. The API is https://d1wj9jjqzhjpqq.cloudfront.net.

The ASG is fixed at one t4g.medium with encrypted 16 GiB gp3 storage. CloudFront
provides HTTPS without a purchased domain. EC2/ALB have no public API ingress.
The instance has a public IPv4 for outbound calls; clients use CloudFront.
ALB probes `/health/ready` every 5 seconds, requiring Rust and the loaded Python
model. Shared-provider outages do not fail readiness. ASG replaces failed hosts
and emails configured subscribers. Recovery has downtime; ALB can fail open to
its last unhealthy target while replacement is pending.

## Files developers need

| File | Purpose |
| --- | --- |
| `release.py` | Shared macOS/Windows deployment command |
| `release.env.example` | Current immutable image, model revision and quota settings |
| `build.env.example`, `backend.Dockerfile` | Pinned ARM64 build dependencies |
| `releases/` | Current/recent release manifests for audit and rollback |
| `recovery/resources.json` | Live resource IDs and replacement configuration |
| `recovery/verification.release.json` | Latest consolidated deployment checks |
| `monitoring/` | Private Prometheus/Grafana configuration and dashboards |

The remaining shell scripts and `fetch-secrets.py`, `prepare-monitoring.py`,
`check-embedding.py` and `observe-startup.py` are Linux EC2 internals, shipped by
the deploy command. Developers do not run or port them on Windows. Older manual
walkthroughs, AMI experiments and raw probe dumps were removed; Git history
retains the previous work.

## Release and rollback

Deploy a clean committed checkout with `scripts/deploy-backend.sh` on macOS or
`scripts\deploy-backend.bat` on Windows. It builds/publishes an immutable digest,
pulls it before stopping the current backend, activates it with rollback, checks
Rust/model readiness and actual inference, and publishes the same settings into
the launch template. Monitoring is verified separately so a dashboard failure
does not stop a healthy API. The command prevents idle sleep on macOS.

The single-host update briefly selects EC2-only health during expected app
downtime, then restores ELB health. If a developer forcibly kills the command,
check the server and restore `HealthCheckType=ELB`; do not leave app recovery
suppressed. Coordinate one deployment at a time. Logs stay private under
`/opt/cadenza/logs` and are accessible through SSM, not the public API.

A known-bad startup is automatically rolled back. For a deliberate rollback,
restore a known-working `release.env.example` image/model/quota combination,
then run the existing-candidate commands from the repo root:

```text
python3 deploy/recovery/update-release.py deploy/release.env.example
python3 deploy/recovery/provision.py
```

On Windows use `py -3` instead of `python3`. Do not publish replacement settings
unless activation succeeds. Commit the resulting settings/resource record.
Secrets are fetched fresh, so reverting an image does not revert credentials.
For normal source changes, use the top-level deploy command instead.

There is no AMI baking. Fresh replacements boot the pinned Ubuntu OS base,
install tested tools, download the pinned application/model, fetch fresh secrets,
and verify readiness/inference. Bootstrap waits for all other tagged backend
hosts to terminate before starting Rust. Existing hosts reuse their caches.
Fresh recovery is slower than the retired baked-image path and depends on
package/image/model downloads. Do not quote old AMI rehearsal timings as current
recovery promises. Historical AWS images remain for reviewed pruning; do not
delete images referenced by older launch templates without checking those uses.

## Secrets and application safety

Secrets are Standard SSM SecureString text parameters containing JSON. Values
stay on EC2, outside images, manifests and Git. Root/Docker administrators and
AWS identities with decryption rights can inspect them. Use the AWS console or
a protected local workflow to rotate values, then reactivate the release and
revoke the old credential after checking the affected operation.

Database access requires `sslmode=verify-full` and
`sslrootcert=/etc/ssl/certs/cadenza-supabase-root.crt`. The public CA in
`certs/supabase-root.cer` expires April 26, 2031. Do not disable verification.
Database password rotation requires a coordinated maintenance window.

The Supabase Data API is disabled. Supabase Auth and direct Postgres remain in
use; the backend owns authorization. Distributing the phone app is not a signup
restriction. [PUBLIC_ACCESS_REVIEW.md](PUBLIC_ACCESS_REVIEW.md) summarizes controls
and known gaps. Request quotas are in memory and reset on process restart.
Tag generation and the assistant share the global provider-call budget and
concurrency limit; their per-user request limits are separate.

## Operations

Use the [private dashboard](monitoring/README.md) first. Public `/metrics` is
intentionally 404. For recovery observation/rehearsal, see
[recovery/README.md](recovery/README.md). Do not stop an ASG instance directly to
save credits: it will be replaced. A planned shutdown requires graceful backend
stop and ASG minimum/desired zero, with ELB health restored; resume at one.
ALB and retained storage can still incur charges while compute is stopped.

Backups and concurrent-user testing were deferred by the team. OpenTelemetry
spans, Python queue-depth reporting, broader ownership tests and provider-key
scope review remain follow-ups in [DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md).
