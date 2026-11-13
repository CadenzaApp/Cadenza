#!/bin/bash
# Run as root on EC2 during a staffed rehearsal. Does not read user data.
set -euo pipefail
umask 077
cd /opt/cadenza
exec 3>&1
exec > logs/recovery-rehearsal.log 2>&1
restore_needed=false
monitor_pid=""
cleanup() {
    if [ "$restore_needed" = true ]; then
        docker compose --env-file release.env restart backend || true
    fi
    if [ -n "$monitor_pid" ]; then
        kill "$monitor_pid" 2>/dev/null || true
        wait "$monitor_pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'echo "Recovery rehearsal failed; private diagnostic log retained on EC2." >&3' ERR
backend_id=$(docker compose --env-file release.env ps -q backend)
test "$(docker inspect --format '{{.State.Health.Status}}' "$backend_id")" = healthy
python3 sample-resources.py --duration 1200 --interval 2 > logs/recovery-resources.jsonl 2> logs/recovery-sampler.err &
monitor_pid=$!
restore_needed=true
docker compose --env-file release.env exec -T backend python - < rehearse-model-crash.py >&3
unhealthy=false
for attempt in $(seq 1 40); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$backend_id")" = unhealthy ]; then
        unhealthy=true
        break
    fi
    sleep 5
done
test "$unhealthy" = true
echo "Combined health detected the stopped model child." >&3
docker compose --env-file release.env restart backend
ready=false
for attempt in $(seq 1 90); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$backend_id")" = healthy ]; then
        ready=true
        break
    fi
    sleep 5
done
test "$ready" = true
docker compose --env-file release.env exec -T backend python - < check-embedding.py >&3
curl --fail --silent --show-error --max-time 15 -w '\nHTTP %{http_code}\n' http://127.0.0.1/test >&3
restore_needed=false
echo "Backend restart restored model inference and direct HTTP." >&3
