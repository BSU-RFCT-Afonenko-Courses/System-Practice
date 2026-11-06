"""Git/CLI-проверки содержимого и путей установки packages."""
from pathlib import Path
from system_support import Provider, ProviderManifest
import json,subprocess,sys,tempfile,unittest
SCRIPT=Path(__file__).with_name('materialize-providers.py')
class Materialize(unittest.TestCase):
 def setUp(self) -> None:
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)/'course';self.root.mkdir();self.repo=Path(self.temp.name)/'sources/core';self.repo.mkdir(parents=True)
  def git(*a: str) -> str:return subprocess.check_output(['git',*a],cwd=self.repo,text=True,stderr=subprocess.DEVNULL).strip()
  self.git=git;git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid')
  self.base={'_extension.yml':b'version: 1.0.0\n','entry.ts':b'base\n'}
  package=self.repo/'_extensions/course-core';package.mkdir(parents=True)
  for n,v in self.base.items():(package/n).write_bytes(v)
  git('add','.');git('commit','-qm','base');sha=git('rev-parse','HEAD');git('tag','v1.0.0')
  (package/'entry.ts').write_text('candidate\n');patch=subprocess.check_output(['git','diff','--','_extensions'],cwd=self.repo);git('checkout','--','_extensions')
  path=self.root/'tools/provider-patches/core.patch';path.parent.mkdir(parents=True);path.write_bytes(patch)
  self.new={**self.base,'entry.ts':b'candidate\n'}
  self.provider: Provider = {'repository':'Example/core','checkout':'core','commit':sha,'version':'1.0.0','tag':'v1.0.0','sourceZip':'https://github.com/Example/core/archive/refs/tags/v1.0.0.zip','packages':{'course-core':['.','lectures']},'candidate':{'status':'local-unpublished','commit':'1'*40,'baseCommit':sha,'patch':'tools/provider-patches/core.patch'}}
  self.manifest: ProviderManifest = {'namespace':'Example','providers':{'core':self.provider}};self.save()
  for scope in ['.','lectures']:
   d=self.root/scope/'_extensions/Example/course-core';d.mkdir(parents=True)
   for n,v in self.base.items():(d/n).write_bytes(v)
  self.target=self.root/'_extensions/Example/course-core';self.other=self.root/'lectures/_extensions/Example/course-core'
  unrelated=self.root/'_extensions/unrelated/theme.txt';unrelated.parent.mkdir();unrelated.write_text('preserve')
 def save(self) -> None:(self.root/'providers.json').write_text(json.dumps(self.manifest))
 def run_cli(self, mode: str) -> subprocess.CompletedProcess[str]:return subprocess.run([sys.executable,'-B',str(SCRIPT),'--course-root',str(self.root),'--providers-root',str(self.repo.parent),mode],capture_output=True,text=True,timeout=20)
 def test_installs_release_patch_to_scopes_and_preserves_other_packages(self) -> None:
  r=self.run_cli('--write');self.assertEqual(0,r.returncode,r.stderr)
  self.assertEqual(b'candidate\n',(self.target/'entry.ts').read_bytes());self.assertEqual(b'candidate\n',(self.other/'entry.ts').read_bytes())
  self.assertEqual('preserve',(self.root/'_extensions/unrelated/theme.txt').read_text())
 def test_symlink_scope_rejected_before_other_scope_changes(self) -> None:
  import shutil
  shutil.rmtree(self.root/'lectures');(self.root/'lectures').symlink_to(self.target,target_is_directory=True)
  self.assertNotEqual(0,self.run_cli('--write').returncode)
  self.assertEqual(b'base\n',(self.target/'entry.ts').read_bytes())
 def test_missing_git_source_rejected_before_write(self) -> None:
  self.provider['commit']='0'*40;self.save();self.assertNotEqual(0,self.run_cli('--write').returncode)
  self.assertEqual(b'base\n',(self.target/'entry.ts').read_bytes())
 def test_release_can_bundle_packages_with_distinct_descriptor_versions(self) -> None:
  ui=self.repo/'_extensions/course-ui';ui.mkdir();(ui/'_extension.yml').write_text('version: 0.8.0\n');(ui/'entry.ts').write_text('ui release\n')
  self.git('add','.');self.git('commit','-qm','mixed package versions');self.git('tag','-f','v1.0.0')
  self.provider.pop('candidate');self.provider['commit']=self.git('rev-parse','HEAD');self.provider['packages']['course-ui']=['.'];self.save()
  r=self.run_cli('--write');self.assertEqual(0,r.returncode,r.stderr)
  installed=self.root/'_extensions/Example/course-ui';self.assertEqual('version: 0.8.0\n',(installed/'_extension.yml').read_text());self.assertEqual('ui release\n',(installed/'entry.ts').read_text())
 def test_released_executable_git_mode_preserved(self) -> None:
  package=self.repo/'_extensions/course-core';script=package/'early-filter.sh';script.write_text('#!/bin/sh\nexit 0\n');script.chmod(0o755)
  self.git('add','.');self.git('commit','-qm','executable release');self.git('tag','-f','v1.0.0')
  self.provider.pop('candidate');self.provider['commit']=self.git('rev-parse','HEAD');self.save()
  r=self.run_cli('--write');self.assertEqual(0,r.returncode,r.stderr)
  for target in [self.target,self.other]:self.assertEqual(0o755,(target/'early-filter.sh').stat().st_mode&0o777)
if __name__=='__main__':unittest.main()
