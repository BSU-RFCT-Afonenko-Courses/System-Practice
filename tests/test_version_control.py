"""Фактические Git snapshots/ancestry; имена и даты собственных коммитов свободны."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from check_version_control import check_archive
ROOT=Path(__file__).resolve().parents[1]

class VersionControlTests(unittest.TestCase):
 def setUp(self):
  self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
  self.parent=Path(self.temporary.name)
  with zipfile.ZipFile(ROOT/'tasks/materials/version-control-start.zip') as z:z.extractall(self.parent)
  self.work=self.parent/'versioning';(self.work/'explanation.md').write_text('Снимок и история требуют отдельного устного разбора.\n')
  self.env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
  self.env.update(GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_NOSYSTEM='1',GIT_AUTHOR_NAME='Other learner',GIT_AUTHOR_EMAIL='other@example.invalid',GIT_COMMITTER_NAME='Other learner',GIT_COMMITTER_EMAIL='other@example.invalid')
 def git(self,repo,*args):
  return subprocess.check_output(['git','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','-C',str(self.work/repo),*args],env=self.env,stderr=subprocess.PIPE)
 def solve(self,alternate=False):
  p=self.work/'selection';original=(p/'measurements.ini').read_bytes()
  self.git('selection','restore','--staged','notes.txt')
  (p/'measurements.ini').write_text('site=river\nsamples=10\nwindow=long\n')
  self.git('selection','add','measurements.ini','guide.txt')
  self.git('selection','restore','--source=units-reference','--staged','--worktree','protocol.txt')
  self.git('selection','commit','-m','Select long window and restore milliseconds')
  (p/'measurements.ini').write_bytes(original)
  self.git('integration','switch','-c','validation','csv-output')
  (self.work/'integration/checks.txt').write_text('order=units,code\n')
  self.git('integration','add','checks.txt');self.git('integration','commit','-m','Validate CSV ordering')
  if alternate:
   self.git('integration','merge','--no-edit','main')
   self.git('integration','switch','main');self.git('integration','merge','--ff-only','validation')
  else:
   self.git('integration','switch','main');self.git('integration','merge','--no-edit','validation')
 def archive(self):
  out=self.parent/'submission.zip'
  with zipfile.ZipFile(out,'w') as z:
   for p in self.work.rglob('*'):
    if p.is_file():z.write(p,p.relative_to(self.parent))
  return out
 def test_accepts_actual_snapshots_with_free_identity_and_merge_order(self):
  for alternate in [False,True]:
   with self.subTest(alternate=alternate):
    if alternate:
     import shutil
     shutil.rmtree(self.work)
     with zipfile.ZipFile(ROOT/'tasks/materials/version-control-start.zip') as z:z.extractall(self.parent)
     (self.work/'explanation.md').write_text('Пояснение требует ручной оценки.\n')
    self.solve(alternate)
    result=check_archive(self.archive());self.assertEqual('pass',result['automated'],result);self.assertTrue(result['manualRequired'])
 def test_accepts_packed_objects_and_crlf_worktree(self):
  self.solve()
  for repo in ['selection','integration']:
   self.git(repo,'gc','--prune=now')
   for p in (self.work/repo).iterdir():
    if p.is_file():p.write_bytes(p.read_bytes().replace(b'\n',b'\r\n'))
  result=check_archive(self.archive());self.assertEqual('pass',result['automated'],result)
 def test_reports_malformed_git_without_traceback_or_execution(self):
  self.solve();(self.work/'selection/.git/index').write_bytes(b'not a Git index')
  result=check_archive(self.archive());self.assertEqual('fail',result['automated']);self.assertTrue(result['errors']);self.assertTrue(result['manualRequired'])
 def test_rejects_starter_and_wrong_index_despite_correct_head(self):
  self.assertEqual('fail',check_archive(self.archive())['automated'])
  self.solve();self.git('selection','add','notes.txt')
  self.assertEqual('fail',check_archive(self.archive())['automated'])
 def test_rejects_correct_files_without_required_parent_history(self):
  self.solve();p=self.work/'integration'
  self.git('integration','switch','--orphan','replacement')
  for name,text in {'report.ini':'format=csv\ncolumns=code,units\n','guide.txt':'review=required\n','checks.txt':'order=units,code\n','.gitattributes':'* text=auto eol=lf\n'}.items():(p/name).write_text(text)
  self.git('integration','add','.');self.git('integration','commit','-m','Copy final files')
  self.git('integration','branch','-f','main','HEAD');self.git('integration','switch','main')
  self.assertEqual('fail',check_archive(self.archive())['automated'])
 def test_ignores_untrusted_config_and_hooks_without_execution(self):
  self.solve();marker=self.parent/'EXECUTED'
  for repo in ['selection','integration']:
   gd=self.work/repo/'.git'
   (gd/'hooks').mkdir(exist_ok=True)
   hook=gd/'hooks/post-index-change';hook.write_text('#!/bin/sh\ntouch '+str(marker)+'\n');hook.chmod(0o755)
   with (gd/'config').open('a') as f:f.write('\n[core]\n fsmonitor = '+str(hook)+'\n[alias]\n show = !touch '+str(marker)+'\n')
  result=check_archive(self.archive());self.assertEqual('pass',result['automated'],result);self.assertFalse(marker.exists())

if __name__=='__main__':unittest.main()
