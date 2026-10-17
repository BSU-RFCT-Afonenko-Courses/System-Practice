"""Проверка реальных исходных Git-репозиториев и воспроизводимых архивов."""
import json,os,subprocess,sys,tempfile,unittest,zipfile,shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from build_git_materials import build

class GitMaterials(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='git materials ');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        seed=self.root/'tasks/projects/version-control/seed.json';seed.parent.mkdir(parents=True);shutil.copyfile(Path(__file__).resolve().parents[1]/'tasks/projects/version-control/seed.json',seed)

    def test_repeatable_archives_have_real_history_index_and_unfinished_work(self):
        first=build(self.root,write=True);before={n:(self.root/n).read_bytes() for n in first}
        self.assertEqual(first,build(self.root,write=True));self.assertEqual(before,{n:(self.root/n).read_bytes() for n in first});build(self.root,write=False)
        with zipfile.ZipFile(self.root/'tasks/materials/version-control-start.zip') as z:
            z.extractall(self.root/'inspect')  # Only our generated, trusted archive.
        selection=self.root/'inspect/versioning/selection';integration=selection.parent/'integration'
        def git(where,*args):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=where,text=True,env={**os.environ,'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'})
        self.assertEqual('site=river\nsamples=10\nwindow=short\n',git(selection,'show','HEAD:measurements.ini'))
        self.assertEqual('site=river\nsamples=12\nwindow=short\n',git(selection,'show',':measurements.ini'))
        self.assertEqual('site=river\nsamples=12\nwindow=long\n',(selection/'measurements.ini').read_text())
        status=git(selection,'status','--porcelain=v1');self.assertIn('MM measurements.ini',status);self.assertIn(' M guide.txt',status);self.assertIn('M  notes.txt',status)
        self.assertEqual('',git(integration,'status','--porcelain=v1'))
        self.assertEqual(git(integration,'rev-parse','base'),git(integration,'merge-base','main','csv-output'))
        self.assertEqual('format=csv\ncolumns=code,units\n',git(integration,'show','csv-output:report.ini'))
        for repo in [selection,integration]:
            config=git(repo,'config','--local','--list')
            self.assertNotIn('user.',config);self.assertNotIn('remote.',config);self.assertNotIn('include.',config)
            self.assertFalse((repo/'.git/hooks').exists());self.assertFalse((repo/'.git/objects/info/alternates').exists())

    def test_check_is_read_only_and_local_archive_edit_is_preserved(self):
        with self.assertRaises(ValueError):build(self.root,write=False)
        self.assertFalse((self.root/'practice').exists())
        build(self.root,write=True);archive=self.root/'tasks/materials/version-control-start.zip';archive.write_bytes(b'local change')
        other=self.root/'practice/materials/version-control-demo.zip';before=other.read_bytes()
        with self.assertRaises(ValueError):build(self.root,write=True)
        self.assertEqual(b'local change',archive.read_bytes());self.assertEqual(before,other.read_bytes())

if __name__=='__main__':unittest.main()
