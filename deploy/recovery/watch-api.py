"""Print one timestamped HTTPS readiness probe per second; never changes AWS state."""

import argparse
import datetime
import json
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url", default="https://d1wj9jjqzhjpqq.cloudfront.net/health/ready"
    )
    args = parser.parse_args()
    while True:
        began = time.monotonic()
        started = datetime.datetime.now(datetime.UTC).isoformat()
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
                args.url,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        elapsed = time.monotonic() - began
        print(
            json.dumps(
                {
                    "started_at_utc": started,
                    "completed_at_utc": datetime.datetime.now(datetime.UTC).isoformat(),
                    "http_status": int(result.stdout) if result.returncode == 0 else 0,
                    "elapsed_seconds": round(elapsed, 3),
                }
            ),
            flush=True,
        )
        time.sleep(max(0, 1 - elapsed))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
