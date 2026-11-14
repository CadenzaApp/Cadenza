"""Prepare a private ALB, target group and single-instance ASG launch template."""

import base64
import hashlib
import io
import json
import os
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GROUP = "cadenza-demo-single"
SETTINGS = json.loads((ROOT / "deploy/aws-config.json").read_text())
REGION = SETTINGS["region"]
ACCOUNT = SETTINGS["account"]
PROFILE = os.environ.get("CADENZA_AWS_PROFILE", SETTINGS["profile"])


def aws(service, operation, **args):
    cmd = [
        "aws",
        service,
        operation,
        "--profile",
        PROFILE,
        "--region",
        REGION,
        "--output",
        "json",
    ]
    if args:
        cmd += ["--cli-input-json", json.dumps(args)]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(f"{service} {operation}: {result.stderr.strip()}")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def policy(statements):
    return json.dumps({"Version": "2012-10-17", "Statement": statements})


def allow(actions, resources):
    return {"Effect": "Allow", "Action": actions, "Resource": resources}


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--warm-ami-manifest", type=Path)
    args = parser.parse_args()
    warm = (
        json.loads(args.warm_ami_manifest.read_text())
        if args.warm_ami_manifest
        else None
    )
    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise RuntimeError("AWS profile points to the wrong workload account")
    if warm:
        settings = dict(
            line.split("=", 1)
            for line in (ROOT / "deploy/release.env.example").read_text().splitlines()
            if line and not line.startswith("#")
        )
        if not (
            warm.get("validated")
            and warm["backend_image"] == settings["BACKEND_IMAGE"]
            and warm["model_revision"] == settings["MODEL_REVISION"]
        ):
            raise RuntimeError(
                "Warm AMI validation does not match this image/model release"
            )
        found = aws(
            "ec2", "describe-images", ImageIds=[warm["image_id"]], Owners=["self"]
        )["Images"][0]
        tags = {tag["Key"]: tag["Value"] for tag in found.get("Tags", [])}
        if (
            found["State"] != "available"
            or found.get("Public")
            or tags.get("CadenzaValidated") != "true"
            or tags.get("CadenzaBakeKey") != warm["bake_key"]
        ):
            raise RuntimeError(
                "Expected the private, available, validated AMI in the manifest"
            )
    groups = aws(
        "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
    )["AutoScalingGroups"]
    members = groups[0]["Instances"] if groups else []
    if members and not any(m["LifecycleState"] == "InService" for m in members):
        raise RuntimeError(
            "Wait for replacement to finish before changing the launch template"
        )
    current = next(
        (m["InstanceId"] for m in members if m["LifecycleState"] == "InService"),
        SETTINGS["seed_instance"],
    )
    host = aws("ec2", "describe-instances", InstanceIds=[current])["Reservations"][0][
        "Instances"
    ][0]
    if host["State"]["Name"] != "running":
        raise RuntimeError("Expected a running current host")
    vpc = host["VpcId"]

    def security_group(name, description):
        rows = aws(
            "ec2",
            "describe-security-groups",
            Filters=[
                {"Name": "group-name", "Values": [name]},
                {"Name": "vpc-id", "Values": [vpc]},
            ],
        )["SecurityGroups"]
        return (
            rows[0]["GroupId"]
            if rows
            else aws(
                "ec2",
                "create-security-group",
                GroupName=name,
                Description=description,
                VpcId=vpc,
            )["GroupId"]
        )

    alb_sg = security_group("cadenza-demo-alb", "CloudFront private origin to ALB")
    backend_sg = security_group("cadenza-demo-backend", "ALB to the single backend")
    for group, source in [
        (alb_sg, SETTINGS["cloudfront_security_group"]),
        (backend_sg, alb_sg),
    ]:
        try:
            aws(
                "ec2",
                "authorize-security-group-ingress",
                GroupId=group,
                IpPermissions=[
                    {
                        "IpProtocol": "tcp",
                        "FromPort": 80,
                        "ToPort": 80,
                        **(
                            {"PrefixListIds": [{"PrefixListId": source}]}
                            if source.startswith("pl-")
                            else {"UserIdGroupPairs": [{"GroupId": source}]}
                        ),
                    }
                ],
            )
        except RuntimeError as error:
            if "InvalidPermission.Duplicate" not in str(error):
                raise
    lbs = aws("elbv2", "describe-load-balancers")["LoadBalancers"]
    lb = next(
        (item for item in lbs if item["LoadBalancerName"] == "cadenza-demo-single"),
        None,
    )
    if not lb:
        lb = aws(
            "elbv2",
            "create-load-balancer",
            Name="cadenza-demo-single",
            Scheme="internal",
            Type="application",
            IpAddressType="ipv4",
            Subnets=[host["SubnetId"], SETTINGS["second_alb_subnet"]],
            SecurityGroups=[alb_sg],
            Tags=[{"Key": "Project", "Value": "Cadenza"}],
        )["LoadBalancers"][0]
    groups = aws("elbv2", "describe-target-groups")["TargetGroups"]
    target = next(
        (item for item in groups if item["TargetGroupName"] == "cadenza-demo-single"),
        None,
    )
    health = dict(
        HealthCheckProtocol="HTTP",
        HealthCheckPort="traffic-port",
        HealthCheckPath="/health/ready",
        HealthCheckIntervalSeconds=5,
        HealthCheckTimeoutSeconds=4,
        HealthyThresholdCount=2,
        UnhealthyThresholdCount=3,
        Matcher={"HttpCode": "200"},
    )
    if not target:
        target = aws(
            "elbv2",
            "create-target-group",
            Name="cadenza-demo-single",
            Protocol="HTTP",
            Port=80,
            VpcId=vpc,
            TargetType="instance",
            **health,
        )["TargetGroups"][0]
    else:
        aws(
            "elbv2",
            "modify-target-group",
            TargetGroupArn=target["TargetGroupArn"],
            **health,
        )
    aws(
        "elbv2",
        "modify-target-group-attributes",
        TargetGroupArn=target["TargetGroupArn"],
        Attributes=[{"Key": "deregistration_delay.timeout_seconds", "Value": "30"}],
    )
    listeners = aws(
        "elbv2", "describe-listeners", LoadBalancerArn=lb["LoadBalancerArn"]
    )["Listeners"]
    if not listeners:
        aws(
            "elbv2",
            "create-listener",
            LoadBalancerArn=lb["LoadBalancerArn"],
            Protocol="HTTP",
            Port=80,
            DefaultActions=[
                {"Type": "forward", "TargetGroupArn": target["TargetGroupArn"]}
            ],
        )
    aws(
        "ec2",
        "create-tags",
        Resources=[host["InstanceId"]],
        Tags=[{"Key": "CadenzaBackend", "Value": "demo"}],
    )
    # Keep the old private path during the CloudFront migration, then remove it.
    aws(
        "ec2",
        "modify-instance-attribute",
        InstanceId=host["InstanceId"],
        Groups=list({backend_sg, *[g["GroupId"] for g in host["SecurityGroups"]]}),
    )
    aws(
        "elbv2",
        "register-targets",
        TargetGroupArn=target["TargetGroupArn"],
        Targets=[{"Id": host["InstanceId"], "Port": 80}],
    )
    files = [
        "ec2-bootstrap.sh",
        "compose.yaml",
        "certs/supabase-root.cer",
        "release.env.example",
        "fetch-secrets.py",
        "prepare-host-release.sh",
        "start-release.sh",
        "check-embedding.py",
        "observe-startup.py",
        "install-host-tools.sh",
        "activate-release.sh",
        "ami/read-startup-files.py",
        "ami/prefetch-startup.py",
    ]
    bundle = io.BytesIO()
    with tarfile.open(fileobj=bundle, mode="w:gz") as archive:
        for name in files:
            content = (ROOT / "deploy" / name).read_bytes()
            item = tarfile.TarInfo(
                "release.env" if name == "release.env.example" else Path(name).name
            )
            item.size = len(content)
            item.mode = 0o644 if name.endswith(".cer") else 0o600
            archive.addfile(item, io.BytesIO(content))
        content = (ROOT / "deploy/recovery/bootstrap-start.sh").read_bytes()
        item = tarfile.TarInfo("bootstrap-start.sh")
        item.size = len(content)
        item.mode = 0o600
        archive.addfile(item, io.BytesIO(content))
    userdata = "#!/bin/bash\nset -euo pipefail\numask 077\nmkdir -p /opt/cadenza/logs /opt/cadenza/releases /opt/cadenza/secrets\nchmod 700 /opt/cadenza /opt/cadenza/secrets\nexec > /opt/cadenza/logs/bootstrap.log 2>&1\n"
    userdata += (
        "printf '%s' '"
        + base64.b64encode(bundle.getvalue()).decode()
        + "' | base64 -d | tar xz -C /opt/cadenza\ncd /opt/cadenza\nbash bootstrap-start.sh\n"
    )
    assert len(userdata.encode()) < 16384
    data = {
        "ImageId": warm["image_id"]
        if warm
        else json.loads((ROOT / "deploy/recovery/resources.json").read_text()).get(
            "cold_base_ami", host["ImageId"]
        ),
        "InstanceType": "t4g.medium",
        "IamInstanceProfile": {"Arn": host["IamInstanceProfile"]["Arn"]},
        "NetworkInterfaces": [
            {
                "DeviceIndex": 0,
                "AssociatePublicIpAddress": True,
                "Groups": [backend_sg],
                "DeleteOnTermination": True,
            }
        ],
        "BlockDeviceMappings": [
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
        "MetadataOptions": {
            "HttpTokens": "required",
            "HttpEndpoint": "enabled",
            "HttpPutResponseHopLimit": 1,
        },
        "CreditSpecification": {"CpuCredits": "standard"},
        "UserData": base64.b64encode(userdata.encode()).decode(),
        "TagSpecifications": [
            {
                "ResourceType": "instance",
                "Tags": [
                    {"Key": "Project", "Value": "Cadenza"},
                    {"Key": "CadenzaBackend", "Value": "demo"},
                    {"Key": "Name", "Value": "cadenza-demo-single"},
                ],
            }
        ],
    }
    templates = aws(
        "ec2",
        "describe-launch-templates",
        Filters=[{"Name": "launch-template-name", "Values": [GROUP]}],
    )["LaunchTemplates"]
    if templates:
        version = aws(
            "ec2",
            "create-launch-template-version",
            LaunchTemplateName=GROUP,
            LaunchTemplateData=data,
        )["LaunchTemplateVersion"]
        launch = {
            "LaunchTemplateId": version["LaunchTemplateId"],
            "Version": str(version["VersionNumber"]),
        }
    else:
        template = aws(
            "ec2",
            "create-launch-template",
            LaunchTemplateName=GROUP,
            LaunchTemplateData=data,
        )["LaunchTemplate"]
        launch = {"LaunchTemplateId": template["LaunchTemplateId"], "Version": "1"}
    settings = dict(
        AutoScalingGroupName=GROUP,
        LaunchTemplate=launch,
        HealthCheckType="ELB",
        HealthCheckGracePeriod=120,
        InstanceMaintenancePolicy={
            "MinHealthyPercentage": 0,
            "MaxHealthyPercentage": 100,
        },
    )
    if groups:
        aws("autoscaling", "update-auto-scaling-group", **settings)
    else:
        # Provision a destination without starting a second application backend.
        aws(
            "autoscaling",
            "create-auto-scaling-group",
            **settings,
            MinSize=0,
            MaxSize=1,
            DesiredCapacity=0,
            VPCZoneIdentifier=host["SubnetId"],
            Tags=[{"Key": "Project", "Value": "Cadenza", "PropagateAtLaunch": True}],
        )
        aws(
            "autoscaling",
            "suspend-processes",
            AutoScalingGroupName=GROUP,
            ScalingProcesses=["AZRebalance"],
        )
    aws(
        "autoscaling",
        "put-lifecycle-hook",
        AutoScalingGroupName=GROUP,
        LifecycleHookName="cadenza-ready",
        LifecycleTransition="autoscaling:EC2_INSTANCE_LAUNCHING",
        HeartbeatTimeout=3600,
        DefaultResult="ABANDON",
    )
    aws(
        "ec2",
        "modify-launch-template",
        LaunchTemplateId=launch["LaunchTemplateId"],
        DefaultVersion=launch["Version"],
    )
    aws(
        "autoscaling",
        "attach-load-balancer-target-groups",
        AutoScalingGroupName=GROUP,
        TargetGroupARNs=[target["TargetGroupArn"]],
    )
    aws(
        "iam",
        "put-role-policy",
        RoleName=SETTINGS["runtime_role"],
        PolicyName="single-host-bootstrap",
        PolicyDocument=policy(
            [
                allow("ec2:DescribeInstances", "*"),
                allow(
                    "autoscaling:CompleteLifecycleAction",
                    f"arn:aws:autoscaling:{REGION}:{ACCOUNT}:autoScalingGroup:*:autoScalingGroupName/{GROUP}",
                ),
            ]
        ),
    )
    topic = aws("sns", "create-topic", Name="cadenza-demo-instance-events")["TopicArn"]
    aws(
        "autoscaling",
        "put-notification-configuration",
        AutoScalingGroupName=GROUP,
        TopicARN=topic,
        NotificationTypes=[
            "autoscaling:EC2_INSTANCE_LAUNCH",
            "autoscaling:EC2_INSTANCE_TERMINATE",
            "autoscaling:EC2_INSTANCE_LAUNCH_ERROR",
            "autoscaling:EC2_INSTANCE_TERMINATE_ERROR",
        ],
    )
    record = {
        "group": GROUP,
        "region": REGION,
        "notifications_topic": topic,
        "warm_ami": warm,
        "disk_initialization_enabled": False,
        "draining_seconds": 30,
        "load_balancer_arn": lb["LoadBalancerArn"],
        "load_balancer_dns": lb["DNSName"],
        "target_group_arn": target["TargetGroupArn"],
        "alb_security_group": alb_sg,
        "backend_security_group": backend_sg,
        "launch_template": launch,
        "bootstrap_sha256": hashlib.sha256(bundle.getvalue()).hexdigest(),
        "health_path": "/health/ready",
        "health_interval_seconds": 5,
        "health_timeout_seconds": 4,
        "unhealthy_threshold": 3,
        "healthy_threshold": 2,
        "current_instance": host["InstanceId"],
    }
    existing = ROOT / "deploy/recovery/resources.json"
    if existing.exists():
        record = {**json.loads(existing.read_text()), **record}
    (ROOT / "deploy/recovery/resources.json").write_text(
        json.dumps(record, indent=2) + "\n"
    )
    print(json.dumps(record))


if __name__ == "__main__":
    main()
