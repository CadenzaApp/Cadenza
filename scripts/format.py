#!/usr/bin/env python3
"""Format Rust and client code, or check formatting without changing files."""

import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check without changing files")
    args = parser.parse_args()
    try:
        print("Checking Rust formatting." if args.check else "Formatting Rust.", flush=True)
        command = ["cargo", "fmt", "--manifest-path", str(ROOT / "backend-api/Cargo.toml")]
        if args.check:
            command.append("--check")
        subprocess.run(command, cwd=ROOT, check=True)

        client = ROOT / "client-app"
        package = client / "node_modules/prettier/package.json"
        if not package.is_file():
            raise RuntimeError("Prettier is not installed. Run: npm ci --prefix client-app")
        entry = json.loads(package.read_text(encoding="utf-8"))["bin"]
        if isinstance(entry, dict):
            entry = entry["prettier"]
        # Run the JavaScript entry directly; no platform-specific .cmd/.bin shim.
        subprocess.run(
            ["node", str(package.parent / entry), str(client), "--check" if args.check else "--write"],
            cwd=ROOT,
            check=True,
        )
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"Formatting failed: {error}", file=sys.stderr)
        print(
            "Consistent formatting is required before pushing. Fix the prerequisite/error above, "
            "then run `python3 scripts/format.py` on macOS/Linux or "
            "`py -3 scripts/format.py` on Windows. Review and commit the result.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
