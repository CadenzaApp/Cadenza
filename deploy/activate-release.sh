#!/bin/bash
# Candidate is a nonsecret env file; run as root on the single host.
set -euo pipefail
umask 077
cd /opt/cadenza
candidate=${1:?Pass a candidate release env file}
test -f "$candidate"
exec 3>&1
exec > logs/activate-release.log 2>&1
backup=$(mktemp -d /opt/cadenza/releases/activation.XXXXXX)
cp release.env "$backup/release.env"
cp "$candidate" "$backup/candidate.env"
# Download/validate before disturbing the running release.
cp release.env "$backup/original.env"
cp "$backup/candidate.env" release.env
if ! bash prepare-host-release.sh; then
    cp "$backup/original.env" release.env
    echo 'Candidate preparation failed; running release retained.' >&3
    exit 1
fi
cp "$backup/original.env" release.env
docker compose --env-file release.env stop backend
cp "$backup/candidate.env" release.env
if bash start-release.sh; then
    echo 'Release activation passed.' >&3
else
    docker compose --env-file release.env stop backend
    cp "$backup/original.env" release.env
    bash start-release.sh
    echo 'Candidate startup failed; previous release restored.' >&3
    exit 1
fi
