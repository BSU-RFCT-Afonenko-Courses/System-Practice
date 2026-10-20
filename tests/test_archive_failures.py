"""Реальные повреждённые ZIP из независимой рецензии, без распаковки."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from check_work_environment import check_archive as work_check
from check_data_processing import check_archive as data_check
from system_support import ArchiveError,safe_archive_name

ROOT=Path(__file__).resolve().parents[1]
FIXTURES=ROOT/'tests/fixtures/zip'

class ArchiveFailures(unittest.TestCase):
    def test_nul_rejected_before_packing(self):
        with self.assertRaises(ArchiveError):safe_archive_name('survey/source/file.txt\0extra')

    def test_both_checkers_return_structured_failure_for_malformed_archives(self):
        for fixture in FIXTURES.glob('*.zip'):
            for check in [work_check,lambda p:data_check(p,'fish')]:
                with self.subTest(fixture=fixture.name,checker=check):
                    result=check(fixture)
                    self.assertEqual('fail',result['automated'],result)
                    self.assertTrue(result['manualRequired'])
                    self.assertTrue(result['errors'])

    def test_both_clis_save_failure_receipts_without_traceback(self):
        for fixture in FIXTURES.glob('*.zip'):
            for name,args in [('check_work_environment.py',[]),('check_data_processing.py',['--route','powershell'])]:
                with self.subTest(fixture=fixture.name,checker=name),tempfile.TemporaryDirectory() as tmp:
                    receipt=Path(tmp)/'receipt.json'
                    run=subprocess.run([sys.executable,str(ROOT/'tools'/name),str(fixture),*args,'--output',str(receipt)],capture_output=True,text=True,timeout=10)
                    self.assertEqual(1,run.returncode,run.stderr)
                    self.assertNotIn('Traceback',run.stderr)
                    result=json.loads(receipt.read_text())
                    self.assertEqual('fail',result['automated'])
                    self.assertTrue(result['manualRequired'])

if __name__=='__main__':unittest.main()
