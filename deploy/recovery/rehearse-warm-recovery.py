"""Deliberately kill Python and time automatic replacement through public HTTPS."""

import argparse
import concurrent.futures
import datetime
import email.utils
import itertools
import json
import os
import re
import subprocess
import sys
import threading
import time

from provision import GROUP, ROOT, aws

URL = "https://d1wj9jjqzhjpqq.cloudfront.net"


def probe(path):
    result = subprocess.run(
        [
            "curl",
            "--silent",
            "--max-time",
            "2",
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}",
            URL + path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return int(result.stdout) if result.returncode == 0 else 0


def utc(ns):
    return datetime.datetime.fromtimestamp(ns / 1e9, datetime.UTC).isoformat()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default="verification.warm_timing.json",
        help="Result filename inside recovery/",
    )
    args = parser.parse_args()
    if sys.platform == "darwin" and os.environ.get("CADENZA_REHEARSAL_AWAKE") != "1":
        env = dict(os.environ, CADENZA_REHEARSAL_AWAKE="1")
        raise SystemExit(
            subprocess.run(
                ["caffeinate", "-i", sys.executable, *sys.argv], env=env, check=False
            ).returncode
        )
    resources = json.loads((ROOT / "deploy/recovery/resources.json").read_text())
    if not (resources.get("warm_ami") or {}).get("validated"):
        raise RuntimeError("Promote a validated warm AMI before this rehearsal")
    group = aws(
        "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
    )["AutoScalingGroups"][0]
    if group["HealthCheckType"] != "ELB" or len(group["Instances"]) != 1:
        raise RuntimeError("Expected one backend with native ELB health recovery")
    old = group["Instances"][0]["InstanceId"]
    if any(
        group["LaunchTemplate"][key] != resources["launch_template"][key]
        for key in ("LaunchTemplateId", "Version")
    ):
        raise RuntimeError("Live launch template does not match the release record")
    if probe("/health/ready") != 200 or probe("/test") != 200:
        raise RuntimeError("Run from the allowed home network while the API is healthy")
    began = time.time()
    headers = subprocess.check_output(
        [
            "curl",
            "--silent",
            "--show-error",
            "--max-time",
            "5",
            "--dump-header",
            "-",
            "--output",
            "/dev/null",
            URL + "/health/ready",
        ],
        text=True,
    )
    dates = re.findall(r"^date: (.+)$", headers, re.IGNORECASE | re.MULTILINE)
    skew = (began + time.time()) / 2 - email.utils.parsedate_to_datetime(
        dates[-1].strip()
    ).timestamp()
    if abs(skew) > 3:
        raise RuntimeError("Synchronize the workstation clock before timing recovery")
    path = ROOT / "deploy/recovery" / args.output
    probe_path = path.with_suffix(".probes.jsonl")
    samples = []
    stop = threading.Event()

    def poll():
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            while not stop.is_set():
                began = time.monotonic()
                ready = pool.submit(probe, "/health/ready")
                api = pool.submit(probe, "/test")
                statuses = (ready.result(), api.result())
                samples.append(
                    {"at_ns": time.time_ns(), "ready": statuses[0], "api": statuses[1]}
                )
                with probe_path.open("a") as output:
                    output.write(
                        json.dumps(
                            {
                                "at_utc": utc(samples[-1]["at_ns"]),
                                "ready": statuses[0],
                                "api": statuses[1],
                            }
                        )
                        + "\n"
                    )
                stop.wait(max(0, 1 - (time.monotonic() - began)))

    thread = threading.Thread(target=poll, daemon=True)
    probe_path.write_text("")
    thread.start()
    record = {
        "kind": "warm_model_failure",
        "workstation_minus_http_date_seconds": round(skew, 3),
        "crash_host_ntp_synchronized": True,
        "old_instance": old,
        "warm_ami": resources["warm_ami"]["image_id"],
        "startup_prefetch": resources["warm_ami"].get("startup_prefetch"),
        "draining_seconds": resources.get("draining_seconds"),
        "launch_template": group["LaunchTemplate"],
        "poll_interval_seconds": 1,
        "request_timeout_seconds": 2,
        "transitions": [],
        "alb_transitions": [],
        "health_interval_seconds": resources["health_interval_seconds"],
    }
    record["probe_log"] = str(probe_path.relative_to(ROOT))
    try:
        script = """set -eu
[ "$(timedatectl show -p NTPSynchronized --value)" = yes ]
docker exec -u 0 -i cadenza-backend-1 python - <<'CRASH'
import json,os,signal,time
from pathlib import Path
for entry in Path('/proc').iterdir():
    if not entry.name.isdigit(): continue
    try:
        args=(entry/'cmdline').read_bytes().split(b'\\0')
        if b'main:app' in args and any(Path(a.decode(errors='replace')).name=='uvicorn' for a in args if a):
            stamp=time.time_ns()
            os.kill(int(entry.name),signal.SIGKILL)
            print(json.dumps({'killed_at_ns':stamp,'component':'python'}),flush=True)
            break
    except (FileNotFoundError,ProcessLookupError,PermissionError): continue
else: raise SystemExit('No model child found')
CRASH
"""
        command = aws(
            "ssm",
            "send-command",
            DocumentName="AWS-RunShellScript",
            InstanceIds=[old],
            Parameters={"commands": [script]},
        )["Command"]["CommandId"]
        record["crash_command"] = command
        deadline = time.monotonic() + 1800
        while time.monotonic() < deadline:
            time.sleep(2)
            invocation = aws(
                "ssm", "get-command-invocation", CommandId=command, InstanceId=old
            )
            if invocation["Status"] in ("Pending", "InProgress", "Delayed"):
                continue
            if invocation["Status"] != "Success":
                raise RuntimeError("Model crash command failed")
            stamp = json.loads(invocation["StandardOutputContent"].strip())[
                "killed_at_ns"
            ]
            break
        else:
            raise TimeoutError("Crash command did not complete")
        record["killed_at_utc"] = utc(stamp)
        print("Python killed at " + utc(stamp), flush=True)
        previous = None
        previous_alb = None
        while time.monotonic() < deadline:
            group = aws(
                "autoscaling",
                "describe-auto-scaling-groups",
                AutoScalingGroupNames=[GROUP],
            )["AutoScalingGroups"][0]
            state = [
                {
                    "id": m["InstanceId"],
                    "phase": m["LifecycleState"],
                    "health": m["HealthStatus"],
                }
                for m in group["Instances"]
            ]
            if state != previous:
                record["transitions"].append(
                    {"at_utc": utc(time.time_ns()), "instances": state}
                )
                print(json.dumps(state), flush=True)
                previous = state
            targets = aws(
                "elbv2",
                "describe-target-health",
                TargetGroupArn=resources["target_group_arn"],
            )["TargetHealthDescriptions"]
            alb = sorted(
                [
                    {
                        "id": t["Target"]["Id"],
                        "state": t["TargetHealth"]["State"],
                        "reason": t["TargetHealth"].get("Reason"),
                    }
                    for t in targets
                ],
                key=lambda t: t["id"],
            )
            if alb != previous_alb:
                record["alb_transitions"].append(
                    {"at_utc": utc(time.time_ns()), "targets": alb}
                )
                previous_alb = alb
            # Require an observed outage followed by readiness AND an API response.
            failed = next(
                (s for s in samples if s["at_ns"] >= stamp and s["ready"] != 200), None
            )
            recovered = next(
                (
                    s
                    for s in samples
                    if failed
                    and s["at_ns"] > failed["at_ns"]
                    and s["ready"] == s["api"] == 200
                ),
                None,
            )
            replacement = next(
                (
                    m
                    for m in group["Instances"]
                    if m["InstanceId"] != old and m["LifecycleState"] == "InService"
                ),
                None,
            )
            if recovered and replacement:
                record.update(
                    new_instance=replacement["InstanceId"],
                    first_failure_at_utc=utc(failed["at_ns"]),
                    first_ready_api_at_utc=utc(recovered["at_ns"]),
                    crash_to_ready_api_seconds=round(
                        (recovered["at_ns"] - stamp) / 1e9, 3
                    ),
                )
                print(
                    "Crash to responding replacement: "
                    + str(record["crash_to_ready_api_seconds"])
                    + " seconds",
                    flush=True,
                )
                break
            time.sleep(5)
        else:
            raise TimeoutError("Replacement API did not recover within 30 minutes")
    finally:
        stop.set()
        thread.join(timeout=6)
        changes = []
        previous_status = None
        for sample in samples:
            status = (sample["ready"], sample["api"])
            if status != previous_status:
                changes.append(
                    {
                        "at_utc": utc(sample["at_ns"]),
                        "ready": status[0],
                        "api": status[1],
                    }
                )
                previous_status = status
        record["http_status_changes"] = changes
        record["sample_count"] = len(samples)
        record["maximum_sample_gap_seconds"] = round(
            max(
                (b["at_ns"] - a["at_ns"] for a, b in itertools.pairwise(samples)),
                default=0,
            )
            / 1e9,
            3,
        )
        record["timing_sampling_valid"] = record["maximum_sample_gap_seconds"] <= 3
        if not record["timing_sampling_valid"]:
            print(
                "Sampling gap: reported recovery duration is an observed upper bound, not precise recovery timing.",
                flush=True,
            )
        path.write_text(json.dumps(record, indent=2) + "\n")


if __name__ == "__main__":
    main()
