"""Exercise EC2 maintenance cleanup even when its parent is killed."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

@unittest.skipIf(os.name == 'nt', 'Linux host script')
class MaintenanceTests(unittest.TestCase):
    def exercise(self, activation):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'bin').mkdir()
            (root/'activate-release.sh').write_text(activation)
            stubs = {
                'aws': 'echo "$*" >> events',
                'systemd-run': 'echo armed >> events',
                'systemctl': 'if [ "$1" != list-units ]; then echo disarmed >> events; fi',
                'flock': 'exit 0', 'sleep': 'exit 0',
            }
            for name, code in stubs.items():
                p=root/'bin'/name; p.write_text('#!/bin/bash\n'+code+'\n');p.chmod(0o755)
            source=Path(__file__).with_name('maintenance-release.sh').read_text().replace('/opt/cadenza', str(root)).replace('/run/cadenza-release.lock',str(root/'lock'))
            result=subprocess.run(['bash','-c',source,'maintenance','us-west-1','group','candidate'], env=dict(os.environ,PATH=str(root/'bin')+':'+os.environ['PATH']), capture_output=True)
            return result.returncode,(root/'events').read_text().splitlines()

    def test_restores_health_after_success_and_failure(self):
        for code in (0,1):
            status,events=self.exercise('exit '+str(code))
            self.assertEqual(status,code)
            self.assertEqual(events[0],'armed')
            self.assertTrue(events[1].endswith('EC2'))
            self.assertTrue(events[-2].endswith('ELB'))
            self.assertEqual(events[-1],'disarmed')

    def test_hard_kill_leaves_independent_deadline_armed(self):
        status,events=self.exercise('kill -9 "$PPID"')
        self.assertNotEqual(status,0)
        self.assertEqual(events[0],'armed')
        self.assertTrue(events[1].endswith('EC2'))
        self.assertNotIn('disarmed',events)

class ImageRetentionTests(unittest.TestCase):
    def test_only_unprotected_backend_images_are_removed(self):
        spec=importlib.util.spec_from_file_location('prune',Path(__file__).with_name('prune-images.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'release.env').write_text('BACKEND_IMAGE=repo@new\n')
            (root/'rollback.env').write_text('BACKEND_IMAGE=repo@previous\n')
            def output(args):
                if args[:3]==['docker','image','inspect']: return {'repo@new':'new','repo@previous':'previous'}[args[-1]]
                if args[:2]==['docker','ps']: return 'container'
                if args[:2]==['docker','inspect']: return 'referenced'
                return 'new\nprevious\nreferenced\nobsolete\n'
            with patch.object(module,'output',side_effect=output),patch.object(module.subprocess,'run') as remove:
                module.prune(root)
                remove.assert_called_once_with(['docker','image','rm','obsolete'],check=True)
