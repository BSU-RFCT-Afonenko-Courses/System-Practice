"""Trusted published tools: observable files, stdout/stderr and exit codes."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROUTES = {'powershell': ('pwsh', '-NoProfile', '-File', 'count.ps1'),
          'fish': ('fish', '--no-config', 'count.fish')}


class WorkEnvironmentRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='system-count-runtime-')
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)

    def unpack(self, name, where):
        with zipfile.ZipFile(ROOT / name) as archive:
            archive.extractall(where)

    def invoke(self, route, root, cwd, source, output, extra=()):
        args = ROUTES[route]
        script = root / 'tools' / args[-1]
        self.assertTrue(script.is_file(), f'Published tool missing: {script.name}')
        return subprocess.run([*args[:-1], str(script), str(source), str(output), *extra],
                              cwd=cwd, capture_output=True, text=True, timeout=15)

    def each_route(self):
        for route in ROUTES:
            self.assertIsNotNone(shutil.which(ROUTES[route][0]), f'{route} is required for trusted runtime checks')
            root = self.base / route
            root.mkdir()
            yield route, root

    def test_published_inputs_produce_exact_one_and_two_line_reports(self):
        for route, where in self.each_route():
            for archive, child, source, wanted in [
                ('practice/materials/work-environment-demo.zip', 'lab', 'input/room A.txt', b'lines=1\n'),
                ('tasks/materials/work-environment-start.zip', 'survey', 'source/morning log.txt', b'lines=2\n')]:
                with self.subTest(route=route, archive=archive):
                    self.unpack(archive, where)
                    root = where / child
                    (root / 'new reports').mkdir()
                    before = (root / source).read_bytes()
                    output = root / 'new reports/count.txt'
                    run = self.invoke(route, root, root, source, 'new reports/count.txt')
                    self.assertEqual(0, run.returncode, run.stderr)
                    self.assertEqual(wanted.decode(), run.stdout)
                    self.assertEqual('', run.stderr)
                    self.assertEqual(wanted, output.read_bytes())
                    self.assertEqual(before, (root / source).read_bytes())

    def test_relative_paths_resolve_from_caller_directory(self):
        for route, where in self.each_route():
            self.unpack('practice/materials/work-environment-demo.zip', where)
            root = where / 'lab'
            output = root / 'reports/from-reports.txt'
            run = self.invoke(route, root, root / 'reports', '../input/room A.txt', 'from-reports.txt')
            self.assertEqual(0, run.returncode, run.stderr)
            self.assertEqual(b'lines=1\n', output.read_bytes())
            self.assertFalse((root / 'tools/from-reports.txt').exists())

    def test_missing_input_reports_path_and_leaves_no_new_report(self):
        for route, where in self.each_route():
            self.unpack('practice/materials/work-environment-demo.zip', where)
            root = where / 'lab'
            (root / 'reports/count.txt').write_bytes(b'previous report\n')
            run = self.invoke(route, root, root, 'input/missing.txt', 'reports/missing-count.txt')
            self.assertEqual(2, run.returncode)
            self.assertEqual('', run.stdout)
            self.assertIn('input/missing.txt', run.stderr)
            self.assertFalse((root / 'reports/missing-count.txt').exists())
            self.assertEqual(b'previous report\n', (root / 'reports/count.txt').read_bytes())

    def test_existing_output_is_preserved(self):
        for route, where in self.each_route():
            self.unpack('practice/materials/work-environment-demo.zip', where)
            root = where / 'lab'
            output = root / 'reports/count.txt'; output.write_bytes(b'keep this report\n')
            run = self.invoke(route, root, root, 'input/room A.txt', 'reports/count.txt')
            self.assertEqual(2, run.returncode)
            self.assertEqual('', run.stdout)
            self.assertIn('reports/count.txt', run.stderr)
            self.assertEqual(b'keep this report\n', output.read_bytes())
            self.assertEqual(b'north\n', (root / 'input/room A.txt').read_bytes())

    def test_missing_output_parent_is_not_created(self):
        for route, where in self.each_route():
            self.unpack('practice/materials/work-environment-demo.zip', where)
            root = where / 'lab'
            run = self.invoke(route, root, root, 'input/room A.txt', 'absent/count.txt')
            self.assertEqual(2, run.returncode)
            self.assertEqual('', run.stdout)
            self.assertIn('absent', run.stderr)
            self.assertFalse((root / 'absent').exists())
            self.assertEqual(b'north\n', (root / 'input/room A.txt').read_bytes())

    def test_absolute_paths_work_from_another_caller(self):
        for route, where in self.each_route():
            self.unpack('practice/materials/work-environment-demo.zip', where)
            root = where / 'lab'; output = root / 'reports/absolute.txt'
            run = self.invoke(route, root, where, root / 'input/room A.txt', output)
            self.assertEqual(0, run.returncode, run.stderr)
            self.assertEqual(b'lines=1\n', output.read_bytes())

    def test_missing_argument_is_rejected_without_changing_input(self):
        for route, where in self.each_route():
            self.unpack('practice/materials/work-environment-demo.zip', where)
            root = where / 'lab'; args = ROUTES[route]
            script = root / 'tools' / args[-1]
            self.assertTrue(script.is_file(), f'Published tool missing: {script.name}')
            run = subprocess.run([*args[:-1], str(script), 'input/room A.txt'], cwd=root,
                                 capture_output=True, text=True, timeout=15)
            self.assertEqual(2, run.returncode)
            self.assertEqual('', run.stdout)
            self.assertTrue(run.stderr.strip())
            self.assertEqual(b'north\n', (root / 'input/room A.txt').read_bytes())

    def test_extra_argument_is_rejected_without_output(self):
        for route, where in self.each_route():
            self.unpack('practice/materials/work-environment-demo.zip', where)
            root = where / 'lab'
            run = self.invoke(route, root, root, 'input/room A.txt', 'reports/count.txt', extra=('extra',))
            self.assertEqual(2, run.returncode)
            self.assertEqual('', run.stdout)
            self.assertTrue(run.stderr.strip())
            self.assertFalse((root / 'reports/count.txt').exists())


if __name__ == '__main__':
    unittest.main()
