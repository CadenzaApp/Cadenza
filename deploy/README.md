# Cadenza deployment preparation

Local files for the [agent/human tutorial](../DEPLOYMENT_AGENT_HUMAN_TUTORIAL.md).
Rust starts Python inside one ARM64 backend container. CloudFront handles HTTPS.
Host port 80 maps directly to Axum port 3000; no reverse-proxy container runs.
AWS commands below can be run by the human operator. The operator has also
authorized the agent to use existing local CLI sessions for the reviewed SCP
change and deployment inspection. The operator separately authorized creating the
ECR repository and uploading demo-001 regardless of charges. Other billable
resources require separate authorization. The operator subsequently approved the
EC2 role/profile and the single t4g.small launch with encrypted 16 GiB gp3, one
public IPv4, and home-only ingress. The operator then instructed the agent to
complete actual server startup, including host tools, host-side secret retrieval,
model preparation, the startup fix in demo-002, and curl verification. Secret
values stay on EC2 and are not returned to chat.

The operator subsequently authorized the 4 GiB upgrade, internal ALB, capacity-one
ASG, failure rehearsals, and native email notifications.

## Current deployment

The API remains `https://d1wj9jjqzhjpqq.cloudfront.net`. CloudFront distribution
`ED64SQL5BYVBQ` now uses an internal ALB private origin, not a fixed EC2 origin.
ASG `cadenza-demo-single` has minimum/desired/maximum capacity one and ELB health
enabled. One t4g.medium (4 GiB), encrypted 16 GiB gp3, Standard CPU credits,
IMDSv2 and the existing instance role serve Rust plus its local Python model.

The ALB checks `/health/ready` every 10 seconds, timeout 5 seconds, three failures
and two successes. Rust must respond and the local Python service must acknowledge
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

## Verified recovery

`recovery/verification.model_failure.json` records Python being stopped while Rust
remained available, native ALB/ASG replacement, and a fresh successful bootstrap.
`recovery/verification.host_failure.json` records EC2 termination and automatic
recovery again. Both verified old-host termination, startup exclusivity, pinned
image, real 768-dimensional inference, healthy/zero-restart/zero-OOM state,
home-network HTTPS and off-home 403. `recovery/verification.rollback.json` records
known-bad candidate rejection and restoration of demo-004. Email subscription is
confirmed; SNS delivery metrics verified native notifications were delivered.

No Lambda recovery controller remains. Supabase schema was not changed. No RAM
rehearsal was repeated. The original 2 GiB measurements and manual model recovery
are preserved in Git/history; current capacity is 4 GiB.

## Developer releases

From a clean committed checkout with Python 3, AWS CLI login and Docker buildx:

```sh
./scripts/deploy-backend.sh
```

Use `--help` or an optional `--tag`. The helper passed an end-to-end deployment from committed source. It checks
account/source, builds ARM64,
checks CPU model dependencies, publishes an immutable ECR digest, activates on the
single host with rollback, and updates the launch template. It writes a release
manifest and updated nonsecret settings for a follow-up commit. It currently uses
cold bootstrap; automated sanitized AMI baking is planned in the same entry point,
not yet implemented. There are no GitLab runners or formal CD jobs.

The lower-level commands and maintenance limitations are described in
[recovery/README.md](recovery/README.md). The update helper temporarily uses EC2
host checks during planned app downtime, waits for ALB health to recover, then
restores ELB health. If the operator process is forcibly killed, explicitly
restore ELB health. Never publish an unverified candidate into replacement config.

## Health and shutdown

`/health/live` checks Rust HTTP; `/health/ready` also checks the loaded local model
within two seconds. Docker uses readiness but does not itself restart an unhealthy
running container. Native ASG replacement now provides that recovery path.
SIGTERM stops new periodic work and drains accepted HTTP plus tracked work for
120 seconds, then cancels it. Child/DB cleanup has a further 15-second bound;
Docker allows 150 seconds. Business handler responses have a 50-second deadline;
tag generation has 40 seconds across chunks. Timeout cannot undo completed writes
or an already-sent provider request. Queued enrichment is best effort.

Exactly one backend may use this database, including local developer backends.
Fresh replacement bootstrap checks that other tagged hosts have terminated before
starting Rust. There are no claim leases/schema changes or distributed caches.

## Planned follow-up

The [current plan](../DEPLOYMENT_PLAN.md) adds sanitized warm AMIs to shorten cold
start and integrate them into the developer release script. Public-access quotas,
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
function; do not add public EC2 ingress. Model cache is recreated on replacement.

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
not use the retired manual-restart rehearsal while native ASG recovery is active.
Historical fixed-duration 2 GiB RAM procedures are no longer deployment gates.
