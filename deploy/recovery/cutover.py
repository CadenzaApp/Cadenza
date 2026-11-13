"""Move the existing single backend behind the ALB, then attach it to the ASG."""

import json
import subprocess
import time

from provision import aws, ROOT, GROUP


def wait(description, condition, timeout=1200):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(20)
    raise TimeoutError(description)


def main():
    path = ROOT / "deploy/recovery/resources.json"
    r = json.loads(path.read_text())
    wait(
        "ALB private origin deployment",
        lambda: (
            aws("cloudfront", "get-vpc-origin", Id=r["vpc_origin_id"])["VpcOrigin"][
                "Status"
            ]
            == "Deployed"
        ),
    )
    health = aws(
        "elbv2", "describe-target-health", TargetGroupArn=r["target_group_arn"]
    )["TargetHealthDescriptions"]
    if len(health) != 1 or health[0]["TargetHealth"]["State"] != "healthy":
        raise RuntimeError("Expected exactly one healthy target")
    previous = aws("cloudfront", "get-distribution-config", Id="ED64SQL5BYVBQ")
    backup = ROOT / "deploy/history/cloudfront-before-alb.json"
    if not backup.exists():
        backup.write_text(json.dumps(previous, indent=2) + "\n")
    config = previous["DistributionConfig"]
    origin = config["Origins"]["Items"][0]
    old = origin["VpcOriginConfig"]["VpcOriginId"]
    origin["VpcOriginConfig"]["VpcOriginId"] = r["vpc_origin_id"]
    origin["DomainName"] = r["load_balancer_dns"]
    config["Comment"] = "Cadenza single backend; private ALB origin and home-only HTTPS"
    if old != r["vpc_origin_id"]:
        aws(
            "cloudfront",
            "update-distribution",
            Id="ED64SQL5BYVBQ",
            IfMatch=previous["ETag"],
            DistributionConfig=config,
        )
    wait(
        "CloudFront distribution deployment",
        lambda: (
            aws("cloudfront", "get-distribution", Id="ED64SQL5BYVBQ")["Distribution"][
                "Status"
            ]
            == "Deployed"
        ),
    )
    for endpoint in ("health/ready", "health/live", "test"):
        subprocess.run(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--max-time",
                "20",
                "https://d1wj9jjqzhjpqq.cloudfront.net/" + endpoint,
            ],
            check=True,
        )
    aws(
        "ec2",
        "modify-instance-attribute",
        InstanceId=r["current_instance"],
        Groups=[r["backend_security_group"]],
    )
    group = aws(
        "autoscaling", "describe-auto-scaling-groups", AutoScalingGroupNames=[GROUP]
    )["AutoScalingGroups"][0]
    if not group["Instances"]:
        aws(
            "autoscaling",
            "attach-instances",
            AutoScalingGroupName=GROUP,
            InstanceIds=[r["current_instance"]],
        )
    aws(
        "autoscaling",
        "update-auto-scaling-group",
        AutoScalingGroupName=GROUP,
        MinSize=1,
        MaxSize=1,
        DesiredCapacity=1,
        HealthCheckType="ELB",
        HealthCheckGracePeriod=120,
    )
    (ROOT / "deploy/cloudfront-distribution.json").write_text(
        json.dumps(config, indent=2) + "\n"
    )
    r = {
        **json.loads(path.read_text()),
        **{key: r[key] for key in ["vpc_origin_id", "current_instance"]},
    }
    r["cutover_complete"] = True
    r["notifications_topic"] = (
        "arn:aws:sns:us-west-2:175220118767:cadenza-demo-instance-events"
    )
    path.write_text(json.dumps(r, indent=2) + "\n")
    if old != r["vpc_origin_id"]:
        old_config = aws("cloudfront", "get-vpc-origin", Id=old)
        aws("cloudfront", "delete-vpc-origin", Id=old, IfMatch=old_config["ETag"])
    print("\nALB cutover and capacity-one ASG activation passed")


if __name__ == "__main__":
    main()
