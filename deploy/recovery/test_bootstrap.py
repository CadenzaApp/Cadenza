"""Check replacement packaging and the single-backend gate without AWS."""

import base64
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import provision


class BootstrapTests(unittest.TestCase):
    def test_help_and_retired_options_never_mutate_aws(self):
        for option, code in [("--help", 0), ("--warm-ami-manifest", 2)]:
            with self.subTest(option=option), patch.object(sys, "argv", ["provision.py", option]), patch.object(provision, "aws") as aws, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as exited:
                    provision.main()
                self.assertEqual(exited.exception.code, code)
                aws.assert_not_called()

    def test_bundle_fits_userdata_and_pins_current_release_without_baking_tools(self):
        user_data, digest = provision.bootstrap_user_data()
        self.assertLess(len(user_data.encode()), 16384)
        self.assertEqual(len(digest), 64)
        encoded = user_data.split("printf '%s' '")[1].split("'", 1)[0]
        with tarfile.open(fileobj=io.BytesIO(base64.b64decode(encoded)), mode="r:gz") as archive:
            names = archive.getnames()
            self.assertEqual(archive.extractfile("release.env").read(), (provision.ROOT / "deploy/release.env.example").read_bytes())
            self.assertIn("prepare-monitoring.py", names)
            self.assertIn("supabase-root.cer", names)
            self.assertFalse(any("prefetch" in name or "bake" in name for name in names))

    def bootstrap(self, other_host):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "logs").mkdir()
            (root / "bin").mkdir()
            log = root / "commands"
            for name in ["ec2-bootstrap.sh", "install-host-tools.sh", "prepare-host-release.sh", "start-release.sh"]:
                (root / name).write_text('echo "' + name + '" >> "$COMMAND_LOG"\n')
            (root / "release.env").write_text("BACKEND_IMAGE=175220118767.dkr.ecr.us-west-1.amazonaws.com/backend@sha256:test\nMODEL_REVISION=model\n")
            stubs = {
                "docker": 'echo docker >> "$COMMAND_LOG"',
                "curl": 'echo i-new',
                "aws": 'echo "$*" >> "$COMMAND_LOG"; if [ "$1" = ec2 ]; then printf \'%s\\n\' \'["i-new"' + (',"i-old"' if other_host else '') + ']\'; fi',
                "seq": 'echo "1 2"',
                "sleep": ':',
            }
            for name, content in stubs.items():
                p = root / "bin" / name
                p.write_text("#!/bin/bash\nset -eu\n" + content + "\n")
                p.chmod(0o755)
            os.symlink(sys.executable, root / "bin/python3")
            source = Path(__file__).with_name("bootstrap-start.sh").read_text().replace("/opt/cadenza", str(root)).replace("/run/cadenza-backend-hosts.json", str(root / "hosts.json"))
            script = root / "bootstrap.sh"
            script.write_text(source)
            result = subprocess.run(["bash", str(script)], env=dict(os.environ, PATH=str(root / "bin") + ":" + os.environ["PATH"], COMMAND_LOG=str(log)), capture_output=True, text=True)
            commands = log.read_text()
            stages = [json.loads(line)["stage"] for line in (root / "logs/boot-stages.jsonl").read_text().splitlines()]
            return result, commands, stages

    def test_fresh_boot_prepares_model_then_starts_and_completes_hook(self):
        result, commands, stages = self.bootstrap(False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(commands.index("prepare-host-release.sh"), commands.index("start-release.sh"))
        self.assertIn("docker", commands)
        self.assertIn("exclusivity_passed", stages)
        self.assertIn("application_verified", stages)
        self.assertIn("complete-lifecycle-action", commands)

    def test_existing_backend_prevents_start_and_hook_completion(self):
        result, commands, stages = self.bootstrap(True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("start-release.sh", commands)
        self.assertNotIn("application_verified", stages)
        self.assertNotIn("complete-lifecycle-action", commands)
