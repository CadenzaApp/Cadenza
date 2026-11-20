"""Candidate validation never contacts AWS or reads credentials."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "update_release", Path(__file__).with_name("update-release.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CandidateTests(unittest.TestCase):
    def test_release_settings_are_accepted(self):
        module.validate_candidate(
            (Path(__file__).parents[1] / "release.env.example").read_text()
        )

    def test_secrets_unknown_keys_and_duplicates_are_rejected(self):
        base = "BACKEND_IMAGE=image\nMODEL_REVISION=revision\n"
        for extra in ["DATABASE_URL=secret", "UNKNOWN=1", "BACKEND_IMAGE=other"]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                module.validate_candidate(base + extra)

    def test_invalid_limits_are_rejected(self):
        base = "BACKEND_IMAGE=image\nMODEL_REVISION=revision\n"
        for value in ["0", "-1", "bad", "1.5", "1000001"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.validate_candidate(base + "TAG_PROVIDER_CALLS_PER_DAY=" + value)
