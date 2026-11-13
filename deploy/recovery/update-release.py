"""Stop-first update on the one backend; preserve EC2 health replacement during maintenance."""

import argparse
import base64
from pathlib import Path
import time

from provision import aws, GROUP


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    content = args.candidate.read_text()
    for line in content.splitlines():
        if (
            line.strip()
            and not line.startswith("#")
            and line.split("=", 1)[0] not in ("BACKEND_IMAGE", "MODEL_REVISION")
        ):
            raise ValueError(
                "Candidate must contain only nonsecret image and model settings"
            )
    group = aws(
        "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
    )["AutoScalingGroups"][0]
    members = [m for m in group["Instances"] if m["LifecycleState"] == "InService"]
    if len(members) != 1:
        raise RuntimeError("Expected one InService host")
    host = members[0]["InstanceId"]
    # Only expected application outages are suppressed. EC2 host health stays enabled.
    aws(
        "autoscaling",
        "update-auto-scaling-group",
        AutoScalingGroupName=GROUP,
        HealthCheckType="EC2",
    )
    try:
        data = base64.b64encode(content.encode()).decode()
        script = (
            "bash <<'RELEASE'\nset -euo pipefail\ncd /opt/cadenza\nprintf '%s' '"
            + data
            + "' | base64 -d > releases/candidate.env\nbash activate-release.sh releases/candidate.env\nRELEASE"
        )
        command = aws(
            "ssm",
            "send-command",
            DocumentName="AWS-RunShellScript",
            InstanceIds=[host],
            Parameters={"commands": [script], "executionTimeout": ["900"]},
        )["Command"]["CommandId"]
        deadline = time.monotonic() + 960
        while time.monotonic() < deadline:
            time.sleep(5)
            result = aws(
                "ssm", "get-command-invocation", CommandId=command, InstanceId=host
            )
            if result["Status"] in ("Pending", "InProgress", "Delayed"):
                continue
            if result["Status"] != "Success":
                raise RuntimeError(
                    "Activation failed; inspect private host log and verify rollback"
                )
            print(
                "Single-host activation passed; publish the same release into the launch template using provision.py."
            )
            return
        raise TimeoutError("Activation timed out; verify host release before retrying")
    finally:
        try:
            # The app may be ready before ALB has observed two successes.
            target_group = group["TargetGroupARNs"][0]
            until = time.monotonic() + 120
            healthy = False
            while time.monotonic() < until:
                rows = aws(
                    "elbv2", "describe-target-health", TargetGroupArn=target_group
                )["TargetHealthDescriptions"]
                if any(
                    r["Target"]["Id"] == host
                    and r["TargetHealth"]["State"] == "healthy"
                    for r in rows
                ):
                    healthy = True
                    break
                time.sleep(10)
        finally:
            aws(
                "autoscaling",
                "update-auto-scaling-group",
                AutoScalingGroupName=GROUP,
                HealthCheckType="ELB",
            )
        if not healthy:
            raise RuntimeError(
                "ALB did not recover after activation/rollback; inspect native recovery"
            )


if __name__ == "__main__":
    main()
