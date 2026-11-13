#!/bin/bash
# Run as root on EC2. Retrieve secrets on the host without printing values.
set -euo pipefail
umask 077
cd /opt/cadenza
exec 3>&1
exec > logs/prepare-release.log 2>&1
trap 'echo "Release preparation failed; private log retained on EC2." >&3' ERR
echo "Retrieving deployment secrets on EC2." >&3
python3 fetch-secrets.py
python3 - <<'VALIDATE'
from pathlib import Path
from urllib.parse import urlsplit
values=dict(line.split("=",1) for line in Path("secrets/api.env").read_text().splitlines())
url=urlsplit(values["DATABASE_URL"])
if url.scheme not in ("postgres", "postgresql") or url.port != 5432:
    raise SystemExit("DATABASE_URL must use the PostgreSQL session pooler on port 5432")
print("Secret files validated without displaying values")
VALIDATE
registry_config=$(mktemp -d /run/cadenza-ecr.XXXXXX)
trap 'rm -rf "$registry_config"' EXIT
aws ecr get-login-password --region us-west-2 | docker --config "$registry_config" login --username AWS --password-stdin 175220118767.dkr.ecr.us-west-2.amazonaws.com
echo "Pulling the pinned backend image." >&3
docker --config "$registry_config" compose --env-file release.env pull
rm -rf "$registry_config"
trap - EXIT
docker compose --env-file release.env config --quiet
if [ "${CADENZA_WARM_START:-0}" != 1 ]; then
    docker compose --env-file release.env run --rm --no-deps backend python -c 'import torch; assert torch.version.cuda is None; print("CPU-only Torch verified")'
fi
echo "Pinned images pulled; secret files remain private." >&3
free -m >&3
df -h / >&3
