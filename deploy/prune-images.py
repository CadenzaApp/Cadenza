"""Retain the active, previous-release and container-referenced backend images on EC2."""
import subprocess
from pathlib import Path


def output(args):
    return subprocess.check_output(args, text=True).strip()


def prune(root=Path('/opt/cadenza')):
    protected = set()
    images = []
    for name in ('release.env', 'rollback.env'):
        values = dict(line.split('=', 1) for line in (root / name).read_text().splitlines()
                      if line and not line.startswith('#'))
        images.append(values['BACKEND_IMAGE'])
    # Fail closed if either protected release cannot be resolved locally.
    for image in images:
        protected.add(output(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]))
    containers = output(['docker', 'ps', '-aq']).split()
    if containers:
        protected.update(output(['docker', 'inspect', '--format', '{{.Image}}', *containers]).split())
    repository = images[0].split('@', 1)[0]
    candidates = set(output(['docker', 'image', 'ls', '--no-trunc', '--quiet', repository]).split())
    for image in sorted(candidates - protected):
        # Never force deletion of an image used by a concurrent container.
        subprocess.run(['docker', 'image', 'rm', image], check=True)


if __name__ == '__main__':
    prune()
