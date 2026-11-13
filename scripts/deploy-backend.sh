#!/bin/bash
# Developer entry point; no CI runner is required.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
exec python3 deploy/release.py "$@"
