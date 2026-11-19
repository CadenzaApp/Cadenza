#!/bin/bash
# Runs entirely on EC2. A systemd timer restores app health checks after a hard kill.
set -euo pipefail
cd /opt/cadenza
region=${1:?region}
group=${2:?group}
candidate=${3:?candidate}
exec 9>/run/cadenza-release.lock
flock -n 9
unit="cadenza-health-restore-$(date +%s)-$$"
aws_bin=$(command -v aws)
# Install the independent deadline BEFORE disabling application health checks.
systemd-run --quiet --unit="$unit" --on-active=12min --timer-property=AccuracySec=1s \
    --property=Restart=on-failure --property=RestartSec=15s \
    "$aws_bin" autoscaling update-auto-scaling-group --region "$region" \
    --auto-scaling-group-name "$group" --health-check-type ELB
# Replace stale deadlines only after our own deadline is armed, under the lock.
while read -r previous _; do
    if [ -n "$previous" ] && [ "$previous" != "$unit.timer" ]; then
        systemctl stop "$previous" "${previous%.timer}.service"
    fi
done < <(systemctl list-units --all --type=timer --no-legend --plain 'cadenza-health-restore-*.timer')
restore() {
    status=$?
    trap - EXIT
    if "$aws_bin" autoscaling update-auto-scaling-group --region "$region" \
        --auto-scaling-group-name "$group" --health-check-type ELB; then
        systemctl stop "$unit.timer" || true
    else
        echo 'Immediate health restoration failed; independent timer remains armed.' >&2
        status=1
    fi
    exit "$status"
}
trap restore EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
admitted=false
for attempt in $(seq 1 12); do
    if "$aws_bin" autoscaling update-auto-scaling-group --region "$region" \
        --auto-scaling-group-name "$group" --health-check-type EC2; then
        admitted=true
        break
    fi
    sleep 5
done
[ "$admitted" = true ]
bash activate-release.sh "$candidate"
# Give ALB two 5-second health probes before native replacement resumes.
sleep 15
