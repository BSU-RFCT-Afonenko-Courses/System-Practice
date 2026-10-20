"""Реальные Git/CLI-пробы безопасной поставки release + локального patch."""
from pathlib import Path
import hashlib,json,subprocess,sys,tempfile,unittest
SCRIPT=Path(__file__).with_name('materialize-providers.py')
def digest(data):return hashlib.sha256(data).hexdigest()
def inv(files):return {n:{'sha256':digest(v),'size':len(v),'mode':420} for n,v in files.items()}
def snapshot(files):return digest(json.dumps(inv(files),sort_keys=True,separators=(',',':')).encode())
class Materialize(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)/'course';self.root.mkdir();self.repo=Path(self.temp.name)/'sources/core';self.repo.mkdir(parents=True)
  def git(*a):return subprocess.check_output(['git',*a],cwd=self.repo,text=True,stderr=subprocess.DEVNULL).strip()
  self.git=git;git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid')
  self.base={'_extension.yml':b'version: 1.0.0\n','entry.ts':b'base\n'}
  package=self.repo/'_extensions/course-core';package.mkdir(parents=True)
  for n,v in self.base.items():(package/n).write_bytes(v)
  git('add','.');git('commit','-qm','base');sha=git('rev-parse','HEAD');git('tag','v1.0.0')
  (package/'entry.ts').write_text('candidate\n');patch=subprocess.check_output(['git','diff','--','_extensions'],cwd=self.repo);git('checkout','--','_extensions')
  path=self.root/'tools/provider-patches/core.patch';path.parent.mkdir(parents=True);path.write_bytes(patch)
  self.new={**self.base,'entry.ts':b'candidate\n'}
  self.provider={'repository':'Example/core','checkout':'core','commit':sha,'version':'1.0.0','tag':'v1.0.0','sourceZip':'https://github.com/Example/core/archive/refs/tags/v1.0.0.zip','packages':{'course-core':['.','lectures']},'candidate':{'status':'local-unpublished','commit':'1'*40,'baseCommit':sha,'patch':'tools/provider-patches/core.patch','patchSha256':digest(patch),'packageHashes':{'course-core':snapshot(self.new)}}}
  self.manifest={'namespace':'Example','providers':{'core':self.provider}};self.save()
  info={'provider':'core','repository':'Example/core','commit':sha,'version':'1.0.0','tag':'v1.0.0','sourceZip':self.provider['sourceZip'],'scopes':['.','lectures'],'files':inv(self.base)}
  (self.root/'installed-packages.json').write_text(json.dumps({'schema':'course-template-packages-v1','packages':{'course-core':info}}))
  for scope in ['.','lectures']:
   d=self.root/scope/'_extensions/Example/course-core';d.mkdir(parents=True)
   for n,v in self.base.items():(d/n).write_bytes(v)
  self.target=self.root/'_extensions/Example/course-core';self.other=self.root/'lectures/_extensions/Example/course-core'
  unrelated=self.root/'_extensions/unrelated/theme.txt';unrelated.parent.mkdir();unrelated.write_text('preserve')
 def save(self):(self.root/'providers.json').write_text(json.dumps(self.manifest))
 def run_cli(self,mode):return subprocess.run([sys.executable,str(SCRIPT),'--course-root',str(self.root),'--providers-root',str(self.repo.parent),mode],capture_output=True,text=True,timeout=20)
 def test_patch_from_release_without_unpublished_object_and_repeat_are_exact(self):
  self.assertNotEqual(0,self.run_cli('--check').returncode)
  r=self.run_cli('--write');self.assertEqual(0,r.returncode,r.stderr)
  self.assertEqual(b'candidate\n',(self.target/'entry.ts').read_bytes());self.assertEqual(b'candidate\n',(self.other/'entry.ts').read_bytes())
  before=(self.root/'installed-packages.json').read_bytes();self.assertEqual(0,self.run_cli('--write').returncode);self.assertEqual(before,(self.root/'installed-packages.json').read_bytes());self.assertEqual(0,self.run_cli('--check').returncode)
  self.assertEqual('preserve',(self.root/'_extensions/unrelated/theme.txt').read_text())
 def test_local_edit_rejects_before_other_scope_changes(self):
  (self.other/'entry.ts').write_text('local edit\n');r=self.run_cli('--write');self.assertNotEqual(0,r.returncode);self.assertEqual(b'base\n',(self.target/'entry.ts').read_bytes());self.assertEqual('local edit\n',(self.other/'entry.ts').read_text())
 def test_symlink_target_rejected(self):
  (self.other/'entry.ts').unlink();(self.other/'entry.ts').symlink_to(self.target/'entry.ts');self.assertNotEqual(0,self.run_cli('--write').returncode);self.assertEqual(b'base\n',(self.target/'entry.ts').read_bytes())
 def test_patch_hash_rejects_before_write(self):
  (self.root/'tools/provider-patches/core.patch').write_text('tampered');self.assertNotEqual(0,self.run_cli('--write').returncode);self.assertEqual(b'base\n',(self.target/'entry.ts').read_bytes())
 def test_release_tag_pin_rejects_before_write(self):
  self.provider['commit']='0'*40;self.save();self.assertNotEqual(0,self.run_cli('--write').returncode);self.assertEqual(b'base\n',(self.target/'entry.ts').read_bytes())
 def test_check_rejects_unknown_file_and_never_writes(self):
  self.assertEqual(0,self.run_cli('--write').returncode);(self.other/'unknown.txt').write_text('user');r=self.run_cli('--check');self.assertNotEqual(0,r.returncode);self.assertEqual('user',(self.other/'unknown.txt').read_text())
 def test_check_rejects_recorded_release_provenance_drift(self):
  self.assertEqual(0,self.run_cli('--write').returncode)
  path=self.root/'installed-packages.json';info=json.loads(path.read_text());info['packages']['course-core']['tag']='v9.9.9';path.write_text(json.dumps(info))
  self.assertNotEqual(0,self.run_cli('--check').returncode)
if __name__=='__main__':unittest.main()
