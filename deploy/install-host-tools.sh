#!/bin/bash
# Run as root through SSM. Contains no application secrets.
set -euo pipefail
umask 077
install -d -m 700 /opt/cadenza /opt/cadenza/logs /opt/cadenza/secrets
exec 3>&1
exec > /opt/cadenza/logs/install-host-tools.log 2>&1
trap 'echo "Host tool installation failed; private log retained on EC2." >&3' ERR
echo "Installing host tools." >&3
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl unzip python3
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<'SOURCES'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: arm64
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
apt-get update
apt-get install -y docker-ce='5:29.9.3-1~ubuntu.24.04~noble' docker-ce-cli='5:29.9.3-1~ubuntu.24.04~noble' containerd.io='2.4.2-3~ubuntu.24.04~noble' docker-buildx-plugin='0.38.1-1~ubuntu.24.04~noble' docker-compose-plugin='5.7.1-1~ubuntu.24.04~noble'
systemctl enable --now docker
if ! command -v aws >/dev/null 2>&1; then
    curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-aarch64-2.40.1.zip -o /tmp/cadenza-aws.zip
    unzip -q /tmp/cadenza-aws.zip -d /tmp/cadenza-aws
    /tmp/cadenza-aws/aws/install
    rm -rf /tmp/cadenza-aws /tmp/cadenza-aws.zip
fi
/usr/local/bin/aws --version >&3
docker --version >&3
docker compose version >&3
uname -m >&3
free -m >&3
df -h / >&3
echo "Host tools installed." >&3
