# Cadenza deployment preparation

Local files for the [agent/human tutorial](../DEPLOYMENT_AGENT_HUMAN_TUTORIAL.md).
Rust starts Python inside one ARM64 backend container. CloudFront handles HTTPS.
Host port 80 maps directly to Axum port 3000; no reverse-proxy container runs.
Secret values stay on EC2 and are not returned to the workstation.

## Entry points and layout

Developers normally need one command, from a clean committed checkout:

```sh
./scripts/deploy-backend.sh
```

It builds/publishes the ARM64 image, bakes or reuses a compatible private AMI,
validates a fresh boot, activates the release and updates replacement settings.
Plan roughly 20-40 minutes when a new AMI is required; this is an estimate,
not a measured guarantee. The current backend serves during building/baking;
final activation briefly interrupts service. Prerequisites and options:
`./scripts/deploy-backend.sh --help`.

| Location | Purpose |
| --- | --- |
| `release.py` | Workstation release orchestration behind the developer command |
| Root shell/Python helpers and `compose.yaml` | EC2 installation, secrets, activation/rollback and startup checks |
| `ami/` | Production AMI baking, sanitization, validation and targeted reads |
| `recovery/` | ALB/ASG provisioning, release updates and optional outage rehearsals |
| `recovery/resources.json` | Current infrastructure and active release references |
| `releases/`, `ami/records/` | Release and validated AMI records |
| `history/`, verification JSON/JSONL files | Historical evidence; not executable setup steps |
| `iam/` | Instance access policies and historical account-policy changes |

The small host helpers are bundled onto EC2 by the release tooling; developers
do not run them individually. Completed experiment harnesses, the initial ALB
cutover script and retired manual-recovery scripts have been removed. Historical
records may refer to those retired tools. No infrastructure changes are needed
for this source cleanup.

## Current deployment

The API remains `https://d1wj9jjqzhjpqq.cloudfront.net`. CloudFront distribution
`ED64SQL5BYVBQ` now uses an internal ALB private origin, not a fixed EC2 origin.
ASG `cadenza-demo-single` has minimum/desired/maximum capacity one and ELB health
enabled. One t4g.medium (4 GiB), encrypted 16 GiB gp3, Standard CPU credits,
IMDSv2 and the existing instance role serve Rust plus its local Python model.

The ALB checks `/health/ready` every 5 seconds, timeout 4 seconds, three failures
and two successes. ALB connection draining is 30 seconds. Rust must respond and the local Python service must acknowledge
its loaded model. Provider outages are excluded. These probes are not inference
benchmarks or complete stall detection. ALB may fail open to its last unhealthy
target; recovery includes downtime.

Networking is CloudFront managed security group -> ALB port 80 -> backend port 80
-> Axum container port 3000. EC2 and ALB have no public API ingress. Each backend
retains a public IPv4 for outbound access. CloudFront still permits only home
viewer `24.11.70.86`; caching remains disabled and Authorization is forwarded.
The hostname/certificate and client configuration are unchanged.

Resource IDs, the current instance and launch template are recorded in
`recovery/resources.json`. Always discover the live host through ASG; replacement
changes instance ID, private/public IP and root/model-cache disk. Earlier launch,
network and build records are historical snapshots, not current host selectors.
Authenticate profile `cadenza-project` through us-east-2 and target resources in
us-west-2. `CADENZA_AWS_PROFILE` can select another authorized developer profile.

The deployed hardening settings are in `release.env.example`: in-memory user
request/tag quotas and a 7000-call global provider window, with two concurrent
local provider calls. Counters reset on restart. The model queue admits nine
jobs total and rejects excess work while health stays responsive. See
`recovery/verification.hardening_release.json` for deployed checks. Supabase Data
API is disabled; Auth and direct Postgres remain enabled. Home-only access stays
in place. Candidate settings are validated before a release builds its image.

## Verified recovery

`recovery/verification.model_failure.json` records Python being stopped while Rust
remained available, native ALB/ASG replacement, and a fresh successful bootstrap.
`recovery/verification.host_failure.json` records EC2 termination and automatic
recovery again. Both verified old-host termination, startup exclusivity, pinned
image, real 768-dimensional inference, healthy/zero-restart/zero-OOM state,
home-network HTTPS and off-home 403. `recovery/verification.rollback.json` records
known-bad candidate rejection and restoration of demo-004. Email subscription is
confirmed; SNS delivery metrics verified native notifications were delivered.

`recovery/verification.warm_timing.json` measures an unassisted warm-AMI replacement:
607.56 seconds from killing Python to HTTPS readiness plus `/test` returning 200.
The one-second probes observed a maximum 1.19-second sampling gap. Detailed checks
are separate in `verification.warm_runtime.json`: cached startup path, fresh SSM
identity/secrets, exclusivity, real inference, zero restarts/OOM, auth and home-only
access. The initial attempt hit the old 60-second startup inference limit and is
recorded separately as manually recovered. It is not an automatic-recovery result.
This establishes current timing, not a demonstrated speedup over older runs that
included verification. Model startup and initial snapshot reads remain slow.

The read-only full-root-partition initialization experiment is recorded in
`recovery/verification.disk_init_timing.json` and `recovery/verification.disk_init_boot.json`.
It took 743.035 seconds overall: the scan alone took 553.453 seconds, followed by
38.848 seconds of application startup/verification. The unsuccessful full-scan helper and deployment option were removed; evidence
is retained.

A subsequent control with 30-second ALB draining and no scan took 611.411 seconds
(10m 11s), essentially the same as the earlier 607.56-second run. Its app startup
and verification took 323.567 seconds, versus 38.848 after the full scan. Reading
the entire partition accelerated later startup but cost more than it saved.
Evidence: `recovery/verification.drain30_timing.json`, `verification.drain30_boot.json`
and `verification.drain30_runtime.json`. Both new runs retain every HTTP probe in
companion `.probes.jsonl` files. Maximum sampling gaps were 1.182 and 1.453 seconds.
AWS detection/boot timing varied; these single runs do not establish an SLA or
prove a speedup from reducing draining. Normal deployment keeps draining at 30
seconds and uses targeted file reads.

Targeted parallel reads are now the automatic warm-AMI startup path. The cold
replacement rehearsal took 257.965 seconds (4m 18s). Bootstrap-to-public-response
was 131.440 seconds, including prefetch, versus 372.941 for the no-scan control.
AWS detection was also faster in this run; this is an observed result, not a
recovery guarantee. Detailed timings and verification are in
`recovery/verification.targeted_{timing,boot,runtime}.json`. Temporary AMI
builder/validator instances were terminated. No paid initialization or CPU-credit
billing changes were enabled.

No Lambda recovery controller remains. Supabase schema was not changed. No RAM
rehearsal was repeated. The original 2 GiB measurements and manual model recovery
are preserved in Git/history; current capacity is 4 GiB.

## Developer releases

Run one release at a time, from a clean committed checkout with Python 3.11+,
AWS CLI login and Docker buildx:

```sh
./scripts/deploy-backend.sh
```

Use `--help` or an optional `--tag`. The helper checks account/source, builds ARM64,
checks CPU model dependencies, publishes an immutable ECR digest, bakes and
independently validates a matching private AMI, activates on the single host with
rollback, and promotes the launch template. Baking happens before app downtime.
It writes a release manifest and updated nonsecret settings for a follow-up
commit. There are no GitLab runners or formal CD jobs. On macOS the command
prevents idle sleep for the release's lifetime. It also refreshes activation tools
on the existing host, so scripts are not left at the version from its last boot.

Baking uses temporary non-serving machines with model-only access, never database
credentials. The model token travels through stdin, not container environment
metadata or a file. The snapshot contains installed tools, image layers and model
files, with no containers, app secrets or saved agent identity. A fresh validator
checks inference with container networking disabled before promotion. Temporary
machines are terminated on completion/failure; failed AMIs/snapshots are removed.
A hard-killed workstation process can require manual cleanup of hosts tagged
`CadenzaImageBuilder=true`.

Warm AMIs are reused only when baked inputs match. Replacement still fetches fresh
secrets and verifies the pinned image. A matching cache skips tool installation
and model downloads; a mismatch falls back to cold preparation. A matching warm
boot automatically starts targeted parallel reads of Python/runtime files, the
model and backend executable, overlapping safe preparation. It waits before app
startup. This uses existing EC2/EBS capabilities, not paid restore features or a
new service. The read-only helper gets no app secrets and has no network. A
240-second budget and fallback preserve normal verified startup if it fails.

AMI baking hashes the prefetch inputs, checks the reader on the builder, and
repeats offline prefetch plus finite 768-dimensional inference on a fresh validator.
The release command handles creation, validation and template promotion; no manual
AMI or cache-setup step is required. AMIs capture disk,
not RAM, and first reads from snapshot-backed disks can be slow. No paid Fast
Snapshot Restore is enabled. Successful AMIs/snapshots remain for rollback and
incur storage charges; prune obsolete ones after checking launch-template and
release references, keeping the active and one known-working previous release.

The lower-level commands and maintenance limitations are described in
[recovery/README.md](recovery/README.md). The update helper temporarily uses EC2
host checks during planned app downtime, waits for ALB health to recover, then
restores ELB health. If the operator process is forcibly killed, explicitly
restore ELB health. Never publish an unverified candidate into replacement config.

## Health and shutdown

`/health/live` checks Rust HTTP; `/health/ready` also checks the loaded local model
within two seconds. Docker uses readiness but does not itself restart an unhealthy
running container. Native ASG replacement now provides that recovery path.
First inference during fresh-host bootstrap has a 300-second check allowance for
snapshot disk reads, before the launch hook admits traffic. Other inference checks
default to 60 seconds; application request/provider timeouts are unchanged.
SIGTERM stops new periodic work and drains accepted HTTP plus tracked work for
120 seconds, then cancels it. Child/DB cleanup has a further 15-second bound;
Docker allows 150 seconds. Business handler responses have a 50-second deadline;
tag generation has 40 seconds across chunks. Timeout cannot undo completed writes
or an already-sent provider request. Queued enrichment is best effort.

Exactly one backend may use this database, including local developer backends.
Fresh replacement bootstrap checks that other tagged hosts have terminated before
starting Rust. There are no claim leases/schema changes or distributed caches.

## Planned follow-up

The [current plan](../DEPLOYMENT_PLAN.md) records warm-AMI recovery and the remaining
public-access work. Public-access quotas,
bounded queues/inputs, sanitized errors and authorization tests remain required
before removing the home restriction. Private Prometheus/Grafana comes later;
OpenTelemetry spans are optional follow-up. No monitoring stack is provisioned.
ALB base cost is $0.0225/hour in Oregon plus usage; existing EC2, IPv4, EBS, ECR and
snapshot charges are separate from credits/free allowances.

## Client and HTTPS

The Metro/dev build continues using `https://d1wj9jjqzhjpqq.cloudfront.net`; no URL
or native rebuild is needed for the ALB migration. Keep phones on the approved
home Wi-Fi. CloudFront terminates viewer TLS and connects privately to ALB port
80. ALB forwards to host 80 / container 3000. There is no Caddy process, certificate
volume or reverse-proxy container. No domain purchase is required.

## Stop and resume

Do not stop an ASG instance directly to save credits: the group will replace it.
Discover the single InService ID via `describe-auto-scaling-groups`. For a staffed
shutdown, temporarily select EC2-only health, gracefully stop backend via SSM, then
set ASG minimum/desired to zero and restore ELB health. This removes compute while
retaining ALB/ECR/other storage charges. Resume by setting minimum/desired to one;
bootstrap and registration restore the same CloudFront URL.

```sh
aws autoscaling update-auto-scaling-group --profile cadenza-project --region us-west-2 \
  --auto-scaling-group-name cadenza-demo-single --health-check-type EC2
# Gracefully stop the discovered backend through SSM, then:
aws autoscaling update-auto-scaling-group --profile cadenza-project --region us-west-2 \
  --auto-scaling-group-name cadenza-demo-single --min-size 0 --desired-capacity 0 --health-check-type ELB
# Resume later:
aws autoscaling update-auto-scaling-group --profile cadenza-project --region us-west-2 \
  --auto-scaling-group-name cadenza-demo-single --min-size 1 --desired-capacity 1
```

Keep the origin private. If home IPv4 changes, update/test the CloudFront viewer
function; do not add public EC2 ingress. Model cache comes from the validated AMI on replacement.

## Secrets and release identity

Workload account is `175220118767`; management account is `625530883844`.
The instance role can retrieve the two Standard SecureString parameters, whose
data type is text and whose value is JSON: `/cadenza/demo/api` has DATABASE_URL,
OPENAI_API_KEY and APPLE_MUSIC_DEVELOPER_TOKEN; `/cadenza/demo/ml` has HF_TOKEN.
`fetch-secrets.py` validates and writes private env files on EC2. Keep values out
of Git/chat. Root-volume replacement does not replace Supabase data or parameters.

`release.env.example` is nonsecret: backend digest and pinned model revision.
The model is `google/embeddinggemma-300m` revision
`57c266a740f537b4dc058e1b0cda161fd15afa75`. Model changes require a separate vector
compatibility plan. Base images are pinned in `build.env.example`; host tool
versions are pinned in `install-host-tools.sh`. Actual image/build identities and
older measurements remain in their release records/history. Resource discovery
must use the ASG rather than historical IDs in those snapshots.

## Focused checks

```sh
python3 -m unittest discover -s deploy -p test_start_release.py -v
cargo test --locked --manifest-path backend-api/Cargo.toml operation_budget
cargo test --locked --manifest-path backend-api/Cargo.toml lifecycle_
./scripts/deploy-backend.sh --help
```

The intentional failure observer is `recovery/verify-replacement.py`; it observes
an already-triggered rehearsal and does not itself kill a process/instance. Do
not manually restart a failing backend while a native ASG rehearsal is active.
Historical fixed-duration 2 GiB RAM procedures are no longer deployment gates.

Granular startup events are appended to `logs/boot-stages.jsonl`: Docker up,
first observed Rust liveness, Python/model readiness, combined readiness,
Docker health, inference check start/end, and direct HTTP verification. Local
endpoint observation runs once per second; it does not execute inference. The
model-only comparison under `ami/startup-comparison.json` separately measures
imports, model construction, first encode and second encode with wall/CPU/I/O
counters. Those isolated timings are not full backend recovery times.
