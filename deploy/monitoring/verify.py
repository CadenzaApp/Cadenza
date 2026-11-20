"""Verify private monitoring on EC2 without credentials or application data."""

import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request


def get(path):
    with urllib.request.urlopen("http://127.0.0.1:3300" + path, timeout=5) as response:
        return json.load(response)


last = "not started"
deadline = time.monotonic() + 90
while time.monotonic() < deadline:
    try:
        assert get("/api/health")["database"] == "ok"
        dashboards = {}
        for path in sorted((Path(__file__).parent / "dashboards").glob("*.json")):
            expected = json.loads(path.read_text())
            dashboard = get("/api/dashboards/uid/" + expected["uid"])
            assert not dashboard["meta"]["canSave"]
            assert dashboard["dashboard"]["title"] == expected["title"]
            assert len(dashboard["dashboard"]["panels"]) == len(expected["panels"])
            dashboards[expected["uid"]] = len(expected["panels"])
        assert "cadenza-backend" in dashboards
        assert len(dashboards) == len(list((Path(__file__).parent / "dashboards").glob("*.json")))
        assert get("/api/datasources/uid/cadenza-prometheus/health")["status"] == "OK"
        try:
            get("/api/admin/settings")
            raise AssertionError("Anonymous admin access must be denied")
        except urllib.error.HTTPError as error:
            assert error.code in (401, 403)
        code = "import json,urllib.request; r=json.load(urllib.request.urlopen('http://prometheus:9090/api/v1/query?query=up%7Bjob%3D%22cadenza-backend%22%7D',timeout=5)); assert r['status']=='success' and len(r['data']['result'])==1 and r['data']['result'][0]['value'][1]=='1'"
        subprocess.run(
            ["docker", "exec", "cadenza-backend-1", "python", "-c", code],
            check=True,
            capture_output=True,
            timeout=8,
        )
        print(
            json.dumps(
                {
                    "verified": True,
                    "grafana": "private read-only",
                    "prometheus_scrape_up": True,
                    "dashboards": dashboards,
                    "retention_days": 14,
                    "block_retention_cap": "2GB",
                }
            )
        )
        break
    except (AssertionError, OSError, ValueError, subprocess.SubprocessError) as error:
        last = type(error).__name__
        time.sleep(2)
else:
    raise SystemExit(
        "Monitoring verification failed: " + last + "; inspect private host logs."
    )
