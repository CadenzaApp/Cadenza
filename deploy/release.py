"""Build and deploy a committed backend release from a developer workstation."""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent / "recovery"))
from provision import aws, ROOT, GROUP, ACCOUNT, PROFILE, REGION


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog="Needs Python 3, AWS CLI login and Docker Desktop/buildx. Current mode uses cold bootstrap; automated warm AMI baking is planned.",
    )
    parser.add_argument(
        "--tag",
        help="Optional unique ECR tag; default includes commit and UTC timestamp",
    )
    args = parser.parse_args()
    os.chdir(ROOT)
    if subprocess.check_output(["git", "status", "--porcelain"], text=True).strip():
        raise RuntimeError(
            "Commit or clean working-tree changes before cutting a release."
        )
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise RuntimeError("AWS profile points to the wrong workload account")
    run(["docker", "info"], stdout=subprocess.DEVNULL)
    tag = args.tag or "git-" + commit[:12] + "-" + datetime.datetime.now(
        datetime.timezone.utc
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
        f"Building {commit[:12]} for {ACCOUNT} / {REGION}. Deployment mode: cold bootstrap (warm AMI baking is not implemented yet).",
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
        r"^BACKEND_IMAGE=.*$", "BACKEND_IMAGE=" + reference, old_env, flags=re.M
    )
    before = aws(
        "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
    )["AutoScalingGroups"][0]["LaunchTemplate"]
    with tempfile.TemporaryDirectory(prefix="cadenza-release-") as directory:
        candidate_path = Path(directory) / "candidate.env"
        candidate_path.write_text(candidate)
        print(
            "Activating the candidate on the single backend; this briefly interrupts service.",
            flush=True,
        )
        run([sys.executable, "deploy/recovery/update-release.py", str(candidate_path)])
        canonical.write_text(candidate)
        try:
            print(
                "Promoting the verified release into replacement configuration.",
                flush=True,
            )
            run([sys.executable, "deploy/recovery/provision.py"])
            viewer = subprocess.check_output(
                [
                    "curl",
                    "--silent",
                    "--show-error",
                    "--max-time",
                    "20",
                    "--output",
                    "/dev/null",
                    "--write-out",
                    "%{http_code}",
                    "https://d1wj9jjqzhjpqq.cloudfront.net/health/ready",
                ],
                text=True,
            )
            if viewer == "403":
                print(
                    "Viewer check is restricted to the home allowlist; private startup/inference and ALB health checks passed."
                )
            elif viewer != "200":
                raise RuntimeError("External readiness returned HTTP " + viewer)

        except Exception:
            canonical.write_text(old_env)
            old_path = Path(directory) / "rollback.env"
            old_path.write_text(old_env)
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
            raise
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
        "warm_ami": None,
        "bootstrap_mode": "cold",
        "verified_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    directory = ROOT / "deploy/releases"
    directory.mkdir(exist_ok=True)
    (directory / (tag + ".json")).write_text(json.dumps(manifest, indent=2) + "\n")
    resource_path = ROOT / "deploy/recovery/resources.json"
    resources = json.loads(resource_path.read_text())
    resources.update(
        active_release_manifest="deploy/releases/" + tag + ".json",
        backend_image=reference,
        model_revision=manifest["model_revision"],
    )
    resource_path.write_text(json.dumps(resources, indent=2) + "\n")
    print(
        "\nRelease deployed: https://d1wj9jjqzhjpqq.cloudfront.net\nCommit the updated release settings, resource record and manifest.",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print("Release failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
