"""Build and deploy a committed backend release from a developer workstation."""

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11 or newer is required.")

sys.path.insert(0, str(Path(__file__).resolve().parent / "recovery"))
from provision import ACCOUNT, GROUP, PROFILE, REGION, ROOT, aws


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog="Needs Python 3.11+, AWS CLI login and Docker Desktop/buildx. Updates the existing instance and its replacement configuration without AMI baking. No CI runners required.",
    )
    parser.add_argument(
        "--tag",
        help="Optional unique ECR tag; default includes commit and UTC timestamp",
    )
    args = parser.parse_args()
    # Keep the workstation awake only for this release's lifetime.
    if sys.platform == "darwin" and os.environ.get("CADENZA_DEPLOY_AWAKE") != "1":
        env = dict(os.environ, CADENZA_DEPLOY_AWAKE="1")
        raise SystemExit(
            subprocess.run(
                ["caffeinate", "-i", sys.executable, *sys.argv], env=env, check=False
            ).returncode
        )
    os.chdir(ROOT)
    if subprocess.check_output(["git", "status", "--porcelain"], text=True).strip():
        raise RuntimeError(
            "Commit or clean working-tree changes before cutting a release."
        )
    run(
        [
            sys.executable,
            "deploy/recovery/update-release.py",
            "deploy/release.env.example",
            "--validate-only",
        ]
    )
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise RuntimeError("AWS profile points to the wrong workload account")
    run(["docker", "info"], stdout=subprocess.DEVNULL)
    tag = args.tag or "git-" + commit[:12] + "-" + datetime.datetime.now(
        datetime.UTC
    ).strftime("%Y%m%d%H%M%S")
    if not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,120}", tag):
        raise ValueError("Invalid image tag")
    build = dict(
        line.split("=", 1)
        for line in (ROOT / "deploy/build.env.example").read_text().splitlines()
        if line and not line.startswith("#")
    )
    local = "cadenza-backend:" + tag
    registry = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com"
    remote = registry + "/cadenza-backend:" + tag
    print(
        f"Building {commit[:12]} for {ACCOUNT} / {REGION}. Deployment mode: direct container update.",
        flush=True,
    )
    command = [
        "docker",
        "buildx",
        "build",
        "--platform",
        "linux/arm64",
        "--label",
        "org.opencontainers.image.revision=" + commit,
    ]
    for name in ("UV", "RUST", "PYTHON"):
        command += [
            "--build-arg",
            name + "_IMAGE=" + build["CADENZA_" + name + "_IMAGE"],
        ]
    run(command + ["-f", "deploy/backend.Dockerfile", "-t", local, "--load", "."])
    run(
        [
            "docker",
            "run",
            "--rm",
            "--entrypoint",
            "python",
            local,
            "-c",
            "import torch; from sentence_transformers import SentenceTransformer; assert torch.version.cuda is None",
        ]
    )
    # --config uses a fresh registry config, so preserve Docker Desktop's endpoint.
    docker_host = (
        os.environ.get("DOCKER_HOST")
        or subprocess.check_output(
            ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
            text=True,
        ).strip()
    )
    password = subprocess.check_output(
        ["aws", "ecr", "get-login-password", "--profile", PROFILE, "--region", REGION],
        text=True,
    )
    with tempfile.TemporaryDirectory(prefix="cadenza-registry-") as config:
        run(
            [
                "docker",
                "--config",
                config,
                "login",
                "--username",
                "AWS",
                "--password-stdin",
                registry,
            ],
            input=password,
            stdout=subprocess.DEVNULL,
        )
        run(["docker", "tag", local, remote])
        run(["docker", "--host", docker_host, "--config", config, "push", remote])
    image = aws(
        "ecr",
        "describe-images",
        repositoryName="cadenza-backend",
        imageIds=[{"imageTag": tag}],
    )["imageDetails"][0]
    reference = registry + "/cadenza-backend@" + image["imageDigest"]
    canonical = ROOT / "deploy/release.env.example"
    old_env = canonical.read_text()
    candidate = re.sub(
        r"^BACKEND_IMAGE=.*$", "BACKEND_IMAGE=" + reference, old_env, flags=re.MULTILINE
    )
    resource_path = ROOT / "deploy/recovery/resources.json"
    before_resources = resource_path.read_text()
    before = aws(
        "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
    )["AutoScalingGroups"][0]["LaunchTemplate"]
    before = {key: before[key] for key in ("LaunchTemplateId", "Version")}
    with tempfile.TemporaryDirectory(prefix="cadenza-release-") as directory:
        candidate_path = Path(directory) / "candidate.env"
        candidate_path.write_text(candidate, encoding="utf-8", newline="\n")
        print(
            "Activating the candidate on the single backend; this briefly interrupts service.",
            flush=True,
        )
        run([sys.executable, "deploy/recovery/update-release.py", str(candidate_path)])
        canonical.write_text(candidate, encoding="utf-8", newline="\n")
        try:
            print(
                "Promoting the verified release into replacement configuration.",
                flush=True,
            )
            run([sys.executable, "deploy/recovery/provision.py"])
            try:
                with urllib.request.urlopen(
                    "https://d1wj9jjqzhjpqq.cloudfront.net/health/ready", timeout=20
                ) as response:
                    viewer = str(response.status)
            except urllib.error.HTTPError as error:
                viewer = str(error.code)
            if (
                viewer == "403"
                and json.loads(before_resources).get("viewer_access") != "public"
            ):
                print(
                    "Viewer check is restricted to the home allowlist; private startup/inference and ALB health checks passed."
                )
            elif viewer != "200":
                raise RuntimeError("External readiness returned HTTP " + viewer)

        except Exception:
            canonical.write_text(old_env, encoding="utf-8", newline="\n")
            old_path = Path(directory) / "rollback.env"
            old_path.write_text(old_env, encoding="utf-8", newline="\n")
            aws(
                "autoscaling",
                "update-auto-scaling-group",
                AutoScalingGroupName=GROUP,
                LaunchTemplate=before,
                HealthCheckType="ELB",
            )
            aws(
                "ec2",
                "modify-launch-template",
                LaunchTemplateId=before["LaunchTemplateId"],
                DefaultVersion=before["Version"],
            )
            run([sys.executable, "deploy/recovery/update-release.py", str(old_path)])
            resource_path.write_text(before_resources, encoding="utf-8", newline="\n")
            raise
    # Monitoring has its own health result; it must not roll back a healthy API.
    monitoring_verified = False
    try:
        host = next(
            i["InstanceId"]
            for i in aws(
                "autoscaling",
                "describe-auto-scaling-groups",
                AutoScalingGroupNames=[GROUP],
            )["AutoScalingGroups"][0]["Instances"]
            if i["LifecycleState"] == "InService"
        )
        command = aws(
            "ssm",
            "send-command",
            DocumentName="AWS-RunShellScript",
            InstanceIds=[host],
            Parameters={
                "commands": ["python3 /opt/cadenza/monitoring/verify.py"],
                "executionTimeout": ["300"],
            },
        )["Command"]["CommandId"]
        for _ in range(60):
            time.sleep(3)
            try:
                result = aws(
                    "ssm", "get-command-invocation", CommandId=command, InstanceId=host
                )
            except RuntimeError as error:
                if "InvocationDoesNotExist" in str(error):
                    continue
                raise
            if result["Status"] not in ("Pending", "InProgress", "Delayed"):
                monitoring_verified = result["Status"] == "Success"
                break
    except (RuntimeError, StopIteration):
        pass
    if not monitoring_verified:
        print(
            "API deployed, but monitoring verification failed. Inspect private EC2 monitoring logs before relying on the dashboard.",
            flush=True,
        )
    manifest = {
        "source_commit": commit,
        "tag": tag,
        "image": reference,
        "release_env_sha256": hashlib.sha256(candidate.encode()).hexdigest(),
        "launch_template": aws(
            "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
        )["AutoScalingGroups"][0]["LaunchTemplate"],
        "model_revision": dict(
            line.split("=", 1)
            for line in candidate.splitlines()
            if line and not line.startswith("#")
        )["MODEL_REVISION"],
        "platform": "linux/arm64",
        "viewer_http_status": int(viewer),
        "base_ami": json.loads(resource_path.read_text())["cold_base_ami"],
        "bootstrap_mode": "cold",
        "monitoring_verified": monitoring_verified,
        "verified_at_utc": datetime.datetime.now(datetime.UTC).isoformat(),
    }
    directory = ROOT / "deploy/releases"
    directory.mkdir(exist_ok=True)
    (directory / (tag + ".json")).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    resource_path = ROOT / "deploy/recovery/resources.json"
    resources = json.loads(resource_path.read_text())
    resources.update(
        active_release_manifest="deploy/releases/" + tag + ".json",
        backend_image=reference,
        model_revision=manifest["model_revision"],
    )
    resource_path.write_text(json.dumps(resources, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(
        f"\nRelease deployed: https://d1wj9jjqzhjpqq.cloudfront.net\nReplacement bootstrap: pinned base image, no AMI baking\nCommit the updated release settings, resource record and manifest.",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except (
        RuntimeError,
        OSError,
        ValueError,
        TimeoutError,
        subprocess.CalledProcessError,
    ) as error:
        print("Release failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
