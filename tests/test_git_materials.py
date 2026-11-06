"""Публикуемые starter/demo содержат обычные файлы; историю создаёт студент."""
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
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix='git material files ')
        self.addCleanup(self.tmp.cleanup); self.root = Path(self.tmp.name)
        p = self.root / 'tasks/projects/version-control/seed.json'; p.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / 'tasks/projects/version-control/seed.json', p)

    def test_starter_contains_only_three_ordinary_project_files(self) -> None:
        build(self.root)
        with zipfile.ZipFile(self.root/'tasks/materials/version-control-start.zip') as z:
            self.assertEqual({'versioning/project/README.md': README.encode(),
                              'versioning/project/criteria.txt': b'latency_limit = 25 ms\n',
                              'versioning/project/measurements.tsv': MEASUREMENTS}, {n: z.read(n) for n in z.namelist()})
        with zipfile.ZipFile(self.root/'practice/materials/version-control-demo.zip') as z:
            self.assertEqual({'latency-demo/README.md': README.encode(),
                              'latency-demo/criteria.txt': b'latency_limit = 10 ms\n',
                              'latency-demo/measurements.tsv': b'sensor\tlatency_ms\nnorth\t8\nsouth\t18\n'}, {n:z.read(n) for n in z.namelist()})



if __name__ == '__main__': unittest.main()
