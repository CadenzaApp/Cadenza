#!/usr/bin/env bash
set -x

RUST_MANIFEST_DIR="./backend-api"


echo "----- 1. Fixing formatting for rust files in $RUST_MANIFEST_DIR -----"

if cargo fmt; then
    echo "✅ cargo fmt succeeded."
  fi
else
  echo "❌ cargo fmt failed!"
  exit 1
fi
