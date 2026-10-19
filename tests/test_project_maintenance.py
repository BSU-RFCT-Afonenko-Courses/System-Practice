"""Факты проекта: допустимые истории и содержательные неверные результаты."""
import io,shutil,sys,tempfile,unittest,zipfile,zlib,subprocess,json,shlex,os,tarfile,stat
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from check_project_maintenance import check_archive
from maintenance_fixture import solution,run,finish,package
from build_materials import packed
from system_support import read_zip,read_tar_gz,ArchiveError,ArchiveLimit

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
    def test_staged_executable_mode_is_dirty(self):
        base=solution(self.root);w=base/'work'
        self.assertEqual('pass',self.check(base)['automated'])
        run(w,'update-index','--chmod=+x','VERSION')
        self.assertIn(b'mode change 100644 => 100755 VERSION',run(w,'diff','--cached','--summary').stdout)
        self.expect_failure(base,'Индекс')
    def executable_release(self):
        base=solution(self.root);w=base/'work'
        run(w,'update-index','--chmod=+x','VERSION');run(w,'commit','-qm','Сохранить исполняемый режим VERSION')
        finish(base)
        run(w,'config','core.filemode','false');(w/'VERSION').chmod(0o644)
        (w/'VERSION').write_bytes(b'2.0\r\n')
        self.assertTrue(run(w,'ls-tree','HEAD','VERSION').stdout.startswith(b'100755 '))
        self.assertTrue(run(w,'ls-files','--stage','VERSION').stdout.startswith(b'100755 '))
        return base
    def test_committed_executable_mode_accepts_windows_style_work_and_crlf(self):
        self.assertEqual('pass',self.check(self.executable_release())['automated'])
    def test_release_patch_must_reproduce_committed_mode(self):
        base=self.executable_release();patch=base/'release.patch'
        before=patch.read_bytes();self.assertIn(b'new file mode 100755',before)
        patch.write_bytes(before.replace(b'new file mode 100755',b'new file mode 100644'))
        self.expect_failure(base,'release.patch')
    def test_free_patch_branch_nested_documents_extra_commits_and_reverse_merge(self):
        for reverse in [False,True]:
            with self.subTest(reverse=reverse):
                sub=self.root/str(reverse);sub.mkdir();seed=sub/'tasks/projects/project-maintenance/seed.json';seed.parent.mkdir(parents=True);shutil.copyfile(self.root/'tasks/projects/project-maintenance/seed.json',seed)
                base=solution(sub,branch='quality-instruction',extras=True,reverse=reverse)
                for kind in ['zip','tar.gz']:
                    result=check_archive(package(base,sub/('submission.'+kind)),initial_path=sub/'tasks/projects/project-maintenance/initial-state.json')
                    self.assertEqual('pass',result['automated'],result)
                    self.assertIn('refs/heads/quality-instruction',result['facts']['patchBranches'])
                    self.assertIn('docs/quality.md',result['facts']['releaseFiles'])
    def test_portable_origin_required_and_equivalent_relative_path_accepted(self):
        base=solution(self.root);w=base/'work'
        run(w,'remote','set-url','origin','./../shared.git')
        self.assertEqual('pass',self.check(base)['automated'])
        for value in ['/old/computer/shared.git','https://example.invalid/repo','../elsewhere.git']:
            run(w,'remote','set-url','origin',value);self.expect_failure(base,'origin')
    def directory_package(self,base,kind):
        path=self.root/('directories.'+kind)
        if kind=='zip':
            with zipfile.ZipFile(path,'w') as archive:
                for item in base.rglob('*'):archive.write(item,item.relative_to(base.parent).as_posix())
        else:package(base,path)
        return path
    def test_origin_components_must_exist_and_be_directories_for_fetch_and_push(self):
        base=solution(self.root);w=base/'work'
        for role in ['fetch','push']:
            for component in ['missing','VERSION']:
                with self.subTest(role=role,component=component):
                    run(w,'remote','set-url','origin','../shared.git')
                    run(w,'config','--unset-all','remote.origin.pushurl',ok=False)
                    value='./'+component+'/../../shared.git'
                    if role=='fetch':run(w,'remote','set-url','origin',value)
                    else:run(w,'config','remote.origin.pushurl',value)
                    native=run(w,'push','--dry-run','origin','main',ok=False)
                    self.assertEqual(128,native.returncode,native.stderr)
                    with self.assertRaises(OSError) as failure:(w/value).stat()
                    self.assertEqual(2 if component=='missing' else 20,failure.exception.errno)
                    for kind in ['zip','tar.gz']:
                        with self.subTest(kind=kind):
                            result=check_archive(package(base,self.root/('broken.'+kind)),initial_path=self.root/'tasks/projects/project-maintenance/initial-state.json')
                            self.assertEqual('fail',result['automated'],result)
                            self.assertEqual('fail',result['facts']['originAddressStatus'])
                            self.assertIn(role,' '.join(result['errors']))
    def test_origin_can_traverse_existing_packaged_directories_and_archive_root(self):
        base=solution(self.root,extras=True);w=base/'work'
        for value in ['./docs/../../shared.git','../../maintenance/shared.git']:
            with self.subTest(value=value):
                run(w,'remote','set-url','origin',value)
                self.assertEqual(0,run(w,'push','--dry-run','origin','main').returncode)
                for kind in ['zip','tar.gz']:
                    result=check_archive(package(base,self.root/('valid.'+kind)),initial_path=self.root/'tasks/projects/project-maintenance/initial-state.json')
                    self.assertEqual('pass',result['automated'],result)
    def test_explicit_empty_directory_route_survives_zip_and_tar(self):
        base=solution(self.root);w=base/'work';(w/'empty-route').mkdir()
        run(w,'remote','set-url','origin','./empty-route/../../shared.git')
        self.assertEqual(0,run(w,'push','--dry-run','origin','main').returncode)
        for kind,reader in [('zip',read_zip),('tar.gz',read_tar_gz)]:
            with self.subTest(kind=kind):
                path=self.directory_package(base,kind);observed=reader(path)
                self.assertIn('maintenance/work/empty-route',observed.directories)
                self.assertNotIn('maintenance/work/empty-route',observed.files)
                result=check_archive(path,initial_path=self.root/'tasks/projects/project-maintenance/initial-state.json')
                self.assertEqual('pass',result['automated'],result)
                restored=self.root/('restore-'+kind);restored.mkdir()
                # Распаковываем только собственный доверенный fixture для нативного наблюдения.
                if kind=='zip':
                    with zipfile.ZipFile(path) as archive:archive.extractall(restored)
                else:
                    with tarfile.open(path) as archive:archive.extractall(restored,filter='data')
                self.assertTrue((restored/'maintenance/work/empty-route').is_dir())
                self.assertEqual(0,run(restored/'maintenance/work','push','--dry-run','origin','main').returncode)
        result=self.check(base) # Этот ZIP намеренно содержит только файлы, пустой каталог отсутствует.
        self.assertEqual('fail',result['automated'],result)
    def test_origin_path_outside_observed_archive_is_manual(self):
        base=solution(self.root);run(base/'work','remote','set-url','origin','../../../outside/maintenance/shared.git')
        result=self.check(base)
        self.assertEqual('manual',result['automated'],result);self.assertTrue(result['toolLimited'])
        self.assertEqual([],result['errors']);self.assertEqual('manual',result['facts']['originAddressStatus'])
    def test_directory_metadata_keeps_archive_safety_and_entry_limits(self):
        for kind,reader in [('zip',read_zip),('tar.gz',read_tar_gz)]:
            for case in ['traversal','symlink','file-parent','limit']:
                with self.subTest(kind=kind,case=case):
                    path=self.root/('unsafe.'+kind)
                    names=['maintenance/work/empty/']
                    if case=='traversal':names=['maintenance/work/../empty/']
                    if case=='file-parent':names=['maintenance/work/file','maintenance/work/file/empty/']
                    if case=='limit':names=['maintenance/work/one/','maintenance/work/two/']
                    if kind=='zip':
                        with zipfile.ZipFile(path,'w') as archive:
                            for name in names:
                                item=zipfile.ZipInfo(name);item.create_system=3
                                item.external_attr=((stat.S_IFLNK if case=='symlink' else stat.S_IFDIR if name.endswith('/') else stat.S_IFREG)|0o755)<<16
                                archive.writestr(item,b'')
                    else:
                        with tarfile.open(path,'w:gz') as archive:
                            for name in names:
                                item=tarfile.TarInfo(name);item.type=tarfile.SYMTYPE if case=='symlink' else tarfile.DIRTYPE if name.endswith('/') else tarfile.REGTYPE
                                if case=='symlink':item.linkname='../shared.git'
                                archive.addfile(item)
                    with self.assertRaises(ArchiveLimit if case=='limit' else ArchiveError):reader(path,**({'max_entries':1} if case=='limit' else {}))
    def test_missing_index_binary_bom_and_nonterminated_documents_fail(self):
        base=solution(self.root);w=base/'work';index=w/'.git/index';saved=index.read_bytes();index.unlink()
        self.expect_failure(base,'index');index.write_bytes(saved)
        for content in [b'\x00\xff',b'\xef\xbb\xbftext\n',b'no trailing newline']:
            (w/'extra.txt').write_bytes(content);run(w,'add','extra.txt');run(w,'commit','-qm','Добавить недопустимый документ');finish(base)
            self.assertEqual('fail',self.check(base)['automated'])
    def test_P_must_preserve_initial_file_modes(self):
        base=solution(self.root);w=base/'work'
        run(w,'switch','review-note');run(w,'update-index','--chmod=+x','instructions.txt');run(w,'commit','--amend','--no-edit')
        run(w,'switch','main');run(w,'merge','--no-edit','review-note');finish(base)
        self.expect_failure(base,'P')
    def test_bare_config_is_required_as_data(self):
        base=solution(self.root);config=base/'shared.git/config'
        config.write_text(config.read_text().replace('bare = true','bare = false'))
        self.expect_failure(base,'bare')
    def test_bare_config_section_case_and_no_configparser_default_inheritance(self):
        base=solution(self.root);config=base/'shared.git/config';original=config.read_text()
        config.write_text(original.replace('[core]','[CORE]'))
        self.assertEqual('pass',self.check(base)['automated'])
        config.write_text(original.replace('\tbare = true\n','')+'\n[DEFAULT]\n bare=false\n')
        self.assertEqual('pass',self.check(base)['automated'])
        config.write_text(original.replace('bare = true','bare = false')+'\n[DEFAULT]\n bare=true\n')
        self.expect_failure(base,'bare')
    def test_bare_config_observes_order_across_section_case_variants(self):
        base=solution(self.root);config=base/'shared.git/config';original=config.read_text()
        config.write_text(original+'\n[CORE]\n bare=false\n')
        self.expect_failure(base,'bare')
        config.write_text(original+'\n[CORE]\n bare=false\n[core]\n bare=true\n')
        self.assertEqual('pass',self.check(base)['automated'])
    def test_origin_cannot_inherit_a_configparser_DEFAULT_url(self):
        base=solution(self.root);config=base/'work/.git/config'
        config.write_text(config.read_text().replace('\turl = ../shared.git\n','')+'\n[DEFAULT]\n url=../shared.git\n')
        self.expect_failure(base,'origin')
    def test_first_native_fetch_url_and_all_url_order_are_preserved(self):
        base=solution(self.root);w=base/'work'
        cases=[(['/old/computer/shared.git','../shared.git'],'fail'),
               (['../shared.git','./../shared.git'],'pass'),
               (['./../shared.git','../shared.git'],'pass')]
        for urls,expected in cases:
            with self.subTest(urls=urls):
                run(w,'config','--unset-all','remote.origin.url')
                for url in urls:run(w,'config','--add','remote.origin.url',url)
                native=run(w,'remote','get-url','origin').stdout.decode().strip()
                self.assertEqual(urls[0],native)
                self.assertEqual(urls,run(w,'config','--get-all','remote.origin.url').stdout.decode().splitlines())
                result=self.check(base);self.assertEqual(expected,result['automated'],result)
                if expected=='pass':
                    self.assertEqual(native,result['facts']['origin'])
                    self.assertEqual(urls,result['facts']['originURLs'])
    def test_native_implicit_bare_true_and_explicit_missing_false(self):
        base=solution(self.root);shared=base/'shared.git';config=shared/'config';original=config.read_text()
        for spelling,native in [('bare','true'),('bare = true','true'),('bare =','false'),('bare = false','false'),('', None)]:
            with self.subTest(spelling=spelling):
                config.write_text(original.replace('bare = true',spelling))
                query=run(shared,'config','--type=bool','--get','core.bare',ok=False)
                if native is None:self.assertEqual(1,query.returncode)
                else:
                    self.assertEqual(native,query.stdout.decode().strip())
                    self.assertEqual(native,run(shared,'rev-parse','--is-bare-repository').stdout.decode().strip())
                result=self.check(base)
                self.assertEqual('pass' if native in ('true',None) else 'fail',result['automated'],result)
    def test_all_active_push_directions_must_address_packaged_shared(self):
        base=solution(self.root);w=base/'work'
        cases=[(['../shared.git'],['../other.git'],'fail'),
               (['../shared.git','../other.git'],[],'fail'),
               (['../shared.git','../other.git'],['.././shared.git','./../shared.git'],'pass'),
               (['../shared.git'],['../shared.git','../other.git'],'fail'),
               (['../shared.git','./../shared.git'],[],'pass')]
        for urls,pushurls,expected in cases:
            with self.subTest(urls=urls,pushurls=pushurls):
                run(w,'config','--unset-all','remote.origin.url');run(w,'config','--unset-all','remote.origin.pushurl',ok=False)
                for value in urls:run(w,'config','--add','remote.origin.url',value)
                for value in pushurls:run(w,'config','--add','remote.origin.pushurl',value)
                native=run(w,'remote','get-url','--push','--all','origin').stdout.decode().splitlines()
                self.assertEqual(pushurls or urls,native)
                result=self.check(base);self.assertEqual(expected,result['automated'],result)
                if expected=='pass':
                    self.assertIn('originPushURLs',result['facts'])
                    self.assertEqual(native,result['facts']['originPushURLs'])
                    self.assertEqual('pass',result['facts']['originAddressStatus'])
                else:self.assertIn('push',' '.join(result['errors']))
    def test_address_rewrites_and_unread_includes_are_manual(self):
        for kind in ['insteadOf','pushInsteadOf','include']:
            with self.subTest(kind=kind):
                sub=self.root/kind;sub.mkdir();seed=sub/'tasks/projects/project-maintenance/seed.json';seed.parent.mkdir(parents=True);shutil.copyfile(self.root/'tasks/projects/project-maintenance/seed.json',seed)
                base=solution(sub);w=base/'work'
                if kind=='insteadOf':
                    run(w,'remote','set-url','origin','course:');run(w,'config','url.../shared.git.insteadOf','course:')
                    self.assertEqual(b'../shared.git\n',run(w,'remote','get-url','origin').stdout)
                elif kind=='pushInsteadOf':
                    run(w,'config','url.../other.git.pushInsteadOf','../shared.git')
                    self.assertEqual(b'../other.git\n',run(w,'remote','get-url','--push','origin').stdout)
                else:
                    included=sub/'outside-config';included.write_text('[remote "origin"]\n pushurl=../other.git\n')
                    with (w/'.git/config').open('a') as stream:stream.write('\n[include]\n path='+str(included)+'\n')
                    self.assertEqual(b'../other.git\n',run(w,'remote','get-url','--push','origin').stdout)
                result=check_archive(package(base,sub/'submission.zip'),initial_path=sub/'tasks/projects/project-maintenance/initial-state.json')
                self.assertEqual('manual',result['automated'],result);self.assertTrue(result['toolLimited']);self.assertEqual([],result['errors'])
                self.assertEqual('manual',result['facts']['originAddressStatus'])
    def test_native_bare_without_key_and_bare_completeness_remain_distinct(self):
        base=solution(self.root);shared=base/'shared.git';config=shared/'config'
        config.write_text(config.read_text().replace('\tbare = true\n',''))
        self.assertEqual(b'true\n',run(shared,'rev-parse','--is-bare-repository').stdout)
        self.assertEqual('pass',self.check(base)['automated'])
        oid=run(shared,'rev-parse','v2.0').stdout.decode().strip();(shared/'objects'/oid[:2]/oid[2:]).unlink()
        self.expect_failure(base,'Git object')
    def test_unmodelled_bare_worktree_settings_are_manual(self):
        base=solution(self.root);config=base/'shared.git/config'
        with config.open('a') as stream:stream.write('\n[core]\n worktree=../unexpected-work\n')
        result=self.check(base)
        self.assertEqual('manual',result['automated'],result);self.assertTrue(result['toolLimited']);self.assertEqual([],result['errors'])
        self.assertEqual('manual',result['facts']['sharedBareStatus'])
    def test_data_config_parser_does_not_follow_even_malformed_existing_include(self):
        base=solution(self.root);w=base/'work';included=self.root/'unread-config';included.write_text('THIS IS NOT GIT CONFIG\n')
        with (w/'.git/config').open('a') as stream:stream.write('\n[include]\n path='+str(included)+'\n')
        result=self.check(base);self.assertEqual('manual',result['automated']);self.assertEqual([],result['errors'])
    def test_data_config_parser_ignores_inherited_git_configuration(self):
        base=solution(self.root);archive=package(base,self.root/'env.zip')
        poison=self.root/'poison-config';poison.write_text('THIS IS NOT GIT CONFIG\n')
        env={**os.environ,'GIT_CONFIG_GLOBAL':str(poison),'GIT_CONFIG_COUNT':'1',
             'GIT_CONFIG_KEY_0':'core.bare','GIT_CONFIG_VALUE_0':'false'}
        script='import json,sys;sys.path.insert(0,sys.argv[1]);from check_project_maintenance import check_archive;print(json.dumps(check_archive(sys.argv[2],sys.argv[3])))'
        result=subprocess.run([sys.executable,'-c',script,str(Path(__file__).resolve().parents[1]/'tools'),str(archive),str(self.root/'tasks/projects/project-maintenance/initial-state.json')],env=env,capture_output=True,text=True)
        self.assertEqual(0,result.returncode,result.stderr)
        self.assertEqual('pass',json.loads(result.stdout)['automated'])
    def test_data_config_output_limit_is_manual_not_contract_failure(self):
        base=solution(self.root);config=base/'work/.git/config'
        with config.open('a') as stream:stream.write('\n[course]\n note='+('a'*(1024*1024+128))+'\n')
        result=self.check(base)
        self.assertEqual('manual',result['automated'],result);self.assertTrue(result['toolLimited']);self.assertEqual([],result['errors'])
    def test_archive_limit_is_manual_without_contract_failure(self):
        path=self.root/'large.zip'
        with zipfile.ZipFile(path,'w') as archive:
            for i in range(1001):archive.writestr(f'maintenance/work/item-{i}',b'x')
        result=check_archive(path)
        self.assertEqual('manual',result['automated']);self.assertTrue(result['toolLimited']);self.assertEqual([],result['errors'])
        receipt=self.root/'receipt.json'
        cli=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'tools/check_project_maintenance.py'),str(path),'--output',str(receipt)],capture_output=True,text=True)
        self.assertEqual(2,cli.returncode);self.assertEqual('manual',json.loads(receipt.read_text())['automated'])
    def test_large_valid_history_is_manual_without_educational_maximum(self):
        base=solution(self.root);w=base/'work'
        for i in range(250):
            (w/'notes.txt').write_text(f'Сопроводительное примечание {i}.\n');run(w,'add','notes.txt');run(w,'commit','-qm',f'Уточнить примечание {i}')
        finish(base);run(w,'gc','--prune=now');run(base/'shared.git','gc','--prune=now')
        result=self.check(base)
        self.assertEqual('manual',result['automated'],result);self.assertTrue(result['toolLimited']);self.assertEqual([],result['errors'])
    def test_conflict_resolution_cannot_drop_quality(self):
        base=solution(self.root);w=base/'work';(w/'report.ini').write_bytes(b'format=csv\ncolumns=code,value\ndecimal=dot\n');run(w,'add','report.ini');run(w,'commit','-qm','Wrong choice');finish(base);self.expect_failure(base,'report.ini')
    def test_patch_commit_must_start_at_A(self):self.expect_failure(solution(self.root,bad_parent=True),'P')
    def test_lightweight_tag_is_not_annotated(self):
        base=solution(self.root);finish(base,lightweight=True);self.expect_failure(base,'аннотированный')
    def test_shared_main_must_receive_the_final_commit(self):
        base=solution(self.root);run(base/'shared.git','update-ref','refs/heads/main',run(base/'work','rev-parse','start').stdout.decode().strip());self.expect_failure(base,'shared.git')
    def test_original_F_line_cannot_be_replaced_by_equal_final_files(self):
        base=solution(self.root);w=base/'work'
        tree=run(w,'rev-parse','HEAD^{tree}').stdout.decode().strip()
        oid=run(w,'commit-tree',tree,'-p','start','-p','review-note','-m','Синтезировать итог без F').stdout.decode().strip()
        run(w,'reset','--hard',oid);run(base/'shared.git','update-ref','refs/heads/main',run(w,'rev-parse','start').stdout.decode().strip());finish(base)
        self.expect_failure(base,'предков')
    def test_patch_from_A_instead_of_start_is_not_the_release_transition(self):
        base=solution(self.root);run(base/'work','diff','--binary','--output=../release.patch','base','v2.0')
        self.expect_failure(base,'release.patch')
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
        base=solution(self.root);w=base/'work';marker=self.root/'EXECUTED';hook=w/'.git/unsafe-hook'
        hook.write_text('#!/bin/sh\ntouch '+shlex.quote(str(marker))+'\n');hook.chmod(0o755)
        with (w/'.git/config').open('a') as stream:stream.write('[core]\n fsmonitor='+str(hook)+'\n hooksPath=/do-not-execute\n[include]\n path=/do-not-read\n[credential]\n helper=!touch '+str(marker)+'\n')
        result=self.check(base);self.assertEqual('manual',result['automated']);self.assertEqual([],result['errors']);self.assertFalse(marker.exists())
if __name__=='__main__':unittest.main()
