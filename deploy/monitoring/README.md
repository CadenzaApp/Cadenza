# Private backend monitoring

Prometheus and Grafana run beside the backend. Normal releases start them after
API readiness; monitoring failure does not roll back a healthy API. The release
manifest records a separate monitoring verification result. AMI baking caches
the pinned images in `images.json`. Dashboard/scrape configuration travels inside
the immutable backend image and is extracted during host preparation. No manual
setup is needed after replacement. Monitoring containers are recreated when the
release image changes so file bind mounts pick up the new configuration, while
named data volumes are retained. Dashboard file polling runs every 15 seconds.

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

`prometheus.yml` scrapes `backend:9091/metrics` every 15 seconds. Provisioned
JSON files live in `dashboards/`. The dashboard menu links these views and carries
the selected time range across them:

- Backend overview: overall calls, p50/p95/p99, in-flight work, scrape health,
  latency trends, traffic bars, failed responses and one operation summary table.
- Social: feed, posts, interests, friends and notifications.
- Analytics: analytics reads and listening-event ingestion.
- Tagging: tag reads/writes and song tag application, plus server-wide provider
  attempts, budget usage, concurrency, refusals and configured limits.
- Library & Queries: query execution/saved queries, song metadata and play writes.
- Account: profile and settings.

Feature views show summary percentiles, stacked call-volume bars, failed-response
bars and per-operation percentile trends/tables. Each feature also repeats a
runtime-distribution histogram for every observed method/route, busiest first.
Use Histogram operations to narrow these charts. They cover the selected range
and convert cumulative Prometheus buckets into disjoint counts, including the
10+ second overflow. Extra boundaries at 20/35 ms and 400/600/800 ms concentrate
detail in the fast and subsecond ranges. Bucket widths vary;
bar heights are counts, not density. Longer internal buckets remain available
for tail percentiles but are combined in these distribution charts. Histogram
schema 2 starts fresh duration history at rollout so incompatible old buckets
are not mixed; existing call-count history remains available. Operation combines method and
route; compact Calls/runtime columns keep the tables readable. The route selector
and tables rank by calls over the selected range. Calls cards use neutral text,
not severity colors. Provider/limit panels are server-wide, regardless of route.

Counts and summary percentiles cover the selected range; latency trends use
rolling intervals. Volume bars use non-overlapping buckets with a minimum of one
minute and coarser buckets for longer ranges. Counts are estimates from scraped,
extrapolated counters, not audit totals or unique users. Health and `/test` are
excluded from operation panels. Buckets are aggregated across instances before
percentile calculation. Sparse traffic can produce empty/noisy estimates; timing
ends at response headers, not at the phone. Trace/span detail remains future work.

The Grafana data source is `cadenza-prometheus`, at `http://prometheus:9090`.
`datasources.yml` and `dashboards.yml` provision it and the dashboards. Each JSON is
also importable elsewhere by selecting a Prometheus data source. No per-user,
IP, query-string, credential or body labels are emitted. Counters and quotas
reset on app restart. Python queue-depth metrics and OTel spans remain follow-ups.

Deployed checks are recorded in `../recovery/verification.metrics.json`. This
includes live histogram queries, anonymous admin denial, port isolation, secret
file metadata and resource headroom. No secret values are recorded.
