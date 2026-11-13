# Put Cadenza on EC2 for the demo

> Current deployment uses CloudFront-managed public HTTPS with a home-only
> viewer function and a private EC2 VPC origin. No domain purchase, Elastic IP,
> or direct public EC2 web ingress is required. Axum serves the origin directly. Use [deploy/README.md](deploy/README.md)
> and its applied CloudFront configuration for this deployment.

For explicit agent and human responsibilities, use the
[agent/human version](DEPLOYMENT_AGENT_HUMAN_TUTORIAL.md).

This guide takes you from a prepared backend image to a working phone demo in
us-west-2 (Oregon), account 175220118767. Maximize Free Tier/credits and confirm
a paid spending limit before launch; $40/month was the earlier proposed cap.
Rust and Python run together
in one backend container. CloudFront provides HTTPS and reaches Axum directly.

```text
Phone -> HTTPS -> CloudFront -> private HTTP -> Axum -> Python model
                            |
                            +-> Supabase, Apple Music, OpenAI
```

Use [the plan](DEPLOYMENT_PLAN.md) for the decisions behind this setup. The long
Docker, Python, and Compose examples live in [the technical reference](DEPLOYMENT_REFERENCE.md).
Keep it open while following this guide.

**Status:** the single-instance deployment is running with verified HTTPS and
single-user phone flows. See [deploy/README.md](deploy/README.md) for current
evidence and [the plan](DEPLOYMENT_PLAN.md) for unimplemented reliability work.
Do not recreate existing resources when resuming the instance.

## Before you begin

You need AWS access, the CloudFront-provided hostname, access to the current Supabase
project, the service credentials, and a physical phone that can use Apple Music.
Use MFA on your AWS account. Allow a rehearsal day before the booth.

There are two kinds of work:

- **Developer preparation:** package the app and publish a Linux ARM64 image. This
  requires Docker Buildx, Rust, uv, Git, and AWS CLI on the laptop or an existing CI
  builder. Authenticate AWS CLI with your normal SSO/profile and verify the
  account using `aws sts get-caller-identity`. Follow step 1 before provisioning EC2.
- **Operator deployment:** create the AWS resources, start the prepared image, and
  test the phone. Steps 2 onward cover this work.

Commands labeled **Laptop** run on your computer. Commands labeled **EC2** run in
AWS Session Manager. Replace uppercase placeholders with your own values. Never
put credentials into Git, chat, or command-line arguments.

## 1. Prepare a release you can deploy

The purpose of this step is to make the server self-contained. It must not depend
on your laptop's Python installation or files.

Have the developer follow these reference sections in order:

1. [Build preparation](DEPLOYMENT_REFERENCE.md#build-preparation): keep Rust's
   current Python startup, lock CPU-only PyTorch dependencies, and pin the model.
2. [Combined Dockerfile](DEPLOYMENT_REFERENCE.md#combined-dockerfile): create one
   image containing both runtimes. The build and runtime paths must match.
3. [Publish the image](DEPLOYMENT_REFERENCE.md#publish-the-backend-image): create
   the cadenza-backend ECR repository in Oregon, build for Linux ARM64, and push.

Before proceeding, collect this nonsecret release information:

| Item | What to record |
| --- | --- |
| Backend image | Full ECR image reference with its sha256 digest |
| Source version | Git commit used for the build |
| Model version | Full Hugging Face model commit SHA |
| Hostname | Your public API hostname |
| AWS account | Your 12-digit account ID |

A digest identifies the exact image you intend to run. Keep the previous working
release's digests and configuration too. Do not continue with placeholders or a
failed build. The runtime templates in the reference are examples until you save
and verify them.

## 2. Check the budget and protect the demo data

Select Oregon in the AWS console. Review existing account spending before adding
this server. The plan's earlier estimates are about $17/month for t4g.small or
$29/month for t4g.medium, including one IPv4 address and a 16 GiB disk. Verify current
Oregon rates in the launch console. Tax, registry storage, snapshots, and transfer
come out of the remaining budget. Supabase and OpenAI fees are separate.

If the operator chooses the proposed $40 cap, create a $40 monthly cost budget
in Billing -> Budgets. Add email alerts at $20,
$30, and $35 actual spend, plus a forecast alert at $40. Alerts do not stop spending.

Use the existing Supabase project that the phone and backend already use:

- Back up its data and record a usable restore procedure. Verify a disposable restore.
- Confirm the deployed schema includes the features you will demonstrate, including
  saved queries and notifications. The repo's sql/ directory is not a complete
  database installer. Apply only identified missing, reviewed changes.
- Verify account ownership rules and Supabase's public Data API permissions. Resolve
  actual exposure before public access; changing RLS blindly can break the phone.
- Prepare demo accounts, songs, tags, queries, and posts. Confirm token expiry and
  that your Hugging Face account can access the gated model.

Changing Supabase projects is additional development work: auth.rs currently
hardcodes the project. For this demo, keep the existing project.

## 3. Store credentials and create the instance role

SSM Parameter Store holds the secrets so they do not need to be baked into images.
In Oregon, create these Standard-tier SecureString parameters using the default
AWS-managed SSM encryption key:

| Parameter | JSON object keys, all with string values |
| --- | --- |
| /cadenza/demo/api | DATABASE_URL, OPENAI_API_KEY, APPLE_MUSIC_DEVELOPER_TOKEN |
| /cadenza/demo/ml | HF_TOKEN |

Enter the JSON in the AWS console. DATABASE_URL must use the existing Supabase
session pooler on port 5432, with a URL-encoded password. If a JSON object exceeds
the Standard parameter size limit, split it into smaller parameters and update
the retrieval script and IAM permissions together.

In IAM -> Roles, create cadenza-demo-ec2 with EC2 as its trusted service. Attach
AmazonSSMManagedInstanceCore, then add these permissions:

| Action | Resource |
| --- | --- |
| ssm:GetParameter | The two parameter ARNs below |
| ecr:GetAuthorizationToken | * |
| ecr:BatchCheckLayerAvailability, ecr:GetDownloadUrlForLayer, ecr:BatchGetImage | Only the cadenza-backend repository ARN |

```text
arn:aws:ssm:us-west-2:175220118767:parameter/cadenza/demo/api
arn:aws:ssm:us-west-2:175220118767:parameter/cadenza/demo/ml
arn:aws:ecr:us-west-2:175220118767:repository/cadenza-backend
```

Your human AWS identity also needs permission to open Session Manager sessions.
The instance role gives the machine access; it does not grant access to you.
Customer-managed encryption keys require separately scoped KMS permissions.

## 4. Launch one EC2 instance

In EC2 -> Launch instance, choose:

| Setting | Value |
| --- | --- |
| Name | cadenza-demo |
| Region | us-west-2 |
| AMI | Official Canonical Ubuntu Server 24.04 LTS, ARM64 |
| Instance | On-Demand t4g.small to test 2 GiB; t4g.medium if needed |
| Root disk | Encrypted 16 GiB gp3, default performance, delete on termination |
| Instance role | cadenza-demo-ec2 |
| CPU credit mode | Standard, explicitly selected |
| Instance metadata | IMDSv2 required, hop limit 1, metadata IPv6 disabled |
| SSH key | None; this guide uses Session Manager |

Use a public subnet with DNS enabled and an internet-gateway route for 0.0.0.0/0.
A default VPC public subnet is adequate if available. Enable a public IPv4 address
for outbound internet access. The private CloudFront origin reaches host port 80,
which Docker maps directly to Axum port 3000. Permit inbound TCP 80 only from the
CloudFront service-managed security group, using `deploy/network-ingress.json`
after that managed group exists. No public CIDR, SSH, or IPv6 inbound rule is
needed. The CloudFront viewer function restricts testing to home public IPv4
24.11.70.86. Keep outbound connectivity for
AWS HTTPS, DNS, time sync, and Supabase TCP 5432; default outbound rules suffice.

Do not create a NAT gateway, load balancer, paid VPC endpoints, or RDS for this demo.
If the AMI requires a larger disk, use its minimum and adjust your estimate.
Standard credit mode avoids surplus-credit charges but can throttle sustained CPU
work, so the rehearsal must include inference performance.

Wait for EC2 status checks, then open Connect -> Session Manager. If it does not
connect, check the instance role, public address, subnet route, outbound HTTPS,
and SSM agent. Follow [AWS's Ubuntu agent instructions](https://docs.aws.amazon.com/systems-manager/latest/userguide/agent-install-ubuntu-64-snap.html)
if your selected AMI needs agent installation through launch user data. Do not put
secrets in user data.

**Checkpoint:** you can open a shell, and `uname -m` returns `aarch64`.

## 5. Configure the stable CloudFront HTTPS address

Use the current applied configuration in `deploy/cloudfront-vpc-origin.json` and
`deploy/cloudfront-distribution.json`. The VPC origin targets the EC2 instance's
private DNS name and host HTTP port 80. Attach the home-only viewer-request
function at creation, disable API caching, and preserve forwarding of auth,
cookies, query strings, and all API methods. Wait for Deployed before verification.

CloudFront supplies the HTTPS certificate and hostname. No Elastic IP or owned
DNS record is required. The deployed hostname is d1wj9jjqzhjpqq.cloudfront.net.
The EC2 public IPv4 is retained for outbound internet connections, not API ingress.
Do not create duplicate resources when resuming this existing deployment.

## 6. Install the host tools

**EC2:** install Docker Engine and the Compose plugin using the official
[Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Use ARM64
packages and Compose 2.30 or newer; the reference uses its raw env-file format.
Then run:

```sh
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
sudo apt-get update
sudo apt-get install -y unzip python3 curl
```

Install AWS CLI v2 with the official Linux aarch64 installer and signature check
from [AWS's instructions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
Run `aws sts get-caller-identity --region us-west-2`. It should identify the instance
role. Do not install personal access keys on the server.

Enter a root shell and create the deployment directory:

```sh
sudo -i
umask 077
install -d -m 700 /opt/cadenza /opt/cadenza/secrets
cd /opt/cadenza
```

**From here onward, EC2 commands assume this root shell and directory.** Repeat
`sudo -i` and `cd /opt/cadenza` after reconnecting. Container applications do not
need host AWS credentials or access to Docker's socket.

## 7. Save the configuration and fetch secrets

In /opt/cadenza, save the files from the reference:

- [Secret retrieval script](DEPLOYMENT_REFERENCE.md#secret-retrieval-script): fetch-secrets.py.
- [Runtime files](DEPLOYMENT_REFERENCE.md#runtime-files): compose.yaml,
  and release.env with your actual digests, hostname, and model revision.

You can use a terminal editor through Session Manager to paste these nonsecret
files. Keep a copy of the completed configuration on your laptop for recovery.
Do not include secrets/ in that release archive.

**EC2:**

```sh
python3 fetch-secrets.py
ls -l secrets
docker compose --env-file release.env config --quiet
```

The script should finish without output and produce root-only env files. Do not
print their contents. A configuration error usually means a placeholder, missing
file, or old Compose version. Fix it before starting containers.

## 8. Download the image and prepare the model

**EC2:** authenticate to ECR in account 175220118767, then pull the images:

```sh
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 175220118767.dkr.ecr.us-west-2.amazonaws.com
docker compose --env-file release.env pull
```

Check CPU-only Torch and download the model into its persistent cache:

```sh
docker compose --env-file release.env run --rm --no-deps backend python -c 'import torch; assert torch.version.cuda is None; print("CPU-only Torch verified")'
docker compose --env-file release.env run --rm --no-deps -e HF_HUB_OFFLINE=0 backend python -c 'import os; from sentence_transformers import SentenceTransformer; SentenceTransformer("google/embeddinggemma-300m", revision=os.environ["MODEL_REVISION"], token=os.environ["HF_TOKEN"], device="cpu"); print("Model cached")'
```

These commands temporarily run Python instead of the normal backend command. They
do not start Rust or connect to Supabase. The second command loads the model once
and then exits. Runtime will use this cache with downloads disabled.

If the process is killed for insufficient memory, resize using step 11 and retry.
If access is denied, check model license/token access or cache-directory ownership.
Do not continue until the preparation succeeds.

## 9. Start the backend, then HTTPS

**First stop every other backend using this Supabase project, including your laptop.**
Current startup cleanup resets shared work claims. Two backends can interfere with
each other's work. Closing Metro does not stop a separate Rust backend process.
Startup also deletes notifications older than 30 days.

**EC2:**

```sh
docker compose --env-file release.env up -d backend
docker compose --env-file release.env ps
docker compose --env-file release.env logs --tail=60 backend
```

Wait for healthy status. Rust and `[ml-service]` output should appear in the same
log. A missing .venv error means the build/runtime paths do not match the recipe.
Do not keep restarting an unexplained failure; inspect the first useful error.

Run the reference's [embedding check](DEPLOYMENT_REFERENCE.md#check-an-embedding).
Once it succeeds, verify the direct host mapping with `curl --fail http://127.0.0.1/test`.

**Laptop:** `curl --fail --show-error https://YOUR_HOSTNAME/test` should return
`server is reachable` without disabling TLS verification. If the certificate fails,
check CloudFront deployment status, the home viewer allowlist, VPC origin settings,
the source security-group rule, Docker port 80 mapping, and backend health.

**Checkpoint:** HTTPS works and a real embedding request succeeds. `/test` only
checks HTTP reachability; the next step verifies the database and app behavior.

## 10. Test the installed phone app

Set EXPO_PUBLIC_BACKEND_API_URL=https://YOUR_HOSTNAME in the client build environment.
Create and install your established signed Release/TestFlight or equivalent build.
This app uses native modules: it needs the native build workflow, not Expo Go.
An already installed bundle does not pick up a changed laptop .env file.

Stop Metro and cold-launch the phone app over cellular. Then test:

During the home-only phase, use home Wi-Fi instead of cellular. Repeat over
cellular only after the operator authorizes broader inbound access.

- Login and a known saved query or other database-backed read.
- Add a tag, run a query, record listening activity, and view analytics.
- Create a post, load the feed, and like/unlike it.
- Retry a listening event and confirm it is not double-counted.
- Use two accounts to check private-data ownership. Verify missing, expired,
  malformed, and wrong-project tokens fail on protected endpoints.

Record failing routes, timestamps, and statuses so you can find them in logs.
Keep credentials out of the notes. Your phone build must work with the laptop off.

## 11. Choose the final instance size

Start with t4g.small. Use the [2 GiB acceptance rehearsal](deploy/README.md#accept-or-reject-the-2-gib-instance)
and host sampler for the pass/fail criteria and repeatable measurement commands.

Rehearse the real booth flow for 30 minutes, including cold startup, the longest
expected post, interest updates, and a small simultaneous-user burst.

**EC2:** inspect these in a second root session. `vmstat` and `docker stats` run
continuously; press Ctrl-C to return to the prompt before running the next command.

```sh
free -m
vmstat 2
docker stats
df -h /
docker system df
journalctl -k --since "1 hour ago" | grep -Ei 'oom|out of memory|killed process'
```

Keep roughly 20% host memory available at peak, with no OOM kills or sustained
swap and acceptable demo response times. Inspect EC2's CPUCreditBalance as well;
Standard mode can slow inference when credits are depleted. Low traffic does not
eliminate the model's baseline memory use.

If 2 GiB fails, stop the stack, then stop the instance in EC2. Change its type to
t4g.medium and start it. The CloudFront hostname remains stable. Reconnect, enter the root
shell, return to /opt/cadenza, and start backend as in step 9. Repeat the
test. If model preparation never finished, return to step 8 first.

Keep at least 25% disk free with current and rollback images present. Remove only
identified obsolete images, or expand the EBS volume and filesystem. Do not prune
volumes: they hold model files.

## 12. Practice recovery before the event

A running container is not proof that Python is healthy. Rehearse the reference's
[model-crash test](DEPLOYMENT_REFERENCE.md#rehearse-a-model-crash). Expect unhealthy
status, then recover with:

```sh
docker compose --env-file release.env restart backend
```

This restarts Rust and Python together. Wait for healthy status and repeat the
embedding and phone checks. Docker does not restart a container merely because
its health check fails; operator recovery is deliberate for this staffed demo.

Reboot EC2 once and repeat the same checks. Confirm Docker and both processes
recover without the laptop. A deliberately stopped container needs an explicit
`up -d`; the restart policy preserves deliberate stops.

If Supabase reports EMAXCONNSESSION, stop restart loops and let stale sessions reap
while checking pool usage. Keep port 5432. The current server has no explicit request
drain/database-close wiring, so perform deployments while no demo work is active.
The Compose stop deadline does not add graceful shutdown to the application.

## 13. Keep a working release for rollback

Before replacing a working release, save its compose.yaml, release.env,
source commit, and image/model digests together on the laptop. On EC2 also run:

```sh
cp release.env previous-release.env
```

For a new release, update release.env, pull the images, and stop backend before
starting replacements. If a new model needs preparation, do that while the old
backend is stopped so two model copies do not compete for memory. Start backend,
verify it through CloudFront. Keep the same model revision for normal booth releases.

If the new release fails, stop it and restore the previous release's configuration:

```sh
docker compose --env-file release.env stop backend
cp previous-release.env release.env
```

Restore the previous Compose files too if they changed. Then start backend,
wait for health, run the embedding check, and verify public HTTPS. Verify the phone again.
Never run two releases against the database simultaneously. Rolling back an image
does not undo database changes; make schema changes backward-compatible and test
this procedure before the booth.

If EC2 itself needs replacing, repeat host setup from the saved configuration and
image digests, fetch the same secrets, and prepare the model cache. Stop the old
backend before starting the replacement. Update the CloudFront VPC origin to the replacement instance and
repeat HTTPS, model, and phone verification. Account for any brief host overlap in
your budget.

## 14. Run the booth

Freeze the release the day before. Check token expiry, disk space, billing, and
venue connectivity. Prepare a hotspot and a short recorded demo as fallbacks.

Thirty minutes before the event:

1. Start EC2 if needed. Explicitly start backend if you previously stopped them.
2. Check healthy status, HTTPS, and a real database read from the phone.
3. Warm the model with the embedding check and make one real post.
4. Check memory, disk, CPU credits, and recent errors.
5. Keep the operator session and rollback notes available. Leave the laptop backend off.

If something fails, inspect the relevant log and dependency before restarting.
Restart backend to recover either Rust or Python. Set a practical interruption
limit for switching to the recording while you investigate.

## 15. Remove resources when you are finished

Keep anything needed for grading first: data backup, source, release configuration,
and operator notes. Then terminate the demo instance and verify its root volume
was deleted. Disable/delete the CloudFront distribution, then its unused VPC
origin and viewer function. No Elastic IP or owned DNS record was created.

Remove unneeded ECR images, snapshots, unattached volumes, log groups, and paid DNS
zones created for the demo. Delete demo parameters/roles when no longer needed.
Stopping EC2 alone leaves disk and registry-storage charges. Recheck Billing after
charges settle and keep budget alerts until cleanup is confirmed.
