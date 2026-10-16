"""Факты результата; конвейер и объяснение проверяет преподаватель."""
import csv
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from check_data_processing import check_archive

ROOT = Path(__file__).resolve().parents[1]

class DataProcessingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='system-data-result-')
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'submission.zip'
        data = json.loads((ROOT / 'tasks/projects/data-processing/materials.json').read_text())
        self.base = {n: t.encode() for n, t in data['tasks/materials/data-processing-start.zip'].items()}
        self.base['processing/explanation.md'] = 'Среда и наблюдения; смысл оценивает преподаватель.'.encode()

    def valid(self, route):
        ext = 'txt' if route == 'fish' else 'csv'
        script = 'select.fish' if route == 'fish' else 'Select-Readings.ps1'
        return self.base | {f'processing/{script}': b'not executed by the archive checker\n',
            f'processing/results/selected.{ext}': self.base[f'processing/expected/selected.{ext}'],
            f'processing/results/excluded.{ext}': self.base[f'processing/expected/excluded.{ext}'],
            f'processing/results/no-match-excluded.{ext}': self.base[f'processing/expected/no-match-excluded.{ext}'],
            f'processing/results/empty.{ext}': b'',
            'processing/results/selected.err': b'', 'processing/results/empty.err': b'',
            'processing/results/missing.err': f'Cannot read inputs/absent.{ext}\n'.encode()}

    def check(self, files, route):
        with zipfile.ZipFile(self.path, 'w') as z:
            for name, value in files.items():z.writestr(name, value)
        return check_archive(self.path, route)

    def test_both_routes_keep_method_and_process_claims_manual(self):
        for route in ('fish','powershell'):
            with self.subTest(route=route):
                result = self.check(self.valid(route), route)
                self.assertEqual('pass', result['automated'], result)
                self.assertGreaterEqual(len(result['manualRequired']), 2)

    def test_powershell_csv_accepts_quoted_crlf_with_optional_final_newline(self):
        files = self.valid('powershell')
        files['processing/results/selected.csv'] = b'"Code","Units"\r\n"B05","0"\r\n"B01","2"\r\n"B02","10"\r\n"B03","10"'
        self.assertEqual('pass', self.check(files, 'powershell')['automated'])

    def test_wrong_order_value_columns_empty_output_diagnostics_and_inputs_fail(self):
        variants = [('fish','results/selected.txt', b'B05|0\nB02|10\nB03|10\nB01|2\n'),
            ('fish','results/selected.txt', b'B05|0\nB01|3\nB02|10\nB03|10\n'),
            ('fish','results/selected.txt', b'B05|0\r\nB01|2\r\nB02|10\r\nB03|10\r\n'),
            ('powershell','results/selected.csv', b'Units,Code\n0,B05\n2,B01\n10,B02\n10,B03\n'),
            ('powershell','results/selected.csv', b'Code,Units\nB05,00\nB01,2\nB02,10\nB03,10\n'),
            ('powershell','results/empty.csv', b'Code,Units\n'),
            ('fish','results/empty.txt', b'\n'),('fish','results/selected.err',b'warning'),
            ('fish','results/missing.err', b''),('fish','results/missing-selected.txt', b''),('powershell','results/missing-excluded.csv',b''),
            ('fish','results/excluded.txt',b'B06|9\nB04|20\n'),('powershell','results/no-match-excluded.csv',b''),
            ('fish','inputs/readings.txt', b'changed'),('fish','inputs/absent.txt',b'fake'),('powershell','expected/extra.csv',b'new'),('powershell','expected/empty.csv',b'changed')]
        for route, name, value in variants:
            with self.subTest(route=route,name=name):
                files = self.valid(route) | {f'processing/{name}': value}
                self.assertEqual('fail', self.check(files, route)['automated'])

    def test_old_single_output_demo_does_not_satisfy_independent_contract(self):
        for route in ['fish','powershell']:
            files=self.valid(route);ext='txt' if route=='fish' else 'csv'
            del files[f'processing/results/excluded.{ext}']
            del files[f'processing/results/no-match-excluded.{ext}']
            self.assertEqual('fail',self.check(files,route)['automated'])

    def test_missing_script_or_unreadable_explanation_fails(self):
        files=self.valid('fish');del files['processing/select.fish']
        self.assertEqual('fail', self.check(files,'fish')['automated'])
        files=self.valid('fish') | {'processing/explanation.md': b'\xff'}
        self.assertEqual('fail', self.check(files,'fish')['automated'])

if __name__ == '__main__':unittest.main()
