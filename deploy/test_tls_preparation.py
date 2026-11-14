"""Test the real host validator and regional secret request without AWS or a DB."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parent


class PreparationTests(unittest.TestCase):
    def test_tls_configuration_is_fail_closed(self):
        source = (ROOT / "prepare-host-release.sh").read_text()
        program = source.split("<<'VALIDATE'\n", 1)[1].split("\nVALIDATE", 1)[0]
        for query, accepted in [
            (
                "sslmode=verify-full&sslrootcert=/etc/ssl/certs/cadenza-supabase-root.crt",
                True,
            ),
            ("", False),
            ("sslmode=require", False),
            ("sslmode=verify-full&sslrootcert=/wrong", False),
        ]:
            with self.subTest(query=query), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                (folder / "secrets").mkdir()
                (folder / "secrets/api.env").write_text(
                    "DATABASE_URL=postgresql://test:fake@localhost:5432/test?"
                    + query
                    + "\n"
                )
                (folder / "supabase-root.cer").write_text("public certificate fixture")
                result = subprocess.run(
                    [sys.executable, "-c", program],
                    check=False,
                    cwd=folder,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode == 0, accepted)
                self.assertNotIn("test:fake", result.stdout + result.stderr)

    def test_parameter_reads_use_destination_region(self):
        spec = importlib.util.spec_from_file_location(
            "fetch", ROOT / "fetch-secrets.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = subprocess.CompletedProcess(
            [], 0, stdout=json.dumps({"HF_TOKEN": "fake-token"})
        )
        with patch.object(module.subprocess, "run", return_value=result) as run:
            module.fetch_group("ml", ("HF_TOKEN",), "us-west-1")
        args = run.call_args.args[0]
        self.assertEqual(args[args.index("--region") + 1], "us-west-1")
