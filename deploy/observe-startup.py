"""Observe local startup endpoints without invoking inference or external services."""

import concurrent.futures
import datetime
import json
import time
import urllib.error
import urllib.request

pending = {
    "rust_live": "http://127.0.0.1:3000/health/live",
    "python_model_ready": "http://127.0.0.1:3001/health/ready",
    "combined_ready": "http://127.0.0.1:3000/health/ready",
}


def probe(url):
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


end = time.monotonic() + 900
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    while pending and time.monotonic() < end:
        began = time.monotonic()
        futures = {name: pool.submit(probe, url) for name, url in pending.items()}
        for name, future in futures.items():
            if future.result():
                print(
                    json.dumps(
                        {
                            "stage": name,
                            "at_utc": datetime.datetime.now(datetime.UTC).isoformat(),
                            "monotonic_seconds": time.monotonic(),
                            "poll_interval_seconds": 1,
                        }
                    ),
                    flush=True,
                )
                del pending[name]
        time.sleep(max(0, 1 - (time.monotonic() - began)))
if pending:
    raise SystemExit("Startup observation timed out: " + ", ".join(pending))
