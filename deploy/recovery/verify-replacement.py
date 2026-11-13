"""Observe an already-triggered failure rehearsal; never triggers a failure itself."""

import argparse
import datetime
import json
import subprocess
import time

from provision import aws, ROOT, GROUP


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--old-instance", required=True)
    parser.add_argument(
        "--kind", choices=["model_failure", "host_failure"], required=True
    )
    parser.add_argument("--started-at", required=True)
    args = parser.parse_args()
    resources = json.loads((ROOT / "deploy/recovery/resources.json").read_text())
    deadline = time.monotonic() + 2400
    transitions = []
    previous = None
    while time.monotonic() < deadline:
        group = aws(
            "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
        )["AutoScalingGroups"][0]
        rows = group["Instances"]
        state = [
            {
                "id": m["InstanceId"],
                "phase": m["LifecycleState"],
                "health": m["HealthStatus"],
            }
            for m in rows
        ]
        if state != previous:
            transitions.append(
                {
                    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "instances": state,
                }
            )
            print(json.dumps(state), flush=True)
            previous = state
        candidates = [
            m
            for m in rows
            if m["InstanceId"] != args.old_instance
            and m["LifecycleState"] == "InService"
            and m["HealthStatus"] == "Healthy"
        ]
        if len(candidates) == 1:
            host = candidates[0]["InstanceId"]
            health = aws(
                "elbv2",
                "describe-target-health",
                TargetGroupArn=resources["target_group_arn"],
            )["TargetHealthDescriptions"]
            if any(
                h["Target"]["Id"] == host and h["TargetHealth"]["State"] == "healthy"
                for h in health
            ):
                break
        time.sleep(20)
    else:
        raise TimeoutError(
            "Replacement did not become healthy; inspect ASG activities and private bootstrap logs"
        )
    old = aws("ec2", "describe-instances", InstanceIds=[args.old_instance])[
        "Reservations"
    ][0]["Instances"][0]
    if old["State"]["Name"] != "terminated":
        raise RuntimeError("Previous host not terminated")
    script = """bash <<'VERIFY'
set -euo pipefail
cd /opt/cadenza
test -f bootstrap.ready
cat logs/startup-exclusivity.json
printf '\\n'
docker inspect --format '{{.Config.Image}} health={{.State.Health.Status}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' cadenza-backend-1
docker compose --env-file release.env exec -T backend python - < check-embedding.py
curl --silent --show-error --max-time 20 --output /dev/null --write-out 'off_home_https_status=%{http_code}\\n' https://d1wj9jjqzhjpqq.cloudfront.net/test
VERIFY"""
    command = aws(
        "ssm",
        "send-command",
        DocumentName="AWS-RunShellScript",
        InstanceIds=[host],
        Parameters={"commands": [script]},
    )["Command"]["CommandId"]
    for _ in range(36):
        time.sleep(5)
        invocation = aws(
            "ssm", "get-command-invocation", CommandId=command, InstanceId=host
        )
        if invocation["Status"] in ("Pending", "InProgress", "Delayed"):
            continue
        if invocation["Status"] != "Success":
            raise RuntimeError("Replacement runtime verification failed")
        break
    else:
        raise TimeoutError("Runtime verification timed out")
    output = invocation["StandardOutputContent"]
    print(output, flush=True)
    gate = json.loads(output.splitlines()[0])
    assert gate["observed_hosts"] == [host]
    assert "health=healthy restarts=0 oom=false" in output
    assert "dimensions: 768" in output
    assert "off_home_https_status=403" in output
    checks = []
    for path, expected in [
        ("health/ready", 200),
        ("health/live", 200),
        ("test", 200),
        ("tags/activity", 401),
    ]:
        code = subprocess.check_output(
            [
                "curl",
                "--silent",
                "--show-error",
                "--max-time",
                "20",
                "--output",
                "/dev/null",
                "--write-out",
                "%{http_code}",
                "https://d1wj9jjqzhjpqq.cloudfront.net/" + path,
            ],
            text=True,
        )
        assert int(code) == expected, (path, code)
        checks.append({"path": "/" + path, "status": int(code)})
    activities = aws(
        "autoscaling",
        "describe-scaling-activities",
        AutoScalingGroupName=GROUP,
        MaxRecords=10,
    )["Activities"]
    record = {
        "kind": args.kind,
        "started_at_utc": args.started_at,
        "completed_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "old_instance": args.old_instance,
        "new_instance": host,
        "old_terminated": True,
        "capacity": {
            "minimum": group["MinSize"],
            "desired": group["DesiredCapacity"],
            "maximum": group["MaxSize"],
        },
        "health_check_type": group["HealthCheckType"],
        "transitions": transitions,
        "startup_gate": gate,
        "runtime_command": command,
        "runtime_summary": output,
        "https_checks": checks,
        "activities": [
            {k: a.get(k) for k in ["ActivityId", "Description", "Cause", "StatusCode"]}
            for a in activities
        ],
    }
    (ROOT / "deploy/recovery" / ("verification." + args.kind + ".json")).write_text(
        json.dumps(record, indent=2) + "\n"
    )
    resources["current_instance"] = host
    (ROOT / "deploy/recovery/resources.json").write_text(
        json.dumps(resources, indent=2) + "\n"
    )
    print("Automatic replacement verification passed: " + host, flush=True)


if __name__ == "__main__":
    main()
