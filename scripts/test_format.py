"""The shared formatter runs native tools directly on either workstation OS."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("formatter", Path(__file__).with_name("format.py"))
formatter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(formatter)


class FormatterTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cadenza formatter ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        package = self.root / "client-app/node_modules/prettier"
        package.mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"bin": {"prettier": "bin/prettier.cjs"}}))

    def test_check_invokes_cargo_and_node_without_shell_shims_or_writes(self):
        with patch.object(formatter, "ROOT", self.root), patch.object(formatter.sys, "argv", ["format.py", "--check"]), patch.object(formatter.subprocess, "run") as run:
            self.assertEqual(formatter.main(), 0)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(commands[0], ["cargo", "fmt", "--manifest-path", str(self.root / "backend-api/Cargo.toml"), "--check"])
        self.assertEqual(commands[1], ["node", str(self.root / "client-app/node_modules/prettier/bin/prettier.cjs"), str(self.root / "client-app"), "--check"])
        for call in run.call_args_list:
            self.assertEqual(call.kwargs["cwd"], self.root)
            self.assertNotIn("shell", call.kwargs)

    def test_default_formats_instead_of_checking(self):
        with patch.object(formatter, "ROOT", self.root), patch.object(formatter.sys, "argv", ["format.py"]), patch.object(formatter.subprocess, "run") as run:
            self.assertEqual(formatter.main(), 0)
        self.assertNotIn("--check", run.call_args_list[0].args[0])
        self.assertEqual(run.call_args_list[1].args[0][-1], "--write")

    def test_cargo_failure_blocks_push_without_running_prettier(self):
        with patch.object(formatter, "ROOT", self.root), patch.object(formatter.sys, "argv", ["format.py", "--check"]), patch.object(formatter.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "cargo")) as run, contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(formatter.main(), 1)
        self.assertEqual(run.call_count, 1)
        self.assertIn("python3 scripts/format.py", errors.getvalue())
        self.assertIn("py -3 scripts/format.py", errors.getvalue())
