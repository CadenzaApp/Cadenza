"""Create and validate a private warm AMI on non-serving, model-only builder hosts."""

import argparse
import base64
import datetime
import gzip
import hashlib
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "recovery"))
from provision import ACCOUNT, GROUP, REGION, ROOT, SETTINGS, allow, aws, policy

ROLE = SETTINGS["builder_role"]


def wait(description, condition, seconds=1800):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = condition()
        if result:
            return result
        time.sleep(10)
    raise TimeoutError(description)


def online(host):
    rows = aws(
        "ssm",
        "describe-instance-information",
        Filters=[{"Key": "InstanceIds", "Values": [host]}],
    )["InstanceInformationList"]
    return bool(rows and rows[0]["PingStatus"] == "Online")


def command(host, script):
    return aws(
        "ssm",
        "send-command",
        DocumentName="AWS-RunShellScript",
        InstanceIds=[host],
        Parameters={
            "commands": ["bash <<'AMI_COMMAND'\n" + script + "\nAMI_COMMAND"],
            "executionTimeout": ["1800"],
        },
    )["Command"]["CommandId"]


def completed(host, identifier):
    try:
        r = aws("ssm", "get-command-invocation", CommandId=identifier, InstanceId=host)
    except RuntimeError as error:
        if "InvocationDoesNotExist" in str(error):
            return False
        raise
    if r["Status"] in ("Pending", "InProgress", "Delayed"):
        return False
    if r["Status"] != "Success":
        raise RuntimeError("AMI validation failed; inspect private builder logs")
    return r


def userdata(files, tail):
    script = "#!/bin/bash\nset -euo pipefail\numask 077\nulimit -c 0\nswapoff -a\nmkdir -p /opt/cadenza/logs /opt/cadenza/secrets\nrm -f /opt/cadenza/bake.ready /opt/cadenza/bake.failed\ntrap 'touch /opt/cadenza/bake.failed' ERR\nexec > /opt/cadenza/logs/bake.log 2>&1\n"
    for name, data in files.items():
        script += (
            "printf '%s' '"
            + base64.b64encode(gzip.compress(data, mtime=0)).decode()
            + "' | base64 -d | gzip -d > /opt/cadenza/"
            + name
            + "\n"
        )
    script += "cd /opt/cadenza\n" + tail
    assert len(script.encode()) < 16384
    return base64.b64encode(script.encode()).decode()


def launch_model_host(host, sg, ami, data):
    return aws(
        "ec2",
        "run-instances",
        ImageId=ami,
        InstanceType="t4g.medium",
        MinCount=1,
        MaxCount=1,
        IamInstanceProfile={"Name": ROLE},
        NetworkInterfaces=[
            {
                "DeviceIndex": 0,
                "SubnetId": host["SubnetId"],
                "AssociatePublicIpAddress": True,
                "Groups": [sg],
                "DeleteOnTermination": True,
            }
        ],
        BlockDeviceMappings=[
            {
                "DeviceName": host["RootDeviceName"],
                "Ebs": {
                    "VolumeSize": 16,
                    "VolumeType": "gp3",
                    "Encrypted": True,
                    "DeleteOnTermination": True,
                },
            }
        ],
        MetadataOptions={"HttpTokens": "required", "HttpPutResponseHopLimit": 1},
        CreditSpecification={"CpuCredits": "standard"},
        UserData=data,
        TagSpecifications=[
            {
                "ResourceType": "instance",
                "Tags": [
                    {"Key": "Project", "Value": "Cadenza"},
                    {"Key": "CadenzaImageBuilder", "Value": "true"},
                ],
            }
        ],
    )["Instances"][0]["InstanceId"]


def ensure(image, revision):
    if not re.fullmatch(
        rf"{ACCOUNT}\.dkr\.ecr\.{REGION}\.amazonaws\.com/cadenza-backend@sha256:[0-9a-f]{{64}}",
        image,
    ):
        raise ValueError(
            "Baking requires an immutable digest in the workload ECR repository"
        )
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Baking requires a pinned 40-character model revision")
    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise RuntimeError("AWS profile points to the wrong workload account")
    resources = ROOT / "deploy/recovery/resources.json"
    r = json.loads(resources.read_text())
    groups = aws(
        "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
    )["AutoScalingGroups"]
    members = groups[0]["Instances"] if groups else []
    current = next(
        (m["InstanceId"] for m in members if m["LifecycleState"] == "InService"), None
    )
    if current is None:
        if groups and members:
            raise RuntimeError("Wait for replacement to finish before baking")
        current = SETTINGS["seed_instance"]
    host = aws("ec2", "describe-instances", InstanceIds=[current])["Reservations"][0][
        "Instances"
    ][0]
    base = r.get("cold_base_ami", host["ImageId"])
    r["cold_base_ami"] = base
    resources.write_text(json.dumps(r, indent=2) + "\n")
    inputs = {
        name: (ROOT / "deploy" / name).read_bytes()
        for name in [
            "install-host-tools.sh",
            "ec2-bootstrap.sh",
            "ami/prewarm.py",
            "ami/sanitize.sh",
            "ami/read-startup-files.py",
            "ami/prefetch-startup.py",
        ]
    }
    key = hashlib.sha256(
        json.dumps(
            {
                "image": image,
                "model": revision,
                "base": base,
                "files": {n: hashlib.sha256(d).hexdigest() for n, d in inputs.items()},
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    existing = aws(
        "ec2",
        "describe-images",
        Owners=["self"],
        Filters=[
            {"Name": "tag:CadenzaBakeKey", "Values": [key]},
            {"Name": "state", "Values": ["available"]},
            {"Name": "tag:CadenzaValidated", "Values": ["true"]},
        ],
    )["Images"]
    if existing:
        ami = existing[0]
        record_path = ROOT / "deploy/ami/records" / (ami["ImageId"] + ".json")
        if not record_path.exists():
            raise RuntimeError(
                "Validated AMI has no local validation record: " + ami["ImageId"]
            )
        record = json.loads(record_path.read_text())
        if not (
            record.get("validated")
            and record["bake_key"] == key
            and record["backend_image"] == image
            and record["model_revision"] == revision
        ):
            raise RuntimeError(
                "AMI validation record does not match the requested release"
            )
        print("Reusing validated warm AMI " + ami["ImageId"], flush=True)
        return record
    trust = policy(
        [
            {
                "Effect": "Allow",
                "Principal": {"Service": "ec2.amazonaws.com"},
                "Action": "sts:AssumeRole",
            }
        ]
    )
    try:
        aws("iam", "get-role", RoleName=ROLE)
    except RuntimeError as error:
        if "NoSuchEntity" not in str(error):
            raise
        aws("iam", "create-role", RoleName=ROLE, AssumeRolePolicyDocument=trust)
    aws(
        "iam",
        "attach-role-policy",
        RoleName=ROLE,
        PolicyArn="arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
    )
    ml = f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/cadenza/demo/ml"
    statements = [
        {
            "Effect": "Deny",
            "Action": [
                "ssm:GetParameter",
                "ssm:GetParameters",
                "ssm:GetParametersByPath",
            ],
            "NotResource": ml,
        },
        allow("ssm:GetParameter", ml),
        allow("ecr:GetAuthorizationToken", "*"),
        allow(
            [
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
            ],
            f"arn:aws:ecr:{REGION}:{ACCOUNT}:repository/cadenza-backend",
        ),
        {
            **allow("ec2:CreateTags", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/*"),
            "Condition": {
                "StringEquals": {"ec2:ResourceTag/CadenzaImageBuilder": "true"},
                "ForAllValues:StringEquals": {"aws:TagKeys": ["CadenzaBakeClean"]},
            },
        },
    ]
    aws(
        "iam",
        "put-role-policy",
        RoleName=ROLE,
        PolicyName="model-only-bake",
        PolicyDocument=policy(statements),
    )
    try:
        aws("iam", "get-instance-profile", InstanceProfileName=ROLE)
    except RuntimeError as error:
        if "NoSuchEntity" not in str(error):
            raise
        aws("iam", "create-instance-profile", InstanceProfileName=ROLE)
        aws(
            "iam",
            "add-role-to-instance-profile",
            InstanceProfileName=ROLE,
            RoleName=ROLE,
        )
        time.sleep(15)
    groups = aws(
        "ec2",
        "describe-security-groups",
        Filters=[
            {"Name": "group-name", "Values": [ROLE]},
            {"Name": "vpc-id", "Values": [host["VpcId"]]},
        ],
    )["SecurityGroups"]
    sg = (
        groups[0]["GroupId"]
        if groups
        else aws(
            "ec2",
            "create-security-group",
            GroupName=ROLE,
            Description="No inbound; non-serving model image builder",
            VpcId=host["VpcId"],
        )["GroupId"]
    )

    builder = None
    validator = None
    ami_id = None
    try:
        files = {Path(n).name: d for n, d in inputs.items()}
        builder = launch_model_host(
            host,
            sg,
            base,
            userdata(
                files,
                "bash ec2-bootstrap.sh\nbash install-host-tools.sh\npython3 prewarm.py "
                + image
                + " "
                + revision
                + " "
                + key
                + " "
                + base
                + "\n",
            ),
        )
        print("Non-serving image builder: " + builder, flush=True)
        wait("Builder SSM registration", lambda: online(builder), 600)
        ready_script = "if [ -f /opt/cadenza/bake.failed ]; then exit 42; fi; test -f /opt/cadenza/bake.ready"
        end = time.monotonic() + 1800
        while time.monotonic() < end:
            cid = command(builder, ready_script)
            time.sleep(5)
            result = aws(
                "ssm", "get-command-invocation", CommandId=cid, InstanceId=builder
            )
            if result["Status"] == "Success":
                break
            if result.get("ResponseCode") == 42:
                raise RuntimeError(
                    "Builder preparation failed; no release was promoted"
                )
            time.sleep(15)
        else:
            raise TimeoutError("Builder did not prewarm; inspect its private bake log")
        print("Model inference passed; sanitizing the non-serving builder.", flush=True)
        command(
            builder,
            "systemd-run --unit=cadenza-image-sanitize --on-active=5s /bin/bash /opt/cadenza/sanitize.sh",
        )

        def clean_stopped():
            row = aws("ec2", "describe-instances", InstanceIds=[builder])[
                "Reservations"
            ][0]["Instances"][0]
            tags = {t["Key"]: t["Value"] for t in row.get("Tags", [])}
            return (
                row["State"]["Name"] == "stopped"
                and tags.get("CadenzaBakeClean") == "true"
            )

        wait("Sanitized builder shutdown", clean_stopped, 300)
        ami_id = aws(
            "ec2",
            "create-image",
            InstanceId=builder,
            Name="cadenza-warm-" + key[:20],
            Description="Private model/image cache; no application secrets or containers",
            TagSpecifications=[
                {
                    "ResourceType": "image",
                    "Tags": [
                        {"Key": "Project", "Value": "Cadenza"},
                        {"Key": "CadenzaBakeKey", "Value": key},
                    ],
                }
            ],
        )["ImageId"]
        print("Snapshotting sanitized AMI: " + ami_id, flush=True)
        wait(
            "AMI availability",
            lambda: (
                aws("ec2", "describe-images", ImageIds=[ami_id])["Images"][0]["State"]
                == "available"
            ),
            2400,
        )
        print("Booting a separate host for offline cache validation.", flush=True)
        validator = launch_model_host(
            host,
            sg,
            ami_id,
            userdata(
                {}, "bash ec2-bootstrap.sh\ntouch /opt/cadenza/validation.ready\n"
            ),
        )
        wait("AMI validation SSM registration", lambda: online(validator), 600)
        validation = """set -euo pipefail
cd /opt/cadenza
test ! -f secrets/api.env
test ! -f secrets/ml.env
test -z "$(docker ps -aq)"
python3 prefetch-startup.py
python3 - <<'OFFLINE'
import json,subprocess,math
m=json.load(open('prewarm.json'))
program='from sentence_transformers import SentenceTransformer; import sys,math; m=SentenceTransformer("google/embeddinggemma-300m",revision=sys.argv[1],local_files_only=True,device="cpu");v=m.encode_document("Warm cache verification");assert len(v)==768 and all(math.isfinite(float(x)) for x in v)'
subprocess.run(['docker','run','--rm','--pull','never','--network','none','--entrypoint','python','-e','HF_HUB_OFFLINE=1','-e','OMP_NUM_THREADS=1','-v','cadenza_model_cache:/cache/huggingface',m['image'],'-c',program,m['model_revision']],check=True)
print('AMI validation passed: no containers/secrets; offline finite 768-dimensional inference')
OFFLINE
"""
        cid = command(validator, validation)
        result = wait("Offline AMI validation", lambda: completed(validator, cid), 600)
        record = {
            "image_id": ami_id,
            "builder_instance": builder,
            "validation_instance": validator,
            "validated_at_utc": datetime.datetime.now(datetime.UTC).isoformat(),
            "bake_key": key,
            "cold_base_ami": base,
            "backend_image": image,
            "model_revision": revision,
            "validation_command": cid,
            "validation_result": result["StandardOutputContent"].strip(),
            "validated": True,
            "startup_prefetch": "targeted-python-model-v1",
        }
        directory = ROOT / "deploy/ami/records"
        directory.mkdir(exist_ok=True)
        (directory / (ami_id + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        aws(
            "ec2",
            "create-tags",
            Resources=[ami_id],
            Tags=[{"Key": "CadenzaValidated", "Value": "true"}],
        )
        print("Validated warm AMI: " + ami_id, flush=True)
        return record
    except BaseException:
        if ami_id:
            details = aws("ec2", "describe-images", ImageIds=[ami_id])["Images"][0]
            aws("ec2", "deregister-image", ImageId=ami_id)
            (ROOT / "deploy/ami/records" / (ami_id + ".json")).unlink(missing_ok=True)
            for device in details.get("BlockDeviceMappings", []):
                if "Ebs" in device:
                    aws(
                        "ec2", "delete-snapshot", SnapshotId=device["Ebs"]["SnapshotId"]
                    )
        raise
    finally:
        ids = [i for i in [builder, validator] if i]
        if ids:
            aws("ec2", "terminate-instances", InstanceIds=ids)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--image", required=True)
    p.add_argument("--model-revision", required=True)
    a = p.parse_args()
    result = ensure(a.image, a.model_revision)
    print("Validation record: deploy/ami/records/" + result["image_id"] + ".json")
