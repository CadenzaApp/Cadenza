"""Large AWS requests use closed UTF-8 files, not shell quoting or long argv."""

import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import provision


class AwsCliTests(unittest.TestCase):
    def test_large_request_is_readable_during_call_and_removed_afterwards(self):
        payload = {"commands": ["print('hello')\n" * 4000]}
        paths = []

        def invoke(command, **kwargs):
            self.assertLess(sum(map(len, command)), 2000)
            path = Path(command[-1].removeprefix("file://"))
            paths.append(path)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), payload)
            self.assertEqual(kwargs["encoding"], "utf-8")
            self.assertEqual(kwargs["env"]["AWS_PAGER"], "")
            return Mock(returncode=0, stdout='{"ok":true}', stderr="")

        with patch.object(provision.subprocess, "run", side_effect=invoke):
            self.assertEqual(provision.aws("ssm", "send-command", **payload), {"ok": True})
        self.assertFalse(paths[0].exists())

    def test_failed_cli_call_raises_and_removes_temporary_request(self):
        paths = []

        def invoke(command, **kwargs):
            paths.append(Path(command[-1].removeprefix("file://")))
            return Mock(returncode=1, stdout="", stderr="AccessDenied")

        with patch.object(provision.subprocess, "run", side_effect=invoke):
            with self.assertRaisesRegex(RuntimeError, "AccessDenied"):
                provision.aws("ssm", "send-command", commands=["safe script"])
        self.assertFalse(paths[0].exists())
