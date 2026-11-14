"""Stop-first update on the one backend; preserve EC2 health replacement during maintenance."""

import argparse
import base64
import io
import tarfile
import time
from pathlib import Path

from provision import GROUP, ROOT, aws


def validate_candidate(content):
    limits = {
        "API_REQUESTS_PER_USER_MINUTE",
        "TAG_REQUESTS_PER_USER_MINUTE",
        "TAG_REQUESTS_PER_USER_DAY",
        "TAG_PROVIDER_CALLS_PER_DAY",
        "TAG_PROVIDER_CONCURRENCY",
    }
    seen = set()
    for line in content.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        if (
            not separator
            or name in seen
            or name not in limits | {"BACKEND_IMAGE", "MODEL_REVISION"}
        ):
            raise ValueError(
                "Candidate must contain only nonsecret image, model and quota settings"
            )
        seen.add(name)
        if name in limits and (
            not value.isascii()
            or not value.isdecimal()
            or not 1 <= int(value) <= 1_000_000
        ):
            raise ValueError(f"{name} must be an integer between 1 and 1000000")
    if not {"BACKEND_IMAGE", "MODEL_REVISION"} <= seen:
        raise ValueError("Candidate requires image and model settings")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate settings without contacting AWS",
    )
    args = parser.parse_args()
    content = args.candidate.read_text()
    validate_candidate(content)
    if args.validate_only:
        return
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
        # Refresh host tooling from this release, rather than using stale bootstrap files.
        bundle = io.BytesIO()
        with tarfile.open(fileobj=bundle, mode="w:gz") as archive:
            for name in [
                "compose.yaml",
                "fetch-secrets.py",
                "prepare-host-release.sh",
                "start-release.sh",
                "check-embedding.py",
                "observe-startup.py",
                "activate-release.sh",
            ]:
                content_bytes = (ROOT / "deploy" / name).read_bytes()
                item = tarfile.TarInfo(name)
                item.size, item.mode = len(content_bytes), 0o600
                archive.addfile(item, io.BytesIO(content_bytes))
        tooling = base64.b64encode(bundle.getvalue()).decode()
        script = (
            "bash <<'RELEASE'\nset -euo pipefail\ncd /opt/cadenza\nprintf '%s' '"
            + tooling
            + "' | base64 -d | tar xz\nprintf '%s' '"
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
