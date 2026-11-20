# Developer tools

Use one cross-platform Python implementation per tool. Avoid separate `.sh`,
`.bat` or `.ps1` copies and wrappers where a direct Python command works.
Linux EC2 host scripts under `deploy/` are separate from these workstation tools.

Run these from the repository root. Each Python tool also resolves repository
paths independently, so it can be invoked by absolute path from another directory.

| Task | macOS/Linux | Windows PowerShell |
| --- | --- | --- |
| Format | `python3 scripts/format.py` | `py -3 scripts/format.py` |
| Check formatting | `python3 scripts/format.py --check` | `py -3 scripts/format.py --check` |
| Deploy | `python3 deploy/release.py` | `py -3 deploy/release.py` |
| Grafana | `python3 scripts/open-metrics.py` | `py -3 scripts/open-metrics.py` |

Formatting needs Python, Rust/cargo and Node.js. Run `npm ci --prefix client-app` after
cloning to install the locked Prettier version. The Python formatter invokes the
same Rust and Prettier tools on both operating systems.

## Git hooks

Install the versioned pre-push hook once per clone with this Git command:

```text
git config core.hooksPath .githooks
```

Git invokes a minimal hook bootstrap that selects Python and runs
`scripts/format.py --check`. It checks files without modifying them. Fix reported
formatting with the Python command above, review and commit, then push again.

## Deployment and Grafana

See [developer setup](../deploy/GETTING_STARTED.md) for AWS access and prerequisites.
Deployment needs Python 3.11+, AWS CLI v2 and Docker Desktop using Linux containers.
Grafana also needs the Session Manager plugin. Its default browser opens when the
private tunnel is ready; Ctrl-C closes the tunnel. Use `--port 3301` for another
local port and `--no-browser` to open the printed URL yourself.
