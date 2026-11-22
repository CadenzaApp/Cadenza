# Single-instance recovery tools

Normal developers should use the [quick start](../GETTING_STARTED.md). These are
maintenance tools for the existing AWS account, not instructions to recreate it.

The internal ALB checks Rust and Python/model readiness every five seconds.
The ASG uses ELB health and desired capacity one. It replaces unhealthy instances
and sends launch/termination/failure email through SNS. Its launch hook completes
only after fresh-host readiness and real inference pass. Bootstrap waits for the
old backend to terminate before starting Rust. There is no second serving host,
custom controller, warm pool or AMI bake.

## Maintenance commands

Use `python3` on macOS or `py -3` on Windows, from the repository root:

| Command | Purpose |
| --- | --- |
| `deploy/recovery/update-release.py PATH` | Activate an already-published candidate with rollback and temporary EC2-only health |
| `deploy/recovery/provision.py` | Publish current verified image/model/bootstrap into the launch template |
| `deploy/recovery/watch-api.py` | Read-only per-second external readiness probes; Ctrl-C stops |
| `deploy/recovery/verify-replacement.py --help` | Inspect runtime/recovery state through SSM |
| `deploy/recovery/rehearse-recovery.py --help` | Deliberately crash Python and time native replacement |

The deploy command invokes the first two automatically. Do not publish a candidate
until activation succeeds. If a process is forcibly killed during maintenance,
verify the host and restore ASG `HealthCheckType=ELB`.

The rehearsal causes a real outage. Run it only when a staffed outage is intended;
it is not a routine deployment check. It records one-second external probes,
ALB/ASG transitions and server startup stages. Windows support for optional
maintenance tools is best effort; deployment and Grafana are the primary tested
workstation paths. Scripts executed on EC2 remain Linux-only.

Replacement starts from the pinned OS image, installs tools and downloads the
container/model. Cold-start time has not been remeasured since AMI baking was
retired. Historical baked-AMI timings are not current recovery guarantees.

`resources.json` is the live inventory. `verification.release.json` is the latest
consolidated release check. Optional probes and security scripts generate ignored
reports; commit one deliberately only when it provides useful lasting evidence.
No secret values should enter a report. Supabase data and SSM parameters survive
EC2 replacement; the instance's local model cache and metrics history do not.
