"""Факты проекта: допустимые истории и содержательные неверные результаты."""
import io,shutil,sys,tempfile,unittest,zipfile,zlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from check_project_maintenance import check_archive
from maintenance_fixture import solution,run,finish,package
from build_materials import packed

class ProjectMaintenance(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='maintenance check ');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        seed=self.root/'tasks/projects/project-maintenance/seed.json';seed.parent.mkdir(parents=True);shutil.copyfile(Path(__file__).resolve().parents[1]/'tasks/projects/project-maintenance/seed.json',seed)
    def check(self,base):return check_archive(package(base,self.root/'submission.zip'),initial_path=self.root/'tasks/projects/project-maintenance/initial-state.json')
    def expect_failure(self,base,fragment):
        r=self.check(base);self.assertEqual('fail',r['automated']);self.assertTrue(r['manualRequired']);self.assertIn(fragment,' '.join(r['errors']))
    def test_different_orders_identity_packed_objects_and_crlf_are_valid(self):
        for order in ['remote-first','patch-first']:
            with self.subTest(order=order):
                sub=self.root/order;sub.mkdir();seed=sub/'tasks/projects/project-maintenance/seed.json';seed.parent.mkdir(parents=True);shutil.copyfile(self.root/'tasks/projects/project-maintenance/seed.json',seed)
                base=solution(sub,order);w=base/'work';run(w,'gc');run(base/'shared.git','gc');run(w,'pack-refs','--all')
                for p in w.iterdir():
                    if p.is_file():p.write_bytes(p.read_bytes().replace(b'\n',b'\r\n'))
                archive=package(base,sub/'submission.zip');r=check_archive(archive,initial_path=sub/'tasks/projects/project-maintenance/initial-state.json')
                self.assertEqual('pass',r['automated'],r);self.assertTrue(r['manualRequired'])
    def test_conflict_resolution_cannot_drop_quality(self):
        base=solution(self.root);w=base/'work';(w/'report.ini').write_bytes(b'format=csv\ncolumns=code,value\ndecimal=dot\n');run(w,'add','report.ini');run(w,'commit','-qm','Wrong choice');finish(base);self.expect_failure(base,'report.ini')
    def test_patch_commit_must_start_at_A(self):self.expect_failure(solution(self.root,bad_parent=True),'review-note')
    def test_lightweight_tag_is_not_annotated(self):
        base=solution(self.root);finish(base,lightweight=True);self.expect_failure(base,'аннотированный')
    def test_shared_main_must_receive_the_final_commit(self):
        base=solution(self.root);run(base/'shared.git','update-ref','refs/heads/main',run(base/'work','rev-parse','start').stdout.decode().strip());self.expect_failure(base,'shared.git')
    def test_outgoing_patch_must_reproduce_the_final_tree(self):
        base=solution(self.root);(base/'release.patch').write_bytes(b'');self.expect_failure(base,'release.patch')
    def test_release_archive_must_contain_committed_bytes_only(self):
        base=solution(self.root)
        with zipfile.ZipFile(base/'report-2.0.zip') as z:data={n:z.read(n) for n in z.namelist() if not n.endswith('/')}
        data['report-2.0/VERSION']=b'2.1\n';(base/'report-2.0.zip').write_bytes(packed(data));self.expect_failure(base,'report-2.0.zip')
    def test_release_archive_excludes_even_an_empty_git_directory(self):
        base=solution(self.root)
        with zipfile.ZipFile(base/'report-2.0.zip','a') as z:z.writestr('report-2.0/.git/',b'')
        self.expect_failure(base,'report-2.0.zip')
    def test_corrupt_submission_reports_manual_diagnostic(self):
        path=self.root/'invalid.zip';path.write_bytes(b'not a ZIP')
        r=check_archive(path,initial_path=self.root/'absent.json')
        self.assertEqual('fail',r['automated']);self.assertTrue(r['errors']);self.assertTrue(r['manualRequired'])
    def test_shared_tag_object_must_exist(self):
        base=solution(self.root);shared=base/'shared.git';oid=run(shared,'rev-parse','v2.0').stdout.decode().strip()
        (shared/'objects'/oid[:2]/oid[2:]).unlink()
        self.expect_failure(base,'Git object')
    def test_shared_tag_actual_bytes_must_match_its_oid(self):
        base=solution(self.root);shared=base/'shared.git';oid=run(shared,'rev-parse','v2.0').stdout.decode().strip();path=shared/'objects'/oid[:2]/oid[2:]
        raw=zlib.decompress(path.read_bytes());header,body=raw.split(b'\0',1);body+=b'Different annotation.\n';path.chmod(0o600);path.write_bytes(zlib.compress(b'tag '+str(len(body)).encode()+b'\0'+body))
        self.expect_failure(base,'Git object')
    def test_shared_original_incoming_commit_must_remain_readable(self):
        base=solution(self.root);shared=base/'shared.git';oid=run(shared,'rev-parse','incoming').stdout.decode().strip()
        (shared/'objects'/oid[:2]/oid[2:]).unlink()
        self.expect_failure(base,'Git object')
    def test_zero_context_git_patch_reproducing_release_is_valid(self):
        base=solution(self.root);run(base/'work','diff','--binary','--unified=0','--output=../release.patch','start','v2.0')
        self.assertEqual('pass',self.check(base)['automated'])
    def test_untrusted_config_is_never_executed(self):
        base=solution(self.root);w=base/'work';(w/'.git/config').write_text('[core]\n bare=false\n fsmonitor=/do-not-execute\n hooksPath=/do-not-execute\n[include]\n path=/do-not-read\n')
        self.assertEqual('pass',self.check(base)['automated'])
if __name__=='__main__':unittest.main()
