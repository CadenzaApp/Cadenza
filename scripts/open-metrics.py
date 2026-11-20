#!/usr/bin/env python3
"""Open an authenticated AWS tunnel to the private read-only Grafana dashboard."""

import argparse
import json
import os
import signal
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11 or newer is required.")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy/recovery"))
from provision import GROUP, PROFILE, REGION, aws


def open_when_ready(process, port, timeout=60, browser_open=webbrowser.open):
    """Open once after Grafana responds, never after an exited/failed tunnel."""
    health = f"http://127.0.0.1:{port}/api/health"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while process.poll() is None and time.monotonic() < deadline:
        ready = False
        try:
            with opener.open(health, timeout=1) as response:
                payload = json.load(response)
                ready = (
                    response.status == 200
                    and isinstance(payload, dict)
                    and payload.get("database") == "ok"
                )
        except (OSError, ValueError):
            pass
        if ready and process.poll() is None:
            url = f"http://localhost:{port}/d/cadenza-backend"
            try:
                opened = browser_open(url, new=2)
            except (webbrowser.Error, OSError):
                opened = False
            if not opened:
                print(f"Could not open a browser automatically. Open {url}", flush=True)
            return
        time.sleep(0.25)
    if process.poll() is None:
        print(
            "Tunnel is running but Grafana is not ready yet. Use the printed URL when it responds.",
            flush=True,
        )


def tunnel_process_options(windows=None):
    windows = os.name == "nt" if windows is None else windows
    if windows:
        # Keep Ctrl-C in Python so cleanup can also stop the plugin child process.
        return {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)}
    return {"start_new_session": True}


def stop_tunnel(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port", type=int, default=3300, help="Local port (default 3300)"
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Print the URL without opening a browser",
    )
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Choose a local port between 1024 and 65535")
    with socket.socket() as probe:
        if os.name == "nt":
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", args.port))
        except OSError:
            raise SystemExit(
                f"Local port {args.port} is already in use. Close the existing tunnel or choose --port with another port."
            ) from None
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
        f"Dashboard: http://localhost:{args.port}/d/cadenza-backend\n"
        + (
            "Open the URL manually.\n"
            if args.no_browser
            else "Your default browser will open once Grafana is ready.\n"
        )
        + "Read-only access uses your AWS identity. Leave this terminal running; Ctrl-C closes the tunnel.",
        flush=True,
    )
    process = subprocess.Popen(
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
            f"portNumber=3300,localPortNumber={args.port}",
        ],
        **tunnel_process_options(),
    )
    try:
        if not args.no_browser:
            open_when_ready(process, args.port)
        return process.wait()
    finally:
        stop_tunnel(process)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print("Could not open Grafana: " + str(error), file=sys.stderr)
        raise SystemExit(1)
