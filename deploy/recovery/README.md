# One-backend replacement

One internal ALB is CloudFront's stable private origin. Its instance target group
checks `/health/ready` every 10 seconds, timeout 5 seconds, three failures to mark
unhealthy and two successes to recover. Rust checks the loaded local Python model;
external-provider availability is excluded. ALB health checks alone do not replace
hosts: the ASG must use ELB health and maintain desired capacity one.

`provision.py` creates/updates the ALB, security groups, target group, pinned launch
template and bootstrap permissions. `resources.json` records their identifiers.
It does not attach a host or switch CloudFront; those are deliberate cutover steps.
No Lambda controller or periodic polling service is used. ALB spans two AZs;
the single application host stays in its existing AZ, On-Demand t4g.medium.

`bootstrap-start.sh` installs tested tool versions, retrieves the two SSM secrets,
pulls the pinned image, caches the pinned model, and waits until every other
`CadenzaBackend=demo` host has terminated. Then it starts/verifies Rust/model and
completes the ASG launch hook. The gate's evidence is written to a private host
log. Do not remove the tag or detach a still-running backend to bypass the gate.
Failed bootstrap does not complete the hook. With capacity one, failures and
stop-first replacement cause an outage; ALB can fail open to its last unhealthy
target until replacement. This is not a zero-downtime deployment.

For a new backend release, developers use `./scripts/deploy-backend.sh` from a
clean committed checkout. `--help` lists prerequisites; `CADENZA_AWS_PROFILE`
overrides the default cadenza-project profile. The initial helper builds/publishes
the container and performs the stop-first activation/template promotion. Automated
warm-AMI baking is planned and explicitly reported as not implemented yet.

For an already-published candidate, keep a known-working image/config pair.
From the repo root:

```sh
python3 deploy/recovery/update-release.py deploy/release.env.example
python3 deploy/recovery/provision.py
```

The first command temporarily changes ASG health to EC2, runs the host's
`activate-release.sh`, and restores ELB health in a `finally` block. It preserves
host-failure detection while allowing a planned app interruption. Candidate
images are pulled before stopping the old container; failed startup restores the
old env/image. Inspect the private activation log if rollback itself fails.
The second command publishes the same successful release into a new launch-
template version. Do not publish an unverified candidate into replacement config.
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

Cold-start follow-up: use a sanitized prewarmed AMI after the baseline recovery
rehearsals. See DEPLOYMENT_PLAN.md. Never bake live container environment secrets
or allow a cached container to auto-start before the exclusivity gate.
