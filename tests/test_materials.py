import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_materials import build

SOURCE = Path(__file__).resolve().parents[1] / 'tasks/projects/work-environment/materials.json'


class MaterialsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='system-materials-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / 'tasks/projects/work-environment/materials.json'
        self.data.parent.mkdir(parents=True)
        shutil.copyfile(SOURCE, self.data)
        common = self.root / 'tasks/common/work-environment'
        common.mkdir(parents=True)
        for script in ['count.fish', 'count.ps1']:
            shutil.copyfile(SOURCE.parents[2] / 'common/work-environment' / script, common / script)

    def test_missing_check_does_not_write(self):
        with self.assertRaises(ValueError):
            build(self.root, write=False)
        self.assertFalse((self.root / 'practice').exists())

    def test_build_is_repeatable_and_contains_exact_author_data(self):
        build(self.root, write=True)
        paths = [self.root / 'practice/materials/work-environment-demo.zip',
                 self.root / 'tasks/materials/work-environment-start.zip']
        before = [p.read_bytes() for p in paths]
        build(self.root, write=True)
        self.assertEqual(before, [p.read_bytes() for p in paths])
        build(self.root, write=False)
        with zipfile.ZipFile(paths[0]) as archive:
            self.assertEqual({'lab/input/room A.txt', 'lab/reports/input/room A.txt',
                              'lab/tools/count.ps1', 'lab/tools/count.fish'}, set(archive.namelist()))
            demo_tools = {name: archive.read('lab/tools/' + name) for name in ['count.ps1', 'count.fish']}
            self.assertEqual(b'north\n', archive.read('lab/input/room A.txt'))
            self.assertEqual(b'south\n', archive.read('lab/reports/input/room A.txt'))
        with zipfile.ZipFile(paths[1]) as archive:
            self.assertEqual({'survey/source/morning log.txt': b'A=12\nB=7\n',
                              'survey/source/evening.txt': b'A=10\nB=9\n',
                              'survey/work/draft.txt': b'station=west\n',
                              'survey/work/scratch.txt': b'temporary\n',
                              'survey/tools/count.ps1': demo_tools['count.ps1'],
                              'survey/tools/count.fish': demo_tools['count.fish']},
                             {n: archive.read(n) for n in archive.namelist()})

    def test_projects_keep_separate_manifests_and_preserve_other_archives(self):
        build(self.root, write=True)
        baseline = (self.root / 'practice/materials/work-environment-demo.zip').read_bytes()
        data = self.root / 'tasks/projects/data-processing/materials.json'
        data.parent.mkdir(parents=True)
        data.write_text(json.dumps({'tasks/materials/data-processing-start.zip': {
            'processing/expected/empty.txt': '', 'processing/inputs/readings.txt': 'B01|2|keep\n'}}))
        build(self.root, write=True, project='data-processing')
        build(self.root, write=False, project='data-processing')
        self.assertEqual(baseline, (self.root / 'practice/materials/work-environment-demo.zip').read_bytes())
        self.assertFalse((self.root / 'tasks/projects/data-processing/materials-hashes.json').samefile(
            self.root / 'tasks/projects/work-environment/materials-hashes.json'))
        with self.assertRaises(ValueError):
            build(self.root, write=True, project='../work-environment')

    def test_unexpected_local_zip_edit_stops_update(self):
        build(self.root, write=True)
        demo = self.root / 'practice/materials/work-environment-demo.zip'
        start = self.root / 'tasks/materials/work-environment-start.zip'
        before = start.read_bytes()
        demo.write_bytes(b'user local change')
        data = json.loads(self.data.read_text())
        data['tasks/materials/work-environment-start.zip']['survey/work/draft.txt'] = 'new data\n'
        self.data.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            build(self.root, write=True)
        self.assertEqual(b'user local change', demo.read_bytes())
        self.assertEqual(before, start.read_bytes())


if __name__ == '__main__':
    unittest.main()
