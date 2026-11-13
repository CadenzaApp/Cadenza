"""Read only Python runtime and pinned model files, with bounded parallel I/O."""

import concurrent.futures
import json
import os
import resource
import stat
import sys
import time
from pathlib import Path

started = time.monotonic()
revision = os.environ["MODEL_REVISION"]
roots = [
    Path(sys.prefix),
    Path(sys.base_prefix)
    / "lib"
    / f"python{sys.version_info.major}.{sys.version_info.minor}",
    Path("/usr/lib/aarch64-linux-gnu"),
    Path("/cache/huggingface/hub/models--google--embeddinggemma-300m/snapshots")
    / revision,
]
# The full backend also needs its executable and ML entry point. These are small
# compared with the runtime/model trees and are never executed by this reader.
paths = [
    Path("/usr/local/bin/cadenza-api"),
    Path("/app/backend-api/ml-service/main.py"),
    Path(sys.executable),
]
paths.extend((Path(sys.base_prefix) / "lib").glob("libpython*.so*"))
for root in roots:
    if not root.is_dir():
        raise RuntimeError("Expected startup directory is missing: " + str(root))
    for directory, _, names in os.walk(root):
        paths.extend(Path(directory) / name for name in names)


def describe(path):
    path = path.resolve()
    info = path.stat()
    return (path, info) if stat.S_ISREG(info.st_mode) else None


def read_range(task):
    path, offset, length = task
    fd = os.open(path, os.O_RDONLY)
    try:
        end = offset + length
        while offset < end:
            block = os.pread(fd, min(1024 * 1024, end - offset), offset)
            if not block:
                raise RuntimeError("Startup file was truncated")
            offset += len(block)
    finally:
        os.close(fd)
    return length


seen = set()
tasks = []
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    for result in pool.map(describe, paths):
        if result is None:
            continue
        path, info = result
        identity = (info.st_dev, info.st_ino)
        if identity in seen:
            continue
        seen.add(identity)
        for offset in range(0, info.st_size, 8 * 1024 * 1024):
            tasks.append((path, offset, min(8 * 1024 * 1024, info.st_size - offset)))
    total = sum(pool.map(read_range, tasks))
print(
    json.dumps(
        {
            "stage": "targeted_prefetch",
            "seconds": round(time.monotonic() - started, 3),
            "files": len(seen),
            "logical_bytes": total,
            "input_blocks": resource.getrusage(resource.RUSAGE_SELF).ru_inblock,
        }
    ),
    flush=True,
)
