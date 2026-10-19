"""Свойства и отношения в настоящих историях, созданных по условию."""
import io
import json
import subprocess
import tarfile
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from check_version_control import check_archive
from git_fixture import solution, package, run, commit


class VersionControlTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='new-git-result-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def check(self, base, kind='zip'):
        return check_archive(package(base, self.root / ('submission.' + kind)))

    def test_accepts_zip_and_tar_gz_with_actual_history(self):
        base, ids = solution(self.root)
        for kind in ['zip', 'tar.gz']:
            with self.subTest(kind=kind):
                result = self.check(base, kind)
                self.assertEqual('pass', result['automated'], result)
                self.assertTrue(result['manualRequired'])
                self.assertEqual(ids['A'], result['facts']['A'])
                self.assertEqual(ids['D'], result['facts']['D'])

    def test_accepts_reverse_merge_extra_commits_files_and_short_decimal(self):
        base, ids = solution(self.root, reverse=True, extras=True, threshold='0.03', branch='units-and-notes')
        self.assertEqual('pass', self.check(base)['automated'])

    def test_accepts_packed_objects_refs_and_crlf(self):
        base, _ = solution(self.root)
        for name in ['project', 'verification']:
            repo = base / name
            run(repo, 'gc', '--prune=now')
            for p in repo.iterdir():
                if p.is_file(): p.write_bytes(p.read_bytes().replace(b'\n', b'\r\n'))
        self.assertEqual('pass', self.check(base)['automated'])

    def test_rejects_final_files_without_required_merge_history(self):
        base, _ = solution(self.root); repo = base / 'project'
        run(repo, 'checkout', '--orphan', 'flattened')
        commit(repo, 'Сохранить только итоговые файлы')
        run(repo, 'branch', '-f', 'main', 'HEAD'); run(repo, 'switch', 'main')
        from git_fixture import sync
        sync(base)
        self.assertEqual('fail', self.check(base)['automated'])

    def test_rejects_wrong_units_measurements_stale_clone_and_dirty_index(self):
        for mutation in ['units', 'measurements', 'clone', 'index', 'branch', 'merge-state']:
            with self.subTest(mutation=mutation):
                where = self.root / mutation; where.mkdir()
                base, _ = solution(where); repo = base / 'project'
                if mutation == 'units':
                    (repo / 'criteria.txt').write_text('latency_limit = 0.030 ms\n'); commit(repo, 'Неверная единица')
                elif mutation == 'measurements':
                    (repo / 'measurements.tsv').write_text('sensor\tlatency_ms\nnorth\t18\nsouth\t34\n'); commit(repo, 'Неверные измерения')
                elif mutation == 'clone':
                    (repo / 'new.txt').write_text('Новое состояние\n'); commit(repo, 'Изменить первую копию')
                elif mutation == 'index':
                    (repo / 'criteria.txt').write_text('latency_limit = 50 ms\n'); run(repo, 'add', 'criteria.txt')
                elif mutation == 'branch': run(repo, 'branch', '-D', 'seconds-unit')
                else: (repo / '.git/MERGE_HEAD').write_text('a' * 40 + '\n')
                self.assertEqual('fail', self.check(base)['automated'])

    def test_rejects_missing_index_and_unresolved_markers(self):
        base, _ = solution(self.root)
        (base / 'verification/.git/index').unlink()
        self.assertEqual('fail', self.check(base)['automated'])
        run(base / 'verification', 'reset', '--hard', 'HEAD')
        (base / 'project/README.md').write_text('<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> seconds\n')
        commit(base / 'project', 'Оставить маркеры конфликта')
        self.assertEqual('fail', self.check(base)['automated'])

    def test_untrusted_config_includes_helpers_and_hooks_never_run(self):
        base, _ = solution(self.root); marker = self.root / 'EXECUTED'
        for name in ['project', 'verification']:
            gd = base / name / '.git'; hooks = gd / 'hooks'; hooks.mkdir(exist_ok=True)
            hook = hooks / 'post-index-change'; hook.write_text('#!/bin/sh\ntouch ' + str(marker) + '\n'); hook.chmod(0o755)
            with (gd / 'config').open('a') as stream:
                stream.write(f'\n[include]\n path = {self.root / "unread-config"}\n[core]\n fsmonitor = {hook}\n[alias]\n show = !touch {marker}\n[credential]\n helper = !touch {marker}\n')
        self.assertEqual('pass', self.check(base)['automated'])
        self.assertFalse(marker.exists())

    def test_committed_crlf_text_is_accepted(self):
        base, _ = solution(self.root)
        for path in (base / 'project').iterdir():
            if path.is_file(): path.write_bytes(path.read_bytes().replace(b'\n', b'\r\n'))
        commit(base / 'project', 'Сохранить Windows-переводы строк')
        from git_fixture import sync
        sync(base)
        self.assertEqual('pass', self.check(base)['automated'])

    def test_unsafe_tar_returns_cli_receipt_without_extraction(self):
        path = self.root / 'submission.tar.gz'
        with tarfile.open(path, 'w:gz') as archive:
            info = tarfile.TarInfo('versioning/project/.git/HEAD')
            info.type = tarfile.SYMTYPE; info.linkname = '/etc/passwd'
            archive.addfile(info)
        self.assertEqual('fail', check_archive(path)['automated'])
        receipt = self.root / 'receipt.json'
        result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'tools/check_version_control.py'),
                                 str(path), '--output', str(receipt)], capture_output=True, text=True)
        self.assertEqual(1, result.returncode)
        self.assertNotIn('Traceback', result.stderr)
        self.assertEqual('fail', json.loads(receipt.read_text())['automated'])

    def test_git_quoted_remote_url_is_read_as_data(self):
        base, _ = solution(self.root)
        p = base / 'verification/.git/config'
        text = p.read_text().replace('url = ssh://git@github.com/owner/latency.git',
                                     'url = "ssh://git@github.com/owner/latency.git" # repository address')
        self.assertIn('"ssh://', text)
        p.write_text(text)
        self.assertEqual('pass', self.check(base)['automated'])

    def test_large_valid_history_is_manual_tool_limit_not_contract_failure(self):
        base, _ = solution(self.root)
        repo = base / 'project'
        for i in range(253):
            (repo / 'revision-notes.txt').write_text(f'Примечание к проверке измерений {i}.\n')
            commit(repo, f'Уточнить сопроводительное примечание {i}')
        from git_fixture import sync
        sync(base)
        for name in ['project', 'verification']: run(base / name, 'gc', '--prune=now')
        result = self.check(base)
        self.assertEqual('manual', result['automated'], result)
        self.assertTrue(result['toolLimited'])
        self.assertEqual([], result['errors'])
        self.assertTrue(result['diagnostics'])
        self.assertTrue(result['manualRequired'])
        receipt = self.root / 'manual.json'
        cli = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'tools/check_version_control.py'),
                              str(self.root / 'submission.zip'), '--output', str(receipt)], capture_output=True, text=True)
        self.assertEqual(2, cli.returncode)
        self.assertEqual('manual', json.loads(receipt.read_text())['automated'])

    def test_archive_resource_limit_is_manual_without_contract_errors(self):
        path = self.root / 'large.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            for i in range(1001): archive.writestr(f'versioning/project/item-{i}', b'x')
        result = check_archive(path)
        self.assertEqual('manual', result['automated'])
        self.assertTrue(result['toolLimited'])
        self.assertEqual([], result['errors'])

    def test_corrupt_git_and_non_ssh_remotes_are_structured_failures(self):
        base, _ = solution(self.root)
        for address in ['https://github.com/owner/repo.git', 'file:///tmp/repo.git', 'C:/local/repo.git']:
            with self.subTest(address=address):
                run(base / 'verification', 'remote', 'set-url', 'origin', address)
                result = self.check(base)
                self.assertEqual('fail', result['automated']); self.assertTrue(result['manualRequired'])
        (base / 'verification/.git/index').write_bytes(b'not an index')
        self.assertEqual('fail', self.check(base)['automated'])


if __name__ == '__main__': unittest.main()
