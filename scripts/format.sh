#!/usr/bin/env bash
#
# Run format.sh to apply formatting standard to all rust/ts/js/ etc files in the project
# Run format.sh --check just to check if the current formatting passes the formatting standards
#

RUST_DIR="./backend-api"
REACT_NATIVE_DIR="./client-app"

RUST_FMT_ARGS=""
PRETTIER_ARGS="--write"

if [ "$1" == "--check" ]; then
  RUST_FMT_ARGS="--check"
  PRETTIER_ARGS="--check"
fi

echo "----- 1. Rust format pass for files in $RUST_DIR -----"

if cargo fmt --manifest-path "$RUST_DIR/Cargo.toml" $RUST_FMT_ARGS; then
  echo "✅ cargo fmt succeeded."
else
  echo "❌ cargo fmt failed!"
  exit 1
fi

echo ""
echo "----- 2. Prettier format pass for files in $REACT_NATIVE_DIR -----"

if npx prettier $REACT_NATIVE_DIR $PRETTIER_ARGS; then
  echo "✅ Prettier succeeded."
else
  echo "❌ Prettier failed!"
  exit 1
fi
