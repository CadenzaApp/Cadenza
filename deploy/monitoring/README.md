# Private backend monitoring

Prometheus and Grafana run beside the backend. Normal releases start them after
API readiness; monitoring failure does not roll back a healthy API. The release
manifest records a separate monitoring verification result. AMI baking caches
the pinned images in `images.json`. Dashboard/scrape configuration travels inside
the immutable backend image and is extracted during host preparation. No manual
setup is needed after replacement.

## View the dashboard

From the repo, with the AWS CLI and Session Manager plugin installed:

```sh
aws login --profile cadenza-project --region us-east-2
./scripts/open-metrics.py
```

The script opens your default browser once Grafana responds. Leave the command
running; Ctrl-C closes the tunnel. Use `--no-browser` for manual opening. `--port 3301` selects another local port. AWS authenticates access; Grafana
allows read-only anonymous viewing inside the tunnel. Admin endpoints and editing
still require authentication. A random admin secret is generated privately on
each new host, not baked into its AMI. Dashboards are provisioned from Git.

Grafana binds only to host loopback port 3300. Prometheus has no published host
port. `/metrics` listens on backend port 9091 inside Docker; the public API port
3000 does not mount it. ALB/CloudFront and EC2 security groups stay unchanged.

## History and resource limits

Prometheus retains up to 14 days, or 2 GB of stored blocks, whichever is reached
first. WAL/head data needs additional space; the block cap is not a filesystem
quota. The current 16 GiB disk had 8.6 GiB free before installation, so it was not
enlarged. Prometheus has a 384 MiB memory cap. Grafana has a 768 MiB hard limit and
a 512 MiB Go memory target; its initial 384 MiB limit caused OOM restarts during
dashboard use. Each service has a 0.5 CPU limit.

Named volumes retain history/settings across container updates on the same EC2
host. Replacement or termination destroys this local history; that tradeoff is
intentional. Dashboard configuration is recreated automatically. There is no
external metrics store, managed-service subscription or database schema change.

## Metrics and dashboard

`prometheus.yml` scrapes `backend:9091/metrics` every 15 seconds. The 17-panel
`backend-dashboard.json` shows per-operation p50/p95/p99, traffic/statuses,
in-flight work, provider attempts/window usage, refusals and configured limits.
Health and `/test` are excluded from operation latency/traffic panels. Buckets are
aggregated across instances before percentile calculation. Sparse traffic can
produce empty/noisy estimates; timing ends at response headers, not at the phone.

The Grafana data source is `cadenza-prometheus`, at `http://prometheus:9090`.
`datasources.yml` and `dashboards.yml` provision it and the dashboard. The JSON is
also importable elsewhere by selecting a Prometheus data source. No per-user,
IP, query-string, credential or body labels are emitted. Counters and quotas
reset on app restart. Python queue-depth metrics and OTel spans remain follow-ups.

Deployed checks are recorded in `../recovery/verification.metrics.json`. This
includes live histogram queries, anonymous admin denial, port isolation, secret
file metadata and resource headroom. No secret values are recorded.
