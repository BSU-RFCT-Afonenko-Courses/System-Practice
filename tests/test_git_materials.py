"""Публикуемые starter/demo содержат обычные файлы; историю создаёт студент."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_git_materials import build
from git_fixture import README, MEASUREMENTS
ROOT = Path(__file__).resolve().parents[1]


class GitMaterials(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='git material files ')
        self.addCleanup(self.tmp.cleanup); self.root = Path(self.tmp.name)
        p = self.root / 'tasks/projects/version-control/seed.json'; p.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / 'tasks/projects/version-control/seed.json', p)

    def test_repeatable_starter_contains_only_three_ordinary_project_files(self):
        first = build(self.root, write=True); before = {n: (self.root/n).read_bytes() for n in first}
        self.assertEqual(first, build(self.root, write=True)); self.assertEqual(before, {n: (self.root/n).read_bytes() for n in first})
        build(self.root, write=False)
        with zipfile.ZipFile(self.root/'tasks/materials/version-control-start.zip') as z:
            self.assertEqual({'versioning/project/README.md': README.encode(),
                              'versioning/project/criteria.txt': b'latency_limit = 25 ms\n',
                              'versioning/project/measurements.tsv': MEASUREMENTS}, {n: z.read(n) for n in z.namelist()})
        with zipfile.ZipFile(self.root/'practice/materials/version-control-demo.zip') as z:
            self.assertEqual({'latency-demo/README.md': README.encode(),
                              'latency-demo/criteria.txt': b'latency_limit = 10 ms\n',
                              'latency-demo/measurements.tsv': b'sensor\tlatency_ms\nnorth\t8\nsouth\t18\n'}, {n:z.read(n) for n in z.namelist()})

    def test_check_is_read_only_and_local_archive_edit_is_preserved(self):
        with self.assertRaises(ValueError): build(self.root, write=False)
        self.assertFalse((self.root/'practice').exists())
        build(self.root, write=True); p=self.root/'tasks/materials/version-control-start.zip';p.write_bytes(b'local change')
        other=self.root/'practice/materials/version-control-demo.zip';before=other.read_bytes()
        with self.assertRaises(ValueError): build(self.root, write=True)
        self.assertEqual(b'local change',p.read_bytes());self.assertEqual(before,other.read_bytes())


if __name__ == '__main__': unittest.main()
