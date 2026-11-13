#!/bin/bash
# Run as root on EC2. Logs remain private; stdout contains only deployment results.
set -euo pipefail
umask 077
cd /opt/cadenza
stage() { printf '{"stage":"%s","at_utc":"%s"}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)" >> logs/boot-stages.jsonl; }
if [ -f logs/start-release.log ]; then
    cp logs/start-release.log logs/start-release.previous.log
fi
exec 3>&1
exec > logs/start-release.log 2>&1
trap 'echo "Backend startup failed; private diagnostic log retained on EC2." >&3' ERR
if [ "${CADENZA_PREFETCH_MODEL:-0}" = 1 ]; then
    echo "Prefetching the pinned model on the 2 GiB host." >&3
    docker compose --env-file release.env run --rm --no-deps -e HF_HUB_OFFLINE=0 backend python -c 'import os; from sentence_transformers import SentenceTransformer; SentenceTransformer("google/embeddinggemma-300m", revision=os.environ["MODEL_REVISION"], token=os.environ["HF_TOKEN"], device="cpu"); print("Pinned model cached")'
fi
# Snapshot an already-running container before activation. A stopped/new container
# starts a new restart-policy observation period.
previous_id=$(docker compose --env-file release.env ps --all -q backend)
baseline_restarts=0
if [ -n "$previous_id" ] && [ "$(docker inspect --format '{{.State.Status}}' "$previous_id")" = running ]; then
    baseline_restarts=$(docker inspect --format '{{.RestartCount}}' "$previous_id")
fi
echo "Starting Rust and its Python child." >&3
stage docker_up_started
docker compose --env-file release.env up -d backend
stage docker_up_finished
backend_id=$(docker compose --env-file release.env ps -q backend)
if [ "$backend_id" != "$previous_id" ]; then
    baseline_restarts=0
fi
observer_pid=
if [ -f observe-startup.py ]; then
    docker exec -i "$backend_id" python - < observe-startup.py >> logs/boot-stages.jsonl 2> logs/startup-observer.log &
    observer_pid=$!
fi
ready=false
for attempt in $(seq 1 90); do
    restarts=$(docker inspect --format '{{.RestartCount}}' "$backend_id")
    state=$(docker inspect --format '{{.State.Status}}' "$backend_id")
    health=$(docker inspect --format '{{.State.Health.Status}}' "$backend_id")
    if [ "$restarts" -gt "$baseline_restarts" ] || [ "$state" != running ]; then
        docker compose --env-file release.env stop backend
        echo "Backend exited or restarted during startup; stopped to preserve evidence." >&3
        exit 1
    fi
    if [ "$health" = healthy ]; then
        ready=true
        break
    fi
    if [ "$health" = unhealthy ]; then
        docker compose --env-file release.env stop backend
        echo "Combined backend health failed; stopped to preserve evidence." >&3
        exit 1
    fi
    sleep 5
done
if [ "$ready" != true ]; then
    docker compose --env-file release.env stop backend
    echo "Backend readiness timed out; stopped to preserve evidence." >&3
    exit 1
fi
stage docker_health_ready
if [ -n "$observer_pid" ]; then
    wait "$observer_pid" || echo 'Startup observer failed; readiness and inference checks remain authoritative.' >&3
fi
stage inference_check_started
echo "Combined Rust/model health is healthy. Checking real inference." >&3
docker compose --env-file release.env exec -T backend python - --timeout "${CADENZA_BOOTSTRAP_INFERENCE_TIMEOUT:-60}" < check-embedding.py >&3
stage inference_check_finished
echo "Testing direct Axum HTTP through the host port mapping." >&3
curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-all-errors --max-time 15 -w '\nHTTP %{http_code}\n' http://127.0.0.1/test >&3
stage http_test_passed
echo "Backend is ready; external CloudFront HTTPS verification is next." >&3
