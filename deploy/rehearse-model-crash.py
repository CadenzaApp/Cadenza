"""DELIBERATE REHEARSAL: stop the Python child; restart the backend afterward."""

import os
import signal
from pathlib import Path
for entry in Path("/proc").iterdir():
    if not entry.name.isdigit():
        continue
    try:
        args = (entry / "cmdline").read_bytes().split(b"\0")
        uvicorn = any(Path(arg.decode(errors="replace")).name == "uvicorn" for arg in args if arg)
        if uvicorn and b"main:app" in args:
            os.kill(int(entry.name), signal.SIGTERM)
            print("Stopped model child", entry.name)
            break
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        continue
else:
    raise SystemExit("No model child found; inspect logs")
