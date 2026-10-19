"""Реальные Git-состояния поставки сопровождения, воспроизводимость и сохранение правок."""
import json,os,shutil,subprocess,sys,tempfile,unittest,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from build_maintenance_materials import build

class MaintenanceMaterials(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='maintenance materials ');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        seed=self.root/'tasks/projects/project-maintenance/seed.json';seed.parent.mkdir(parents=True);shutil.copyfile(Path(__file__).resolve().parents[1]/'tasks/projects/project-maintenance/seed.json',seed)
    def unpack(self):
        build(self.root,write=True)
        with zipfile.ZipFile(self.root/'tasks/materials/project-maintenance-start.zip') as z:z.extractall(self.root/'inspect') # Owned deterministic fixture only.
        return self.root/'inspect/maintenance'
    def git(self,repo,*args,ok=True):
        env={**os.environ,'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_AUTHOR_NAME':'Test','GIT_AUTHOR_EMAIL':'test@example.invalid','GIT_COMMITTER_NAME':'Test','GIT_COMMITTER_EMAIL':'test@example.invalid'}
        p=subprocess.run(['git','--no-optional-locks',*args],cwd=repo,env=env,capture_output=True)
        if ok:self.assertEqual(0,p.returncode,p.stderr.decode())
        return p
    def test_repeated_build_is_identical_and_does_not_touch_mtime(self):
        first=build(self.root,write=True);before={n:((self.root/n).read_bytes(),(self.root/n).stat().st_mtime_ns) for n in first}
        self.assertEqual(first,build(self.root,write=True));self.assertEqual(first,build(self.root,write=False))
        self.assertEqual(before,{n:((self.root/n).read_bytes(),(self.root/n).stat().st_mtime_ns) for n in first})
    def test_actual_fetch_conflict_and_patch_keep_their_declared_boundaries(self):
        base=self.unpack();w=base/'work';shared=base/'shared.git'
        self.assertEqual(b'',self.git(w,'status','--porcelain').stdout)
        self.assertEqual(b'refs/heads/main\n',self.git(w,'symbolic-ref','HEAD').stdout)
        self.assertEqual(b'',self.git(w,'remote').stdout)
        self.assertEqual(b'true\n',self.git(shared,'rev-parse','--is-bare-repository').stdout)
        start=self.git(w,'rev-parse','HEAD').stdout
        self.git(w,'remote','add','origin','../shared.git');self.git(w,'fetch','origin')
        self.assertEqual(start,self.git(w,'rev-parse','HEAD').stdout)
        self.assertEqual(self.git(w,'rev-parse','base').stdout,self.git(w,'merge-base','main','origin/main').stdout)
        fail=self.git(w,'merge','--no-edit','origin/main',ok=False)
        self.assertNotEqual(0,fail.returncode);self.assertIn(b'UU report.ini',self.git(w,'status','--porcelain').stdout)
        self.assertEqual(start,self.git(w,'rev-parse','HEAD').stdout);self.git(w,'merge','--abort')
        self.git(w,'switch','-c','review-note','base');before=(w/'instructions.txt').read_bytes()
        self.git(w,'apply','--check','../incoming/review.patch');self.assertEqual(before,(w/'instructions.txt').read_bytes())
        self.git(w,'apply','../incoming/review.patch');self.assertEqual('Проверьте входные данные.\nСохраните признак качества.\n'.encode(),(w/'instructions.txt').read_bytes())
        self.assertEqual(self.git(w,'rev-parse','base').stdout,self.git(w,'rev-parse','HEAD').stdout)
    def test_demo_continues_latency_N_and_receives_U_without_local_U_ref(self):
        build(self.root,write=True)
        with zipfile.ZipFile(self.root/'practice/materials/project-maintenance-demo.zip') as z:z.extractall(self.root/'demo')
        base=self.root/'demo/maintenancelab';w=base/'work';shared=base/'shared.git'
        state=json.loads((self.root/'tasks/projects/project-maintenance/initial-state.json').read_text())['practice/materials/project-maintenance-demo.zip']
        self.assertIn('history',state)
        self.assertEqual({'A','B','C','S','T','M','N','U'},set(state['history']))
        ids=state['history'];self.assertEqual(ids['N'],self.git(w,'rev-parse','HEAD').stdout.decode().strip())
        self.assertEqual(ids['T']+' '+ids['S'],self.git(w,'show','-s','--format=%P',ids['M']).stdout.decode().strip())
        self.assertEqual(ids['M'],self.git(w,'show','-s','--format=%P',ids['N']).stdout.decode().strip())
        self.assertEqual({'README.md','criteria.txt','measurements.tsv'},set(self.git(w,'ls-tree','--name-only','HEAD').stdout.decode().splitlines()))
        self.assertEqual(b'latency_limit = 0.020 s\n',(w/'criteria.txt').read_bytes())
        self.assertEqual(b'sensor\tlatency_ms\nnorth\t8\nsouth\t18\n',(w/'measurements.tsv').read_bytes())
        self.assertEqual(7,len((w/'README.md').read_text().splitlines()))
        self.assertNotIn(ids['U'],self.git(w,'show-ref').stdout.decode())
        self.assertEqual(ids['U'],self.git(shared,'rev-parse','HEAD').stdout.decode().strip())
        self.assertEqual(ids['N'],self.git(shared,'show','-s','--format=%P','HEAD').stdout.decode().strip())
        self.git(w,'remote','add','origin','../shared.git');self.git(w,'fetch','origin');self.git(w,'merge','--ff-only','origin/main')
        self.assertIn('Обе задержки не превышают порог 0.020 s.',(w/'CHECKS.md').read_text())
        before=(w/'README.md').read_bytes();self.git(w,'apply','--check','../incoming/guide.patch');self.assertEqual(before,(w/'README.md').read_bytes())
        self.git(w,'apply','../incoming/guide.patch')
        self.assertEqual(before+'Перед сравнением с порогом переведите миллисекунды в секунды.\n'.encode(),(w/'README.md').read_bytes())
    def test_private_configuration_and_host_paths_are_absent(self):
        base=self.unpack()
        for r in [base/'work',base/'shared.git']:
            config=self.git(r,'config','--local','--list').stdout
            for item in [b'user.',b'remote.',b'include.',str(self.root).encode()]:self.assertNotIn(item,config)
            gd=r/'.git' if (r/'.git').exists() else r
            self.assertFalse((gd/'hooks').exists());self.assertFalse((gd/'objects/info/alternates').exists())
    def test_seed_root_cannot_escape_the_private_build_directory(self):
        seed=self.root/'tasks/projects/project-maintenance/seed.json';data=json.loads(seed.read_text());outside=self.root/'outside'
        data['practice/materials/project-maintenance-demo.zip']['root']=str(outside);seed.write_text(json.dumps(data))
        with self.assertRaises(ValueError):build(self.root,write=True)
        self.assertFalse(outside.exists())
    def test_all_outputs_preflight_preserves_a_local_edit(self):
        with self.assertRaises(ValueError):build(self.root,write=False)
        self.assertFalse((self.root/'practice').exists())
        build(self.root,write=True);other=self.root/'practice/materials/project-maintenance-demo.zip';before=other.read_bytes()
        edited=self.root/'tasks/materials/project-maintenance-start.zip';edited.write_bytes(b'local edit')
        with self.assertRaises(ValueError):build(self.root,write=True)
        self.assertEqual(b'local edit',edited.read_bytes());self.assertEqual(before,other.read_bytes())
if __name__=='__main__':unittest.main()
