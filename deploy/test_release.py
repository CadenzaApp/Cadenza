"""Exercise release promotion and rollback without Docker, AWS or credentials."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def exercise(self, fail=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / "deploy/recovery").mkdir(parents=True)
        original = "BACKEND_IMAGE=old-image\nMODEL_REVISION=model\n"
        env = root / "deploy/release.env.example"
        env.write_text(original)
        (root / "deploy/build.env.example").write_text("CADENZA_UV_IMAGE=uv\nCADENZA_RUST_IMAGE=rust\nCADENZA_PYTHON_IMAGE=python\n")
        resources = root / "deploy/recovery/resources.json"
        resources.write_text(json.dumps({"cold_base_ami": "ami-base", "viewer_access": "public"}))
        original_resources = resources.read_text()
        calls = []
        launch = {"LaunchTemplateId": "lt-one", "Version": "5"}

        def aws(service, operation, **kwargs):
            calls.append((service, operation, kwargs))
            if (service, operation) == ("sts", "get-caller-identity"):
                return {"Account": release.ACCOUNT}
            if (service, operation) == ("ecr", "describe-images"):
                return {"imageDetails": [{"imageDigest": "sha256:new"}]}
            if (service, operation) == ("autoscaling", "describe-auto-scaling-groups"):
                return {"AutoScalingGroups": [{"LaunchTemplate": dict(launch), "Instances": [{"InstanceId": "i-serving", "LifecycleState": "InService"}]}]}
            if (service, operation) == ("autoscaling", "update-auto-scaling-group"):
                launch.update(kwargs["LaunchTemplate"])
                return {}
            if (service, operation) == ("ec2", "modify-launch-template"):
                return {}
            if (service, operation) == ("ssm", "send-command"):
                return {"Command": {"CommandId": "command"}}
            if (service, operation) == ("ssm", "get-command-invocation"):
                return {"Status": "Success"}
            raise AssertionError((service, operation))

        def check_output(command, **kwargs):
            if command[:3] == ["git", "status", "--porcelain"]:
                return ""
            if command[:3] == ["git", "rev-parse", "HEAD"]:
                return "a" * 40
            if command[:3] == ["docker", "context", "inspect"]:
                return "unix:///docker.sock"
            if command[:3] == ["aws", "ecr", "get-login-password"]:
                return "test-password"
            raise AssertionError(command)

        def run(command, **kwargs):
            calls.append(("run", list(command)))
            if "deploy/recovery/update-release.py" in command and "--validate-only" not in command:
                content = Path(command[-1]).read_text()
                calls.append(("activate", content))
                if fail == "activation":
                    raise RuntimeError("activation failed")
            if "deploy/recovery/provision.py" in command:
                if fail == "promotion":
                    raise RuntimeError("promotion failed")
                launch["Version"] = "6"
                resources.write_text(json.dumps({"cold_base_ami": "ami-base", "bootstrap_mode": "cold"}))

        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.status = 503 if fail == "viewer" else 200
        with patch.object(release.urllib.request, "urlopen", return_value=response), patch.object(release, "ROOT", root), patch.object(release, "aws", side_effect=aws), patch.object(release, "run", side_effect=run), patch.object(release.os, "chdir"), patch.object(release.subprocess, "check_output", side_effect=check_output), patch.object(release.time, "sleep"), patch.object(release.sys, "argv", ["release.py"]), patch.dict(os.environ, {"CADENZA_DEPLOY_AWAKE": "1"}), contextlib.redirect_stdout(io.StringIO()):
            if fail:
                with self.assertRaises(RuntimeError):
                    release.main()
                self.assertEqual(env.read_text(), original)
                self.assertEqual(resources.read_text(), original_resources)
                self.assertEqual(launch["Version"], "5")
            else:
                release.main()
                manifest = json.loads(next((root / "deploy/releases").glob("*.json")).read_text())
                self.assertEqual(manifest["bootstrap_mode"], "cold")
                self.assertEqual(manifest["base_ami"], "ami-base")
                self.assertEqual(manifest["launch_template"]["Version"], "6")
                self.assertTrue(manifest["monitoring_verified"])
                self.assertNotIn("warm_ami", manifest)
                self.assertIn("sha256:new", env.read_text())
                commands = [call[1] for call in calls if call[0] == "run"]
                self.assertTrue(any(command[-1] == "deploy/recovery/provision.py" for command in commands))
                self.assertFalse(any("bake" in str(command) or "--warm-ami-manifest" in command for command in commands))
        return calls

    def test_direct_release_promotes_latest_digest_without_baking(self):
        self.exercise()

    def test_activation_failure_does_not_publish_candidate(self):
        calls = self.exercise("activation")
        self.assertEqual(sum(call[0] == "activate" for call in calls), 1)

    def test_promotion_failure_restores_previous_template_and_release(self):
        calls = self.exercise("promotion")
        self.assertEqual([call[1] for call in calls if call[0] == "activate"][-1], "BACKEND_IMAGE=old-image\nMODEL_REVISION=model\n")

    def test_failed_external_check_rolls_back_promoted_template(self):
        self.exercise("viewer")
