"""Sample Linux host resources and backend status; run on EC2, not in a container.

Writes JSON lines without container environments, application logs, or AWS calls.
This records evidence; phone checks are still required to establish correctness.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import time


def counters(path: Path) -> dict[str, int]:
    values = {}
    for line in path.read_text().splitlines():
        fields = line.replace(":", "").split()
        if len(fields) >= 2 and fields[1].isdigit():
            values[fields[0]] = int(fields[1])
    return values


def host_sample(proc: Path = Path("/proc"), disk: str = "/") -> dict:
    memory = counters(proc / "meminfo")
    vm = counters(proc / "vmstat")
    storage = shutil.disk_usage(disk)
    return {
        "memory_total_kib": memory["MemTotal"],
        "memory_available_kib": memory["MemAvailable"],
        "memory_available_percent": round(100 * memory["MemAvailable"] / memory["MemTotal"], 2),
        "swap_used_kib": memory["SwapTotal"] - memory["SwapFree"],
        "swap_pages_in": vm["pswpin"],
        "swap_pages_out": vm["pswpout"],
        "host_oom_kills": vm["oom_kill"],
        "disk_free_bytes": storage.free,
        "disk_free_percent": round(100 * storage.free / storage.total, 2),
    }


def docker_output(arguments: list[str]) -> str:
    try:
        return subprocess.check_output(
            ["docker", *arguments], text=True, stderr=subprocess.DEVNULL, timeout=15,
        ).strip()
    except (subprocess.SubprocessError, OSError):
        raise RuntimeError("Docker status unavailable; check Docker and /opt/cadenza configuration") from None


def backend_sample() -> dict:
    containers = docker_output([
        "ps", "--all", "--quiet",
        "--filter", "label=com.docker.compose.project=cadenza",
        "--filter", "label=com.docker.compose.service=backend",
        "--filter", "label=com.docker.compose.oneoff=False",
    ]).splitlines()
    if not containers:
        return {"status": "absent"}
    if len(containers) != 1:
        return {"status": "multiple", "count": len(containers)}
    container = containers[0]
    # Project only nonsecret fields. Do not serialize the complete inspect result
    # or health-check logs, which can contain credentials or application data.
    projection = (
        '{"id":{{json .Id}},"status":{{json .State.Status}},'
        '"oom_killed":{{json .State.OOMKilled}},"restarts":{{.RestartCount}},'
        '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}'
    )
    try:
        return json.loads(docker_output(["inspect", "--format", projection, container]))
    except RuntimeError:
        # Compose may replace the container between discovery and inspection.
        return {"status": "unavailable"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=float, default=1800, help="Seconds; 0 records one sample")
    parser.add_argument("--interval", type=float, default=10, help="Seconds between samples")
    args = parser.parse_args()
    if args.duration < 0 or args.interval <= 0:
        parser.error("duration must be nonnegative and interval must be positive")
    if not Path("/proc/meminfo").exists():
        parser.error("Run on the Linux EC2 host from /opt/cadenza")
    deadline = time.monotonic() + args.duration
    try:
        while True:
            sample = {
                "time": datetime.now(timezone.utc).isoformat(),
                **host_sample(),
                "backend": backend_sample(),
            }
            print(json.dumps(sample), flush=True)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(args.interval, remaining))
    except (OSError, KeyError, RuntimeError) as error:
        raise SystemExit(str(error)) from None
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
