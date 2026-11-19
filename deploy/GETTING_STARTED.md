# Deploying Cadenza and viewing Grafana

The backend is already running. You do not need to create AWS resources, buy a
domain, copy production secrets, or build an AMI. Coordinate deployments: one
developer should deploy at a time. A deployment briefly interrupts this single
backend; automatic recovery also has downtime.

## One-time setup

1. Ask the project owner for AWS access to **Cadenza Backend**, account
   **175220118767**. Use your own AWS login, not another developer's credentials.
2. Install Git, Python **3.11+**, Docker Desktop, the current AWS CLI v2 with
   `aws login`, and the AWS Session Manager plugin. Put them on PATH and open a
   new terminal after installation. On Windows, use Docker Desktop's Linux
   containers/WSL 2 backend. ARM64 builds can run through Docker's emulation.
3. Clone the repo and check out the branch you intend to deploy. Use a clean,
   committed checkout. Start Docker Desktop before deploying.

Installers: [Python](https://www.python.org/downloads/),
[Docker Desktop](https://docs.docker.com/desktop/),
[AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html),
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html).

## Sign in to AWS

Run this in Terminal or PowerShell. Select Cadenza Backend in the browser:

```text
aws login --profile cadenza-project --region us-east-2
aws sts get-caller-identity --profile cadenza-project --region us-west-1
```

The account must be `175220118767`. Login uses **us-east-2**; the servers run in
**us-west-1**. These are intentionally different. Repeat login when it expires.
An account name change can take time to appear in an existing browser session.

## Deploy

From the repository root on macOS:

```sh
python3 deploy/release.py
```

From PowerShell on Windows:

```powershell
py -3 deploy/release.py
```

Both commands invoke the same cross-platform Python script.
The script builds the ARM64 container, pushes it, updates the current server,
checks readiness and inference, and updates automatic replacement settings.
It rolls back failed activation/promotion. There is no AMI baking or CI runner.
Keep the terminal open until it reports success; do not deploy concurrently.

After success, commit and push the generated changes to `deploy/release.env.example`,
`deploy/recovery/resources.json` and the new file under `deploy/releases/` so the
team shares the actual deployed release. These contain identifiers, not secrets.
The repository's standard Rust/Node formatting prerequisites apply when pushing.
Do not change production secrets locally or start a second backend against the
shared database while the deployed one is running.

## Open Grafana

macOS:

```sh
python3 scripts/open-metrics.py
```

Windows PowerShell:

```powershell
py -3 scripts/open-metrics.py
```

Your browser opens when the private AWS tunnel is ready. Leave the terminal
open; Ctrl-C closes the tunnel. Use `--port 3301` if the default port is busy,
or `--no-browser` to open the printed URL yourself. No additional Grafana password
is needed. The Dashboards menu opens the overview and focused feature dashboards.
History is local, up to 14 days, and is lost if the EC2 instance is replaced.

The public API is `https://d1wj9jjqzhjpqq.cloudfront.net`. A Metro build can use
that URL without a native rebuild. See the [runbook](README.md) for rollback,
secrets and recovery. Shell scripts under `deploy/` run on Linux EC2, not Windows.

The macOS commands have been exercised against AWS. Windows launch/cleanup and
large-request handling have unit coverage and a compatibility review; native
Windows end-to-end deployment still needs confirmation on a Windows workstation.

## Client and schema compatibility

The shared-playlist/live-session release needs a fresh native mobile build, including
MusicKit changes and the `cadenza://` invite-link scheme. Coordinate the client update
with the backend release. There is no minimum-client-version enforcement in the API.
Existing live-session timeouts apply during deployments and replacement outages.

Schema changes are still applied separately in Supabase. The current collaboration,
privacy and duration-tag schema is already applied. Do not replay the SQL folder as
an automatic deployment step. Rolling back the image cannot undo schema changes;
older backends may not understand duration tags created by this release.

## Deployment recovery and disk retention

Deployment maintenance runs on EC2. It arms a systemd timer before temporarily
using EC2-only health checks. Normal completion restores application checks; an
interrupted host command leaves the 12-minute restoration timer armed, with
retries if AWS is unavailable. The developer's terminal need not remain online
for this cleanup. Keep the terminal open to receive the full release result.

Rollback uses release settings read from the live host, not the developer's
branch. After successful promotion, cleanup retains the active image, the
previous release and images referenced by any container. Other backend images
on the instance are removed without forcing deletion. Cleanup failure is a
warning and does not roll back a healthy backend.
