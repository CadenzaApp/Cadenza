# Deploy Cadenza with an agent and a human operator

> Current architecture: one t4g.medium (4 GiB) behind an internal ALB, with a
> capacity-one ASG for native replacement and no overlapping application rollout.
> Use DEPLOYMENT_PLAN.md and deploy/README.md for current decisions and operations;
> older sizing, manual-host procedures, and human-only workflows below are historical.

Use this version when an agent can edit and test the local repository but has no
AWS CLI access. The human operates AWS and the EC2 server. Rust and Python stay
together in one backend container. CloudFront terminates HTTPS and reaches Axum
directly through a private VPC origin.

This describes the agent/operator workflow. The deployed state is recorded in
[deploy/README.md](deploy/README.md); the steps remain a setup reference.
The [plan](DEPLOYMENT_PLAN.md) describes the architecture. The
[original tutorial](DEPLOYMENT_TUTORIAL.md) explains the operational steps, and the
[reference](DEPLOYMENT_REFERENCE.md) contains the proposed configuration examples.

## Current operator authorization

The operator overrode the default human-only AWS boundary for this deployment
using existing local CLI sessions. The reviewed SCP exception, ECR publication,
EC2 role/profile and instance creation, host setup, and secret retrieval on EC2
were authorized and completed. Secrets were not returned to chat.

Current workload account is 175220118767, with deployment in us-west-2. The running
instance is i-08d25ed9caea17d6c, using ARM64 t4g.small and encrypted 16 GiB gp3.
The operator chose https://d1wj9jjqzhjpqq.cloudfront.net and subsequently requested
complete proxy removal. CloudFront now reaches Axum directly through host port 80
mapped to container port 3000. Public EC2 web ingress is closed; the viewer function
allows only home IPv4 24.11.70.86. Its public IPv4 remains for outbound access.

The operator confirmed single-device phone flows and persistence passed. The
roughly 15-minute resource capture predated proxy removal. No new RAM measurement
was requested for this update. Multi-device and depleted-credit checks remain
outstanding. See deploy/README.md for the current state and
`deploy/PUBLIC_ACCESS_REVIEW.md` for potential work before broader public access.

## Who does what

| Agent completes locally | Human completes |
| --- | --- |
| Application changes, dependency locks, Dockerfile, Compose, scripts, documentation | AWS account, billing, IAM, EC2, ECR, SSM, and DNS operations |
| Local builds and checks that need no cloud credentials | AWS CLI commands on the human's laptop and inside EC2 |
| Release templates and exact commands for review | Publishing images, retrieving secrets, deployment, and rollback |
| Diagnosis from sanitized logs supplied by the human | Checks on the real EC2 instance and physical phone |

The agent must not receive AWS credentials or an authenticated AWS terminal,
including through browser automation. It may write AWS commands for the human to
run. Keep service credentials out of chat and version control. Do not run local
database tests against the live demo project.

## 1. Human: provide the deployment inputs

Current nonsecret inputs agreed with the operator:

- Region: us-west-2. Account ID: 175220118767.
  Operator enabled advanced features and confirmed Oregon is now selected.
- Budget: maximize Free Tier and available credits. Confirm a paid spending limit
  before provisioning; the earlier $40/month estimate is not an approved budget.
  Available credits reported: $120. Expiry lookup is deferred at the operator's
  request and does not block preparation.
- Use one ARM64 t4g.medium (4 GiB); the team selected extra headroom.
- Disk candidate: encrypted 16 GiB gp3, subject to measurement and AMI minimum.
- Public API hostname: d1wj9jjqzhjpqq.cloudfront.net, supplied by CloudFront.
- Model revision: 57c266a740f537b4dc058e1b0cda161fd15afa75, the local cached snapshot.
- Published demo-003 source base: 9f25043df0b43e4a65f069c1900b64b0558cd405 plus
  the readiness/shutdown working-tree inputs hashed in deploy/build-record.json.
  Commit the source before the next frozen release.
- No demo date needed. Deploy early for testing and iteration.

The deployed client uses the HTTPS URL for this CloudFront hostname.
The human keeps DATABASE_URL, OPENAI_API_KEY, APPLE_MUSIC_DEVELOPER_TOKEN, HF_TOKEN,
and AWS authentication private. Accept the gated model's terms using your own
Hugging Face account.

**Handoff:** the agent has enough information to prepare the repository. No AWS
resources need to exist yet.

## 2. Agent: turn the reference examples into real local files

Use the reference's build preparation and combined Dockerfile sections. Make the
changes in the repository, preserving unrelated work:

1. Keep Rust's existing Python child startup. Do not introduce an external-model
   mode or a separate model container.
2. Configure CPU-only Torch dependencies and regenerate the Python lockfile. Pin
   the embedding model revision through the documented MODEL_REVISION setting.
3. Create deploy/backend.Dockerfile and appropriate .dockerignore exclusions.
   Build Rust at /app/backend-api; place the runtime Python environment at
   /app/backend-api/ml-service/.venv so the existing Rust launcher can find it.
4. Create deploy/compose.yaml from the applied runtime configuration. Map host
   port 80 directly to backend port 3000 and allow only the CloudFront managed
   security group. Both API and model checks contribute to backend health.
5. Create deploy/release.env.example with nonsecret placeholders and
   deploy/fetch-secrets.py. The retrieval script runs later on EC2 under the human's
   control; the agent does not run it locally against AWS.
6. Save repeatable embedding and model-crash checks as clearly named diagnostic
   scripts, or retain exact commands in the runbook. Label the crash check as a
   deliberate rehearsal action.
7. Update the backend/model READMEs to match the actual final configuration.

Do not quietly expand this into a multi-instance deployment or an application
rewrite. The later readiness/shutdown step now provides local Rust/model readiness
and a 120-second drain with a 150-second Docker stop allowance. See
deploy/lifecycle-verification.json for the deployed demo-003 checks. Automatic
child recovery remains separate; Python failure still needs a whole-backend restart.

**Handoff:** real deployment files exist in the repository, with placeholders only
for values the human must supply. Reference examples alone do not complete this step.

## 3. Agent: check and build locally

Run appropriate Rust formatting/compilation checks, validate the Python lockfile,
check script syntax, and validate Compose with dummy nonsecret env files. Use
Compose 2.30+ to validate raw env-file syntax. Do not claim full validation using
an older Compose version that cannot parse it.

Build the combined image for linux/arm64 locally using Docker Buildx. Use a local
tag such as cadenza-backend:demo-001 and `--load`, not `--push`. Record the source
commit, resolved base-image digests, and model revision. Check the image's CPU-only
Torch installation without starting the normal API command.

The image build should not need the model token: weights are downloaded later on
EC2. If Docker, required package downloads, or ARM build support are unavailable,
report exactly which checks could not run and give the human the commands. Do not
describe an unbuilt image as ready.

**Handoff:** give the human a release summary containing:

- Files changed and the local image tag.
- Checks passed, failures, and anything still untested.
- A command to verify the local image architecture.
- The proposed ECR tag/push commands, with account/region placeholders filled where
  known. The human will authenticate and run them.
- The expected configuration directory and startup commands for EC2.

## 4. Human: create the cloud resources and publish the image

Follow original tutorial steps 2-6 using your own console and terminal:

1. Verify current Oregon prices, existing spending, budget alerts, database backup,
   schema, demo data, and access rules.
2. Create the cadenza-backend private ECR repository with immutable tags.
3. Create the two SSM SecureString parameters and the EC2 instance role with the
   scoped permissions described in the original tutorial.
4. Launch the Ubuntu ARM64 instance with Standard CPU credits, the public subnet,
   security group, and storage settings from the tutorial.
5. Configure the private CloudFront VPC origin and home-only viewer function.
   Use its supplied HTTPS hostname; no Elastic IP or owned DNS zone is needed.
6. Connect using Session Manager and install Docker/Compose and AWS CLI v2.

On your laptop, authenticate to AWS and confirm the correct account. If the agent
already built the local image, publish it without rebuilding:

```sh
export CADENZA_REGISTRY=175220118767.dkr.ecr.us-west-2.amazonaws.com
aws sts get-caller-identity
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin "$CADENZA_REGISTRY"
docker tag cadenza-backend:demo-001 "$CADENZA_REGISTRY/cadenza-backend:demo-001"
docker push "$CADENZA_REGISTRY/cadenza-backend:demo-001"
```

Use the agent's actual local/release tag. Copy the published
image digest from ECR. If there is no local image, run the supplied build command
first. AWS authentication and push remain human actions.

**Handoff:** send the agent only the nonsecret image digest, final hostname, and
any sanitized build errors. Never send AWS credentials or decrypted SSM values.

## 5. Agent: finalize the release bundle

Fill in a nonsecret release.env using the published backend digest and model
revision. Keep the public hostname in the client setting and CloudFront record. Check all placeholders are resolved. Prepare
a release directory or archive containing:

```text
compose.yaml
release.env
fetch-secrets.py
diagnostic scripts, if created
release notes with source commit and verification results
```

Exclude secrets, local env files containing credentials, AWS profiles, and build
caches. Include a short ordered command list for installing this bundle into
/opt/cadenza. The agent prepares the bundle locally; the human transfers it.

**Handoff:** the human has a specific release to deploy and an exact sequence of
commands. The agent's task is not to log into EC2 and execute them.

## 6. Human: install and start the release

Follow original tutorial steps 7-9:

1. Through Session Manager, enter the root shell and create /opt/cadenza and its
   restricted secrets directory. Paste the nonsecret files using a terminal editor
   or your established secure transfer method.
2. Run fetch-secrets.py on EC2. Verify file permissions without printing contents.
3. Validate Compose, authenticate to ECR, and pull the recorded images.
4. Run the CPU-only check and one-off model prefetch. These commands do not launch
   Rust. If memory is insufficient, follow the resize procedure before continuing.
5. Stop every other backend sharing this Supabase project, including the laptop.
6. Start backend, wait for healthy status, and run a real embedding check.
7. Verify CloudFront HTTPS reaches the private Axum listener with normal
   certificate validation.

Both Rust and Python should appear in the backend logs. A successful /test response
does not prove the database or model works. Do not repeatedly restart an unexplained
failure; collect the relevant error and use the troubleshooting handoff below.

## 7. Agent and human: verify the phone and choose the instance size

**Agent:** set up the local client build configuration for the final API URL and
prepare the build commands. Help resolve local compilation/configuration problems.
Keep server secrets out of EXPO_PUBLIC_* variables.

**Human:** perform any signing/account authentication and install the native demo
build on the phone. Follow original tutorial steps 10-11: cold-launch with Metro
stopped, test real database writes/reads and model-backed flows, then rehearse for
30 minutes while observing host memory, disk, CPU credits, and errors.

**Human:** decide from those measurements whether 2 GiB passes or to stop/resize
EC2 to 4 GiB. The agent may interpret sanitized measurements, but the human makes
the AWS change. Re-test after resizing. Keep approximately 20% memory headroom and
25% disk free with current and rollback images present.

Use the concrete [2 GiB acceptance rehearsal](deploy/README.md#accept-or-reject-the-2-gib-instance)
and `deploy/sample-resources.py` to record startup and steady-use measurements.
This is required before declaring t4g.small sufficient.

**Handoff:** record the tested release, instance size, demonstrated flows, and any
remaining failures. Local code checks do not replace these live tests.

## 8. Human: rehearse recovery and run the booth

Follow original tutorial steps 12-14. Deliberately stop the Python child during
rehearsal and verify the failure becomes visible. Restart the whole backend, then
verify inference and a real phone flow. Reboot EC2 and test again.

Practice rollback before the event. Preserve the previous release's configuration
and image/model digests. Stop the failed backend before starting its replacement;
do not run two versions against the same database. Image rollback does not undo
database changes.

Freeze the release before the booth. Start early, check the phone over the venue
network, warm the model, and keep the restart/rollback instructions nearby.

## If anything fails: the troubleshooting handoff

1. **Human:** report the failed step, command, status, and relevant log excerpt.
   Remove tokens, passwords, connection strings, and personal data first.
2. **Agent:** diagnose the supplied evidence. Make local fixes and run applicable
   checks, or provide a specific read-only diagnostic for the human to execute.
3. **Human:** run any AWS/EC2 diagnostic and return sanitized results. If needed,
   publish a new immutable image tag and provide its digest.
4. **Agent:** update the release bundle and explain the change and rollback path.
5. **Human:** deploy during a quiet window and repeat the affected checks.

Do not grant AWS CLI access just to complete this loop. A human-operated command
with a clear expected result is the intended handoff.

## 9. Human: remove the cloud resources

Follow original tutorial step 15 after retaining grading artifacts. Terminate the
instance, verify root-volume deletion, remove the CloudFront distribution and unused origin/function, and remove unneeded
images, snapshots, DNS resources, and parameters. Recheck Billing after charges
settle. Stopping EC2 alone does not eliminate disk or allocated-IP charges.

The agent may prepare the cleanup checklist and archive local source/release
files. The human verifies resource identities and performs all cloud cleanup.
