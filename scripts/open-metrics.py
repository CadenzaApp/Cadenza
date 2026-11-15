#!/usr/bin/env python3
"""Open an authenticated AWS tunnel to the private read-only Grafana dashboard."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy/recovery"))
from provision import GROUP, PROFILE, REGION, aws


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port", type=int, default=3300, help="Local port (default 3300)"
    )
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Choose a local port between 1024 and 65535")
    if not shutil.which("session-manager-plugin"):
        raise SystemExit(
            "Install the AWS Session Manager plugin first: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
        )
    group = aws(
        "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
    )["AutoScalingGroups"][0]
    hosts = [
        i["InstanceId"]
        for i in group["Instances"]
        if i["LifecycleState"] == "InService"
    ]
    if len(hosts) != 1:
        raise SystemExit(
            "Wait for exactly one InService backend before opening the dashboard."
        )
    print(
        f"Open http://localhost:{args.port}/d/cadenza-backend\nRead-only access uses your AWS identity. Leave this terminal running; Ctrl-C closes the tunnel.",
        flush=True,
    )
    return subprocess.run(
        [
            "aws",
            "ssm",
            "start-session",
            "--profile",
            PROFILE,
            "--region",
            REGION,
            "--target",
            hosts[0],
            "--document-name",
            "AWS-StartPortForwardingSession",
            "--parameters",
            f'{{"portNumber":["3300"],"localPortNumber":["{args.port}"]}}',
        ],
        check=False,
    ).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        pass
