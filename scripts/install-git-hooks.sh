#!/usr/bin/env bash

set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

git -C "$PROJECT_ROOT" config core.hooksPath .githooks

echo "Installed Git hooks from .githooks for this clone."
