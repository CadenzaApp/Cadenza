#!/usr/bin/env bash
set -x

RUST_MANIFEST_DIR="./backend-api"


echo "----- 1. Checking formatting for rust files in $RUST_MANIFEST_DIR -----"

if cargo fmt --manifest-path $RUST_MANIFEST_DIR/Cargo.toml --check; then
  echo "✅ Format check passed!"
else
  echo "❌ Format check failed! Run 'format_all' to fix formatting issues."
  exit 1
fi
