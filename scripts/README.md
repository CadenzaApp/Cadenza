# Utility Scripts

Each formatting script in this directory has two versions:
- a `.sh` file for running from macOS or Linux
- a `.bat` file for running from Windows

Both should behave essentially identically.
Brief documentation is provided below for each script in this directory.
If you add your own script later, be sure to update this documentation and try your best to ensure
behavior parity between `.sh` and `.bat` versions of the script.

All scripts should be runnable from anywhere in the project. See `format.sh` and `format.bat` for some ideas on how to ensure that.

## `format`

Auto-format all code to meet the rust fmt and prettier standards.

MacOS
```sh
scripts/format.sh
```
Windows
```bat
scripts\format.bat
```

To check formatting without changing any code, run with the `--check` flag.
Run `npm ci --prefix client-app` after cloning to install the locked Prettier version.

## Git hooks

Install the versioned pre-push hook once per clone. It blocks a push when Rust or client code is
not formatted. The error explains the failed formatter, why formatting is required, and how to
fix the files automatically.

macOS or Linux:
```sh
./scripts/install-git-hooks.sh
```

Windows:
```bat
scripts\install-git-hooks.bat
```

The hook runs `scripts/format.sh --check` on macOS and Linux, and `scripts\format.bat --check`
on Windows. It checks files only and does not modify them. Run the matching format command to
apply formatting before trying again.

## Backend deployment and private Grafana

See [developer setup](../deploy/GETTING_STARTED.md) for AWS access and prerequisites.

| Task | macOS | Windows PowerShell |
| --- | --- | --- |
| Deploy | `./scripts/deploy-backend.sh` | `.\scripts\deploy-backend.bat` |
| Grafana | `python3 scripts/open-metrics.py` | `.\scripts\open-metrics.bat` |

Both use the same Python implementations and work from any directory. Docker
Desktop must use Linux containers. Grafana also requires the Session Manager
plugin. Its browser opens when the private tunnel is ready; Ctrl-C closes it.
Use `--port 3301` for another local port and `--no-browser` for a printed URL.

The EC2 installation/startup shell scripts are Linux-only host internals.
