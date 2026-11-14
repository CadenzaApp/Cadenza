#!/bin/bash
# Fresh hosts prepare their image/cache, then start only after old hosts are gone.
set -euo pipefail
cd /opt/cadenza
region=$(python3 -c 'from pathlib import Path; v=dict(l.split("=",1) for l in Path("release.env").read_text().splitlines() if l and not l.startswith("#")); print(v["BACKEND_IMAGE"].split(".")[3])')
stage() { printf '{"stage":"%s","at_utc":"%s"}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)" >> logs/boot-stages.jsonl; }
stage bootstrap_started
prefetch_pid=
warm=false
if [ -f prewarm.json ]; then
    # Wait for the boot-time daemon before inspecting its cached image/volume.
    systemctl start docker
    stage docker_ready
fi
if python3 - <<'WARM'
import json,subprocess
from pathlib import Path
try:
    expected=dict(line.split('=',1) for line in Path('release.env').read_text().splitlines() if line and not line.startswith('#'))
    baked=json.loads(Path('prewarm.json').read_text())
    assert baked['image']==expected['BACKEND_IMAGE'] and baked['model_revision']==expected['MODEL_REVISION'] and baked['model_validated']
    subprocess.run(['docker','image','inspect',expected['BACKEND_IMAGE']],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    volume=json.loads(subprocess.check_output(['docker','volume','inspect','cadenza_model_cache']))[0]['Mountpoint']
    assert (Path(volume)/'hub/models--google--embeddinggemma-300m/snapshots'/expected['MODEL_REVISION']).is_dir()
except (OSError,ValueError,KeyError,AssertionError,subprocess.CalledProcessError):
    raise SystemExit(1)
WARM
then warm=true; fi
if [ "$warm" = true ]; then
    echo 'Using validated prewarmed tools/image/model cache.'
    export CADENZA_WARM_START=1
    (
        stage targeted_prefetch_started
        python3 prefetch-startup.py
        stage targeted_prefetch_finished
    ) > logs/targeted-prefetch.log 2>&1 &
    prefetch_pid=$!
else
    bash ec2-bootstrap.sh
    bash install-host-tools.sh
fi
stage cache_checked
# Secrets are always fresh; registry/image identity is still verified.
bash prepare-host-release.sh
stage secrets_and_image_ready
if [ "$warm" != true ]; then
    docker compose --env-file release.env run --rm --no-deps -e HF_HUB_OFFLINE=0 backend python -c 'import os; from sentence_transformers import SentenceTransformer; SentenceTransformer("google/embeddinggemma-300m", revision=os.environ["MODEL_REVISION"], token=os.environ["HF_TOKEN"], device="cpu")'
fi
token=$(curl --fail --silent --max-time 5 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 300' http://169.254.169.254/latest/api/token)
self=$(curl --fail --silent --max-time 5 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-id)
exclusive=false
for attempt in $(seq 1 120); do
    aws ec2 describe-instances --region "$region" --filters Name=tag:CadenzaBackend,Values=demo Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down --query 'Reservations[].Instances[].InstanceId' --output json > /run/cadenza-backend-hosts.json
    if python3 - "$self" <<'CHECK'
import json,sys
raise SystemExit(0 if set(json.load(open('/run/cadenza-backend-hosts.json'))) == {sys.argv[1]} else 1)
CHECK
    then exclusive=true; break; fi
    sleep 10
done
test "$exclusive" = true
python3 - "$self" <<'RECORD'
import datetime,json,sys
from pathlib import Path
Path('logs/startup-exclusivity.json').write_text(json.dumps({'instance_id':sys.argv[1], 'observed_hosts':json.load(open('/run/cadenza-backend-hosts.json')), 'verified_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}))
RECORD
stage exclusivity_passed
if [ -n "$prefetch_pid" ] && ! wait "$prefetch_pid"; then
    stage targeted_prefetch_failed_fallback
    echo 'Targeted prefetch failed; continuing normal verified startup.'
fi
stage application_starting
CADENZA_BOOTSTRAP_INFERENCE_TIMEOUT=300 bash start-release.sh
stage application_verified
aws autoscaling complete-lifecycle-action --region "$region" --auto-scaling-group-name cadenza-demo-single --lifecycle-hook-name cadenza-ready --instance-id "$self" --lifecycle-action-result CONTINUE
stage lifecycle_completed
touch bootstrap.ready
