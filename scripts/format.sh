#!/usr/bin/env bash
#
# Run format.sh to apply formatting standards to all Rust and client files in the project.
# Run format.sh --check to verify formatting without changing files.
#

# Some black magic to ensure the scripts can be run from anywhere
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"


RUST_DIR="$PROJECT_ROOT/backend-api"
REACT_NATIVE_DIR="$PROJECT_ROOT/client-app"

RUST_FMT_ARGS=( )
PRETTIER_ARGS=( "--write" )

if [ "$#" -eq 1 ] && [ "$1" = "--check" ]; then
  RUST_FMT_ARGS=( "--check" )
  PRETTIER_ARGS=( "--check" )
elif [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

format_failure() {
  local formatter="$1"

  cat >&2 <<EOF

Formatting check failed: $formatter found files that do not match the project's formatting standards.

Why this blocks a push:
  Consistent formatting keeps the code tidy and keeps merge conflicts to a minimum.

Fix it automatically:
  macOS/Linux: ./scripts/format.sh
  Windows:     scripts\\format.bat

Then review the formatting changes, commit them, and push again.
EOF
}

echo "----- 1. Rust format pass for files in $RUST_DIR -----"

if cargo fmt --manifest-path "$RUST_DIR/Cargo.toml" "${RUST_FMT_ARGS[@]}"; then
  echo "cargo fmt succeeded."
else
  format_failure "cargo fmt"
  exit 1
fi

echo ""
echo "----- 2. Prettier format pass for files in $REACT_NATIVE_DIR -----"

if npx --prefix "$REACT_NATIVE_DIR" prettier "$REACT_NATIVE_DIR" "${PRETTIER_ARGS[@]}"; then
  echo "Prettier succeeded."
else
  format_failure "Prettier"
  exit 1
fi
