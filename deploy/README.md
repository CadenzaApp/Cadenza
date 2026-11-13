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

## Current release status

- Public API: `https://d1wj9jjqzhjpqq.cloudfront.net`. CloudFront distribution
  `ED64SQL5BYVBQ` is Deployed. AWS supplies and renews the certificate for this
  hostname; no domain purchase or Elastic IP is needed.
- EC2 `i-08d25ed9caea17d6c` is running in Oregon (`us-west-2a`). Both status checks
  pass and SSM is Online. ARM64 `t4g.small`, encrypted 16 GiB gp3, Standard CPU
  credits, IMDSv2, no SSH key, and the existing `cadenza-demo-ec2` role are retained.
  Its current automatic public IPv4 is `44.252.98.246`, used for outbound internet
  access. No public web ingress is allowed, including from home.
- CloudFront VPC origin `vo_L2Rr93sW0VUGHV32abqyEu` reaches Axum through private host TCP 80, mapped to container port 3000.
  The EC2 security group allows that port only from AWS's service-managed
  `sg-08b7eea10cfe45bc2`. The subnet retains its internet route for outbound AWS,
  Supabase, OpenAI, Apple Music, and model access; no NAT gateway was added.
- `cloudfront-home-only.js` allows only viewer IPv4 `24.11.70.86`. Other viewers
  receive 403. AWS function tests and real requests from EC2 verified denial,
  including requests with a forged X-Forwarded-For header. Public HTTP is rejected;
  IPv6 viewers are disabled. Keep phones on home Wi-Fi. Any broader access needs
  an operator instruction.
- API caching is disabled, including error caching for configured error codes.
  All seven HTTP methods are enabled. Authorization headers, cookies, and query
  strings are forwarded; the origin Host is its private DNS name. See
  `cloudfront-distribution.json`, `cloudfront-vpc-origin.json`, and
  `cloudfront-status.json` for the applied configuration and resource IDs.
- Rust/Python are healthy behind the private CloudFront origin. Normal curl certificate verification
  returned HTTPS 200 and `server is reachable` for `/test`. Anonymous
  `/tags/activity` returned 401; POST to the GET-only test route returned 405.
  The same HTTPS check passed after removing direct EC2 public web ingress.
- Sixty real model requests returned 768 finite values. A 330-second capture
  retained at least 33.98% host memory and 59.87% disk free, with no OOM kills,
  swap activity, unexpected restarts, or unhealthy steady-state samples. Median
  inference latency was 0.251 seconds; maximum was 1.415 seconds. Cold startup
  was also sampled. A subsequent 885-second capture included 32 timed model
  requests and the operator phone checks: at least 32.59% memory and 59.69% disk
  remained available, with no OOM kills, swap activity, restarts, or unhealthy
  samples. The planned 30-minute capture was deliberately ended early, not failed.
  Two overlapping model requests and maximum-length post/interest checks also
  passed. Keep t4g.small for current testing; broader load remains unverified.
- The deliberate Python-child failure rehearsal passed: combined health became
  unhealthy, then a backend restart restored health, inference, and proxy HTTP.
  `rehearse-recovery.sh` automates this staffed rehearsal. It does not provide
  unattended child recovery. The initial attempt lacked its helper; the helper
  was installed and the successful test rerun. Records are in
  `runtime-verification.json`; the old direct HTTP record is retained separately.
- Workload account: `175220118767`; management account: `625530883844`.
  Authenticate `cadenza-project` through Ohio (`us-east-2`), then explicitly
  target Oregon for EC2/ECR/SSM. CloudFront control-plane calls use `us-east-1`.
  The reviewed SCP exception, IAM role/profile, and two Standard SecureString
  parameters remain in place. Credentials stay on EC2; they are not returned to
  chat. The operator authorized resuming EC2 and selected the CloudFront path.
- Branch `aws-deployment`, base source commit
  `ae49612e55302cbc8e236d94fb4f4a8554cc3c20`. The published image was built from
  that base plus working-tree changes, so the base alone does not reproduce it.
  `build-record.json` records all 97 inputs as they were at build time. Use an
  exact committed source version for the next frozen release.
- Backend `demo-002` is pinned to
  `sha256:e029d73a3044ed1c4e492ea0b2395d0b93b27c0594811fa6212c57ca0ebfd2b4`.
  ECR reports 347325556 compressed bytes. Model revision is
  `57c266a740f537b4dc058e1b0cda161fd15afa75`. The pinned model cache is on EBS.
  demo-001 failed on a required physical `.env` file and is not a working rollback.
- Budget preference: maximize Free Tier/credits. Operator reported $120 available;
  expiry lookup is deferred and no paid monthly cap was agreed. CloudFront uses
  pay-as-you-go, whose published free allowance includes 1 TB transfer out and
  10 million HTTP(S) requests monthly. Account usage and additional features can
  incur charges. Existing EC2, public IPv4, EBS, and ECR charges still apply.
  See [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/).

Retired HTTP tests, the original launch request, and the failed demo-001 build
record are preserved under `history/` for audit. They are not active deployment
inputs. Keep the original/applied SCP files under `iam/` for review and recovery;
those policy backups are intentional, not temporary files.

## Planned reliability work

There is no load balancer or Auto Scaling group in the current deployment.
The [deployment plan](../DEPLOYMENT_PLAN.md#planned-reliability-and-scaling-architecture)
now records internal ALB plus ASG automatic replacement, later one-to-two scaling,
and launch-before-terminate rollouts. This is documentation only. Shared claims,
process-local state, DB pool budgeting, readiness, and graceful shutdown must be
addressed before permitting a second backend, including temporary rollout overlap.
The plan also contains the consolidated remaining-work checklist. No new resources
or RAM test were started for this planning update.

## Planned observability

The [metrics and tracing plan](../DEPLOYMENT_PLAN.md#planned-metrics-and-tracing)
starts with private Prometheus `/metrics`, per-operation duration histograms,
per-instance target discovery, and a versioned Grafana latency dashboard showing
fleet and instance p50/p95/p99. Later work adds OpenTelemetry request and child
spans for compute, DB, local Python/model, and external API calls. Nothing is
instrumented or provisioned yet. Metrics must be scraped per instance, not through
the load balancer, and must not become a public API endpoint. Hosting, retention,
and overhead need a budget decision before implementation.

## Client and HTTPS

`client-app/.env` now sets `EXPO_PUBLIC_BACKEND_API_URL` to the CloudFront HTTPS
address. Only that setting was changed. `client.env.example` is the nonsecret
reference. Expo inlines it at bundle time, so restart Metro with `--clear` before
reopening the existing development build. A URL change needs no native rebuild.
A standalone signed build must be bundled with the same setting.

CloudFront manages viewer TLS. Its private origin uses the instance's private DNS
name on port 80. Docker maps that port directly to the Axum listener on container
port 3000. `release.env.example` contains only the backend image and model
revision and is deployed as `/opt/cadenza/release.env`. No Caddy process, image,
certificate volumes, Caddyfile, or proxy environment settings remain on EC2.
The backend image and CloudFront configuration did not change for this removal.

The removal passed combined Rust/model health, one real inference request, direct
host HTTP, and public HTTPS with normal certificate verification. No RAM rehearsal
or before/after memory measurement was run. The earlier resource results below
and in the historical verification record predate this change. Removing the proxy
is expected to save a modest amount of RAM; the model remains the main consumer.

The public IPv4 remains for outbound access. The live route is
`0.0.0.0/0 -> igw-092a57cb09ca88208`, with no NAT gateway route. A curl request
explicitly bound to private IPv4 `172.31.39.41` was observed externally as
`44.252.98.246`. The OS uses the private source address and the internet gateway
translates it using the associated public IPv4. Private addressing can support
internet egress through a NAT device or another design, but the private address
alone cannot provide public IPv4 access through the current route. References:
[AWS internet gateway addressing](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)
and [NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html).

Before broadening public access, review the potential work recorded in
[PUBLIC_ACCESS_REVIEW.md](PUBLIC_ACCESS_REVIEW.md). These are suggestions, not
newly implemented controls or an approved hardening scope.

AWS ACM exportable certificates were also considered. They require a domain we
control and currently cost $7 per standard domain at issuance and renewal, plus
renewed-certificate deployment automation. AWS Private CA is not publicly trusted
and is unsuitable for ordinary phone trust. CloudFront provides its own trusted
hostname without either of those steps. References:
[CloudFront HTTPS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-viewers-to-cloudfront.html),
[VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html),
[ACM exportable certificates](https://docs.aws.amazon.com/acm/latest/userguide/acm-exportable-certificates.html),
[ACM pricing](https://aws.amazon.com/certificate-manager/pricing/), and
[AWS certificate options](https://docs.aws.amazon.com/acm/latest/userguide/service-options.html).

The operator reported tag/query changes, listening/analytics, post creation,
interests/feed, like/unlike, and relaunch persistence all working with no issues
in the Metro build. Multi-device use was not tested. The roughly 15-minute
resource capture is sufficient for continuing current development; 30 minutes
was a conservative planning target, not a fixed requirement. Simultaneous
authenticated devices and performance at depleted CPU credits remain unverified.
Resize to t4g.medium only if memory/correctness evidence warrants it.

## Stop and resume

Stop backend through SSM before stopping the existing EC2 instance to
save compute credits. EBS/ECR storage remains chargeable. CloudFront can stay
configured; its hostname remains stable while EC2 is off, but requests cannot
succeed. Never launch a second instance to resume this deployment.

Start `i-08d25ed9caea17d6c`, wait for both EC2 checks and SSM Online, then enter
`/opt/cadenza` through Session Manager. Use `release.env.example` as the
reference for `release.env`. The private DNS name remains stable across a normal
stop/start, so there is no public-IP configuration change to make. Deliberately stopped containers need
Compose up. Run `bash start-release.sh` to start backend, wait for combined health,
verify one embedding, and check host HTTP. It does not sample resources. For a
fresh model cache, explicitly set `CADENZA_PREFETCH_MODEL=1`; normal resumes use
the retained offline cache. Verify:

```sh
curl --fail --show-error https://d1wj9jjqzhjpqq.cloudfront.net/test
```

Reconfirm the home public IPv4. If it changes, update and test/publish the
CloudFront function before testing. Keep the EC2 ingress private. Do not reapply
`history/network-ingress.home-http.json`; it describes the retired direct public HTTP
setup. Do not enable public web ingress to resume.

## Build on the laptop

Use Docker Desktop with its Compose plugin at 2.30 or newer before
using the documented `docker compose` commands. To reproduce the image, these steps
do not start the app or connect to Supabase. Run from the repo root:

```sh
. deploy/build.env.example
docker buildx build --platform linux/arm64 \
  --build-arg UV_IMAGE="$CADENZA_UV_IMAGE" \
  --build-arg RUST_IMAGE="$CADENZA_RUST_IMAGE" \
  --build-arg PYTHON_IMAGE="$CADENZA_PYTHON_IMAGE" \
  -f deploy/backend.Dockerfile -t cadenza-backend:demo-002 --load .
docker image inspect cadenza-backend:demo-002 --format '{{.Os}}/{{.Architecture}}'
docker run --rm --platform linux/arm64 --entrypoint python cadenza-backend:demo-002 \
  -c 'import torch; assert torch.version.cuda is None; print("CPU-only Torch verified")'
```

Expect `linux/arm64`. The image build uses no model token or model weights.
The `.dockerignore` allows only the required manifests and source into its context.
Use a fresh release tag after edits; do not overwrite a published release.
The base images are pinned, but apt repositories are not snapshot-pinned; retain
the resulting backend digest as the release identity.

To validate Compose without real secrets, use a temporary copy of `compose.yaml`
only. Create `secrets/api.env` and `secrets/ml.env` containing dummy
values for the documented keys, and a dummy `release.env` with backend image and
model revision settings.
From that directory, run `docker compose --env-file release.env config --quiet`.
This checks configuration without starting containers. Never use a verbose
config dump with real secrets.

## Human: publish only after the build passes

In the AWS console, select workload account `175220118767` and Oregon. Open
Amazon ECR -> Private repositories -> Create repository. Name it
`cadenza-backend`, choose Immutable tags without exclusions, and leave encryption
at the default AES-256 setting. Do not enable enhanced scanning for this initial
budget deployment. See [ECR creation](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-create.html).

On your laptop, authenticate under your own control. A named profile keeps this
session separate. With AWS CLI 2.32+ and console-login permissions, run:

```sh
aws login --profile cadenza-project --region us-east-2
aws sts get-caller-identity --profile cadenza-project --query Account --output text
```

Select the workload account in the browser, not the management account. The
identity check must return `175220118767`. If your account uses IAM Identity
Center authentication instead, use its SSO profile setup. Do not create or send
long-lived access keys. See [CLI sign-in](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).

Before creating the repository, test Oregon access without changing resources:

```sh
aws ecr describe-repositories --profile cadenza-project --region us-west-2 \
  --query 'repositories[].repositoryName' --output json
```

An empty list is successful authorization with no repositories yet. If access is
denied, inspect the exact error and regional organization policies before changing
them. Keep the working login region; resource commands use `--region us-west-2`.

The operator supplied the blocking SCP. Its `UsWest2Partitional` statement denies
Oregon service calls except a small list that omits ECR/EC2. `RegionFloor` already
includes Oregon. `iam/p-iqll9p29.oregon.json` adds only
`StringNotEquals: {"aws:PrincipalAccount": "175220118767"}` to that statement's
condition. This exempts the workload account from this Oregon deny while keeping
the same statement for other accounts. All other statements remain unchanged.
This does not grant IAM permissions or remove any other SCP denies.

Human operator, from the repository root and the management-account profile:

```sh
aws organizations update-policy --profile cadenza-management --region us-east-1 \
  --policy-id p-iqll9p29 --content file://deploy/iam/p-iqll9p29.oregon.json \
  --query Policy.PolicySummary.Id --output text --no-cli-pager
```

Then repeat the read-only Oregon ECR check above. Original content from the
operator's export is saved as `iam/p-iqll9p29.before.json`; the same update command
with that file restores the previous policy. The proposed JSON is minified
(5097 bytes including newline) to stay below the 5120-byte SCP limit. Do not
pretty-print it before uploading. Local checks verify the exact one-condition
change and JSON syntax. The agent applied this exact change, read it back, and
verified workload ECR access in Oregon. That policy step created no repositories
or images; the subsequent ECR publication was separately authorized and completed.

After confirming the account, Oregon access, and repository, publish the image already built:

```sh
export CADENZA_REGISTRY=175220118767.dkr.ecr.us-west-2.amazonaws.com
aws ecr get-login-password --profile cadenza-project --region us-west-2 | docker login --username AWS --password-stdin "$CADENZA_REGISTRY"
docker tag cadenza-backend:demo-002 "$CADENZA_REGISTRY/cadenza-backend:demo-002"
docker push "$CADENZA_REGISTRY/cadenza-backend:demo-002"
aws ecr describe-images --profile cadenza-project --region us-west-2 \
  --repository-name cadenza-backend --image-ids imageTag=demo-002 \
  --query 'imageDetails[0].imageDigest' --output text
```

Provide the nonsecret published digest (starts with `sha256:`) to the agent.
The deployed CloudFront hostname now supplies public HTTPS. The commands below
remain setup references, not instructions to recreate existing resources.

## Human: install later on EC2

Follow the tutorial for budget checks, data protection, IAM, EC2, DNS, and Docker.
The account-specific trust policy is `iam/ec2-trust.json`; the inline pull/secret
policy is `iam/ec2-permissions.json`. Use these when creating `cadenza-demo-ec2`
and also attach `AmazonSSMManagedInstanceCore`, as the tutorial requires. These
files now match the created and verified role and instance profile.
The AWS-managed policy includes account-wide `GetParameter`/`GetParameters`.
The inline policy explicitly denies parameter reads outside the two deployment
parameter ARNs, preserving the intended scope when both policies are attached.
The planned role and instance profile are both named `cadenza-demo-ec2`; creating
them does not launch an instance. The only trusted service is EC2. The inline
policy adds private image pulls from cadenza-backend and direct retrieval of the
two deployment parameters. The managed policy supplies the SSM agent channels.

### Private origin and home-only viewers

`network-ingress.json` now describes only TCP 80 from the CloudFront service-managed
security group. The original home-CIDR rules are archived as
`history/network-ingress.home-http.json`; they were revoked after HTTPS verification.
Create the VPC origin and discover its AWS-managed group before configuring that
source. Do not edit the managed group itself. The CloudFront viewer-request
function enforces the home public IP, and public HTTP is rejected. Preserve
outbound access and Session Manager without inbound SSH. See the current endpoint
and configuration sections above for the selected architecture.

The expected directory is `/opt/cadenza` in a root Session Manager shell:

```sh
sudo -i
umask 077
install -d -m 700 /opt/cadenza /opt/cadenza/secrets
cd /opt/cadenza
```

Transfer `compose.yaml`, `fetch-secrets.py`, `start-release.sh`, and
`check-embedding.py`. Rehearsal tools are `rehearse-model-crash.py`,
`rehearse-recovery.sh`, and `sample-resources.py`.
Use `release.env.example` as `release.env` for this existing deployment.
Direct private-origin routing and public CloudFront HTTPS have both passed live checks.
Do not transfer local secrets or AWS profiles. Fetch secrets on EC2 only:

```sh
python3 fetch-secrets.py
ls -l secrets
docker compose --env-file release.env config --quiet
```

Then authenticate to ECR and pull per tutorial step 8. Run the CPU-only check and
model prefetch from that step before starting Rust. Stop all other backends using
the same database. Start and verify in this order:

```sh
docker compose --env-file release.env up -d backend
docker compose --env-file release.env ps
docker compose --env-file release.env exec -T backend python - < check-embedding.py
```

Wait for healthy status before the embedding check. Expect 768 finite dimensions.
Verify public HTTPS and database-backed phone flows per the tutorial. The health
check alone proves neither inference nor database readiness.

## Accept or reject the 2 GiB instance

The longer procedure below is the comprehensive rehearsal reference. The operator
accepted a shorter initial capture for current development; see the results above.
Multi-device and low-credit performance still require separate validation.

Do this on the real `t4g.small` with the backend container running. A container memory cap
on a laptop does not reproduce memory used by Ubuntu, Docker, and Session Manager.
Do not build the image on this instance. Keep the same model and precision.

1. In a second root Session Manager shell, enter `/opt/cadenza` and run the sampler
   before model prefetch and cold startup. Keep it running through both operations:

   ```sh
   python3 sample-resources.py --duration 1800 --interval 2 > startup-resources.jsonl
   ```

   If startup takes longer, rerun it before continuing. The script samples host
   memory, swap activity, kernel OOM counts, disk space, and backend health/restarts.
   It reads only selected Docker fields and makes no AWS calls. Keep the initial
   and final samples. Cumulative swap/OOM counters must be compared to the baseline.
   An absent/starting backend is expected during prefetch and initial startup.

2. After the backend is healthy, run a second 30-minute capture in that session:

   ```sh
   python3 sample-resources.py --duration 1800 --interval 10 > steady-resources.jsonl
   ```

   In the first session, run 60 inference requests while exercising the phone:

   ```sh
   docker compose --env-file release.env exec -T backend python - --requests 60 --interval 5 < check-embedding.py
   ```

   Each request must return 768 finite values. The script reports latency without
   printing post text or vectors. Also test the longest realistic post and interest
   update through the app; a short synthetic request alone is insufficient.

3. For the full 30 minutes, use the signed phone build with Metro stopped:
   login; read a saved query; add/remove a tag and rerun its query; log listening
   activity and read analytics; create a post, update interests, reload the feed,
   and like/unlike. Verify writes persist after relaunch. Include two simultaneous
   users and check account isolation. Note timestamps and any failing flow.
   Choose acceptable phone response times before the test; retain inference timing
   output so a larger instance can be compared against the same workload.

4. Pass only with no failed flows, invalid vectors, timeouts, OOM kills, unexpected
   restarts, or unhealthy states after readiness. Require at least 20% host
   `MemAvailable` throughout measured startup and steady use (roughly 400 MiB on
   this host), no sustained increases in swap-in/out counters, and 25% disk free
   with current and rollback images present. Sampling can miss short peaks; check
   kernel logs too. Inspect EC2 `CPUCreditBalance` in the console and repeat the
   workload when credits are low before relying on Standard-mode performance.

5. Reboot and repeat cold startup plus the critical phone/model checks. If memory
   headroom or correctness fails, retain sanitized measurements and follow tutorial
   step 11 to stop the stack/instance, resize to `t4g.medium`, and repeat the test.
   Investigate non-memory failures separately rather than assuming a resize fixes
   them. Do not hide memory failure by adding swap or changing embedding precision.

Only after these checks can 2 GiB be considered tested. The sampler alone does
not establish application correctness or produce an automatic pass verdict.

## Deliberate crash rehearsal

Run only during rehearsal after a healthy start. This intentionally stops Python:

```sh
docker compose --env-file release.env exec -T backend python - < rehearse-model-crash.py
```

Wait for unhealthy status, then recover:

```sh
docker compose --env-file release.env restart backend
docker compose --env-file release.env ps
docker compose --env-file release.env exec -T backend python - < check-embedding.py
```

Wait for healthy status before the embedding check, then repeat a phone flow.
Docker does not automatically restart the container when only Python fails.
