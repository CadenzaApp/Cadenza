"""Create a host-local Grafana admin password without displaying it or baking it."""

import json
import os
import secrets
import subprocess
from pathlib import Path

root = Path("/opt/cadenza")
settings = dict(
    line.split("=", 1)
    for line in (root / "release.env").read_text().splitlines()
    if line and not line.startswith("#")
)
destination = root / "monitoring"
destination.mkdir(mode=0o700, exist_ok=True)
container = subprocess.check_output(
    ["docker", "create", "--entrypoint", "/bin/true", settings["BACKEND_IMAGE"]],
    text=True,
).strip()
try:
    copied = subprocess.run(
        ["docker", "cp", container + ":/opt/cadenza-monitoring/.", str(destination)],
        check=False,
        capture_output=True,
    )
finally:
    subprocess.run(["docker", "rm", container], check=True, stdout=subprocess.DEVNULL)
if copied.returncode:
    # Old rollback images predate metrics. API availability does not depend on it.
    print(
        "Image has no monitoring configuration; retaining any previous configuration."
    )
if not (destination / "images.json").is_file():
    raise SystemExit(0)

path = Path("/opt/cadenza/secrets/grafana-admin-password")
try:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o400)
except FileExistsError:
    if not path.is_file() or path.is_symlink() or not path.stat().st_size:
        raise RuntimeError("Invalid Grafana admin secret file") from None
else:
    with os.fdopen(descriptor, "w") as stream:
        stream.write(secrets.token_urlsafe(48))
        stream.flush()
        os.fsync(stream.fileno())
# The host parent directory remains root-only; only Grafana's UID can read the bind.
path.chown(472, 0)
path.chmod(0o400)

for item in json.loads(
    Path("/opt/cadenza/monitoring/images.json").read_text()
).values():
    image = item["image"]
    if subprocess.run(
        ["docker", "image", "inspect", image], check=False, capture_output=True
    ).returncode:
        try:
            subprocess.run(["docker", "pull", image], check=True, timeout=90)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            print("Monitoring image unavailable; API startup may continue.")
