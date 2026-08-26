#!/usr/bin/env bash
#
# Run format.sh to apply formatting standard to all rust/ts/js/ etc files in the project
# Run format.sh --check just to check if the current formatting passes the formatting standards
#

RUST_DIR="./backend-api"
RUST_FMT_ARGS=""

if [ "$1" == "--check" ]; then
  RUST_FMT_ARGS="--check"
fi

echo "----- 1. Rust format pass for files in $RUST_DIR -----"

if cargo fmt --manifest-path "$RUST_DIR/Cargo.toml" $RUST_FMT_ARGS; then
  echo "✅ cargo fmt succeeded."
else
  echo "❌ cargo fmt failed!"
  exit 1
fi
