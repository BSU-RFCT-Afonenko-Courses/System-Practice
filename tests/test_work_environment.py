"""Наблюдаемый результат лабораторной; способ выполнения принимает преподаватель."""
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from check_work_environment import check_archive


class WorkEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='system-work-environment-')
        self.addCleanup(self.temporary.cleanup)
        self.zip = Path(self.temporary.name) / 'submission.zip'
        self.valid = {
            'survey/source/morning log.txt': b'A=12\nB=7\n',
            'survey/source/evening.txt': b'A=10\nB=9\n',
            'survey/result/current/morning.txt': b'A=12\nB=7\n',
            'survey/result/current/evening.txt': b'A=10\nB=9\n',
            'survey/result/archive/station.txt': b'station=west\n',
            'survey/result/line-count.txt': b'lines=2\n',
            'survey/explanation.md': 'fish 4; ../../source/morning log.txt; пояснение пути и выбора параметра.\n'.encode(),
        }
        common = Path(__file__).resolve().parents[1] / 'tasks/common/work-environment'
        for name in ['survey/tools/count.ps1', 'survey/tools/count.fish']:
            self.valid[name] = (common / Path(name).name).read_bytes()

    def check(self, files):
        with zipfile.ZipFile(self.zip, 'w') as archive:
            for name, data in files.items():
                archive.writestr(name, data)
        return check_archive(self.zip)

    def test_accepts_target_bytes_and_keeps_semantics_for_manual_review(self):
        result = self.check(self.valid)
        self.assertEqual('pass', result['automated'], result)
        self.assertTrue(result['manualRequired'])
        self.assertEqual([], result['errors'])

    def test_accepts_editor_folder_without_requiring_command_history(self):
        files = dict(self.valid)
        files['survey/.vscode/settings.json'] = b'{}'
        self.assertEqual('pass', self.check(files)['automated'])

    def test_rejects_changed_files_missing_report_and_remaining_work(self):
        variants = []
        missing = dict(self.valid); del missing['survey/source/morning log.txt']; variants.append(missing)
        variants.append(self.valid | {'survey/result/current/morning.txt': b'A=10\nB=9\n'})
        variants.append(self.valid | {'survey/source/evening.txt': b'A=10\nB=8\n'})
        variants.append(self.valid | {'survey/result/archive/station.txt': b'temporary\n'})
        variants.append(self.valid | {'survey/work/': b''})
        variants.append(self.valid | {'survey/result/line-count.txt': b'lines=1\n'})
        variants.append(self.valid | {'survey/result/line-count.txt': b'lines=2\r\n'})
        missing_report = dict(self.valid); del missing_report['survey/result/line-count.txt']; variants.append(missing_report)
        variants.append(self.valid | {'survey/result/unrequested.txt': b'extra'})
        for index, files in enumerate(variants):
            with self.subTest(case=index):
                result = self.check(files)
                self.assertEqual('fail', result['automated'])
                self.assertTrue(result['errors'])

    def test_os_sidecars_inside_survey_do_not_replace_learning_files(self):
        metadata = {'survey/.DS_Store': b'opaque metadata',
                    'survey/source/.DS_Store': b'opaque metadata',
                    'survey/result/._line-count.txt': b'opaque metadata',
                    'survey/tools/._count.ps1': b'opaque metadata'}
        self.assertEqual('pass', self.check(self.valid | metadata)['automated'])
        files = self.valid | metadata
        del files['survey/result/line-count.txt']
        self.assertEqual('fail', self.check(files)['automated'])
        self.assertEqual('fail', self.check(self.valid | {'__MACOSX/._survey': b'metadata'})['automated'])

    def test_old_readme_cannot_replace_count_report(self):
        files = dict(self.valid)
        del files['survey/result/line-count.txt']
        files['survey/result/README.txt'] = b'Dataset: station observations\nCurrent: morning.txt, evening.txt\nArchive: station.txt\n'
        self.assertEqual('fail', self.check(files)['automated'])

    def test_supplied_tools_must_be_present_and_unchanged(self):
        for name in ['survey/tools/count.ps1', 'survey/tools/count.fish']:
            with self.subTest(tool=name):
                files = dict(self.valid); del files[name]
                self.assertEqual('fail', self.check(files)['automated'])
                self.assertEqual('fail', self.check(self.valid | {name: b'changed tool\n'})['automated'])

    def test_checker_never_executes_changed_submission_tool(self):
        marker = Path(self.temporary.name) / 'executed'
        result = self.check(self.valid | {'survey/tools/count.fish': f'touch "{marker}"\n'.encode()})
        self.assertEqual('fail', result['automated'])
        self.assertFalse(marker.exists())

    def test_rejects_missing_archive_root_and_unreadable_explanation(self):
        self.assertEqual('fail', self.check({p.removeprefix('survey/'): b for p, b in self.valid.items()})['automated'])
        self.assertEqual('fail', self.check(self.valid | {'survey/explanation.md': b'\xff'})['automated'])

    def test_rejects_traversal_duplicates_and_symlinks_without_extracting(self):
        for kind in ['traversal', 'duplicate', 'symlink']:
            with self.subTest(kind=kind):
                with zipfile.ZipFile(self.zip, 'w') as archive:
                    if kind == 'traversal':
                        archive.writestr('../outside.txt', b'no')
                    elif kind == 'duplicate':
                        archive.writestr('survey/a', b'first')
                        with self.assertWarns(UserWarning):
                            archive.writestr('survey/a', b'second')
                    else:
                        info = zipfile.ZipInfo('survey/link')
                        info.create_system = 3
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                        archive.writestr(info, b'/tmp/elsewhere')
                self.assertEqual('fail', check_archive(self.zip)['automated'])
                self.assertFalse((self.zip.parent / 'outside.txt').exists())

    def test_directory_mode_cannot_disguise_required_regular_file(self):
        with zipfile.ZipFile(self.zip, 'w') as archive:
            for name, data in self.valid.items():
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = ((stat.S_IFDIR | 0o755) if name.endswith('morning log.txt')
                                      else (stat.S_IFREG | 0o644)) << 16
                archive.writestr(info, data)
        self.assertEqual('fail', check_archive(self.zip)['automated'])


if __name__ == '__main__':
    unittest.main()
