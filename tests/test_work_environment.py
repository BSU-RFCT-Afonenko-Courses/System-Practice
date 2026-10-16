"""Наблюдаемый результат лабораторной; способ выполнения принимает преподаватель."""
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
            'survey/result/README.txt': b'Dataset: station observations\nCurrent: morning.txt, evening.txt\nArchive: station.txt\n',
            'survey/explanation.md': 'fish 4; ../../source/morning log.txt; пояснение пути и выбора параметра.\n'.encode(),
        }

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

    def test_accepts_crlf_readme_and_editor_folder_without_requiring_command_history(self):
        files = dict(self.valid)
        files['survey/result/README.txt'] = files['survey/result/README.txt'].replace(b'\n', b'\r\n')
        files['survey/.vscode/settings.json'] = b'{}'
        self.assertEqual('pass', self.check(files)['automated'])

    def test_rejects_lost_source_swapped_copy_changed_measurement_wrong_archive_work_and_readme(self):
        variants = []
        missing = dict(self.valid); del missing['survey/source/morning log.txt']; variants.append(missing)
        variants.append(self.valid | {'survey/result/current/morning.txt': b'A=10\nB=9\n'})
        variants.append(self.valid | {'survey/source/evening.txt': b'A=10\nB=8\n'})
        variants.append(self.valid | {'survey/result/archive/station.txt': b'temporary\n'})
        variants.append(self.valid | {'survey/work/': b''})
        variants.append(self.valid | {'survey/result/README.txt': b'Dataset: station observations\nArchive: station.txt\n'})
        variants.append(self.valid | {'survey/result/unrequested.txt': b'extra'})
        for index, files in enumerate(variants):
            with self.subTest(case=index):
                result = self.check(files)
                self.assertEqual('fail', result['automated'])
                self.assertTrue(result['errors'])

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
