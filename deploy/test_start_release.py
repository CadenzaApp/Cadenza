"""Exercise the real startup script with fake Docker/curl; never contact AWS."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json,sys
from pathlib import Path
p=Path('scenario.json'); s=json.loads(p.read_text()); a=sys.argv[1:]
if a[0]=='inspect':
    field=a[2]; previous=not s.get('activated',False)
    if 'RestartCount' in field: print(s['before'] if previous else s['after'])
    elif 'State.Status' in field: print(s.get('state','running'))
    elif 'Health.Status' in field: print('healthy')
elif 'ps' in a: print('old' if '--all' in a else s.get('id','old'))
elif 'up' in a: s['activated']=True; p.write_text(json.dumps(s))
elif 'stop' in a: Path('stopped').touch()
'''

class StartupTests(unittest.TestCase):
    def run_case(self, before, after, expected, **extra):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'logs').mkdir(); (root/'bin').mkdir()
            (root/'check-embedding.py').write_text('')
            (root/'scenario.json').write_text(json.dumps(dict(before=before,after=after,**extra)))
            for name,content in [('docker',FAKE_DOCKER),('curl','#!/bin/sh\nexit 0\n')]:
                p=root/'bin'/name;p.write_text(content);p.chmod(0o755)
            source=Path(__file__).with_name('start-release.sh').read_text()
            script=root/'start.sh';script.write_text(source.replace('cd /opt/cadenza','cd '+shlex.quote(str(root))))
            result=subprocess.run(['bash',str(script)],env={**os.environ,'PATH':str(root/'bin')+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
            self.assertEqual(result.returncode,expected,result.stdout+result.stderr)
            self.assertEqual((root/'stopped').exists(),expected!=0)

    def test_historical_restarts_are_accepted(self): self.run_case(4,4,0)
    def test_new_restart_is_rejected(self): self.run_case(4,5,1)
    def test_replacement_container_has_its_own_baseline(self): self.run_case(4,1,1,id='replacement')
    def test_non_running_container_is_rejected(self): self.run_case(0,0,1,state='exited')
    def test_clean_new_container_is_accepted(self): self.run_case(0,0,0,id='replacement')

if __name__=='__main__': unittest.main()
