# Git hooks

This directory contains hooks shared by every clone of the repository.

## Files

| file | role |
| --- | --- |
| `pre-push` | Checks Rust and client formatting before Git sends a push. |

## Setup

Run `./scripts/install-git-hooks.sh` on macOS or Linux, or
`scripts\install-git-hooks.bat` on Windows. The installer sets this repository's local
`core.hooksPath` to `.githooks`.

## How it works

`pre-push` runs `scripts/format.sh --check`. A failed check blocks the push and explains how to
auto-format the files. The hook does not change files itself.

## Gotchas

Git hooks are configured per clone, so every contributor must run the installer once. Git's
`--no-verify` flag bypasses the hook and should be reserved for emergencies.

---
Touching files in this directory? Update this README in the same change.
See [../AGENT_GUIDE.md](../AGENT_GUIDE.md).
