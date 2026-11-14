#!/bin/bash
# Run only on a tagged, non-serving image builder after the prewarm command ends.
set -euo pipefail
ulimit -c 0
sleep 10
cd /opt/cadenza
test -f bake.ready
test -z "$(docker ps -aq)"
test ! -f secrets/api.env
test ! -f secrets/ml.env
test ! -f /var/lib/docker/volumes/cadenza_model_cache/_data/token
test ! -f /var/lib/docker/volumes/cadenza_model_cache/_data/stored_tokens
# Stop agents before deleting their identity/command state.
systemctl stop snap.amazon-ssm-agent.amazon-ssm-agent.service 2>/dev/null || true
systemctl stop amazon-ssm-agent.service 2>/dev/null || true
systemctl stop docker.service docker.socket
rm -rf /var/lib/amazon/ssm/* /var/log/amazon/ssm/* /root/.aws /root/.docker /root/.cache
rm -rf /opt/cadenza/logs/* /opt/cadenza/secrets/* /tmp/* /var/tmp/*
rm -f /etc/ssh/ssh_host_* /root/.bash_history /home/ubuntu/.bash_history
cloud-init clean --logs --machine-id
# No containers remain to auto-start; only tools, image layers and model cache persist.
token=$(curl --fail --silent --max-time 5 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)
self=$(curl --fail --silent --max-time 5 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-id)
region=$(curl --fail --silent --max-time 5 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/placement/region)
aws ec2 create-tags --region "$region" --resources "$self" --tags Key=CadenzaBakeClean,Value=true >/dev/null
sync
shutdown -h now
