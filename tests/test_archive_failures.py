"""Повреждение ZIP и ресурсный предел дают разные достоверные квитанции."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from check_data_processing import check_archive as data_check
from system_support import ArchiveError, safe_archive_name, json_object, read_json

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/zip"


def limited_archive(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for index in range(1001):
            archive.writestr(f"processing/extra/item-{index}", b"x")


class ArchiveFailures(unittest.TestCase):
    def test_nul_rejected_before_packing(self) -> None:
        with self.assertRaises(ArchiveError):
            safe_archive_name("survey/source/file.txt\0extra")

    def test_checker_returns_structured_failure_for_malformed_archives(self) -> None:
        for fixture in FIXTURES.glob("*.zip"):
            for route in ["fish", "powershell"]:
                with self.subTest(fixture=fixture.name, route=route):
                    result = data_check(fixture, route)
                    self.assertEqual("fail", result["automated"], result)
                    self.assertTrue(result["manualRequired"])
                    self.assertTrue(result["errors"])

    def test_cli_saves_failure_receipts_without_traceback(self) -> None:
        for fixture in FIXTURES.glob("*.zip"):
            for route in ["fish", "powershell"]:
                with (
                    self.subTest(fixture=fixture.name, route=route),
                    tempfile.TemporaryDirectory() as temporary,
                ):
                    receipt = Path(temporary) / "receipt.json"
                    run = subprocess.run(
                        [
                            sys.executable,
                            str(ROOT / "tools/check_data_processing.py"),
                            str(fixture),
                            "--route",
                            route,
                            "--output",
                            str(receipt),
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    self.assertEqual(1, run.returncode, run.stderr)
                    self.assertNotIn("Traceback", run.stderr)
                    result = json_object(read_json(receipt))
                    self.assertEqual("fail", result["automated"])
                    self.assertTrue(result["manualRequired"])

    def test_archive_limit_requires_manual_review_without_contract_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "limited.zip"
            limited_archive(path)
            for route in ["fish", "powershell"]:
                with self.subTest(route=route):
                    result = data_check(path, route)
                    self.assertEqual("manual", result["automated"], result)
                    self.assertTrue(result.get("toolLimited"))
                    self.assertEqual([], result["errors"])
                    self.assertTrue(result.get("diagnostics"))
                    self.assertTrue(result["manualRequired"])

    def test_cli_saves_manual_receipt_and_code_two_at_archive_limit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "limited.zip"
            limited_archive(path)
            for route in ["fish", "powershell"]:
                with self.subTest(route=route):
                    receipt = Path(temporary) / f"{route}.json"
                    run = subprocess.run(
                        [
                            sys.executable,
                            str(ROOT / "tools/check_data_processing.py"),
                            str(path),
                            "--route",
                            route,
                            "--output",
                            str(receipt),
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    self.assertEqual(2, run.returncode, run.stderr)
                    self.assertNotIn("Traceback", run.stderr)
                    result = json_object(read_json(receipt))
                    self.assertEqual("manual", result["automated"])
                    self.assertTrue(result["toolLimited"])
                    self.assertEqual([], result["errors"])
                    self.assertTrue(result["diagnostics"])
                    self.assertTrue(result["manualRequired"])


if __name__ == "__main__":
    unittest.main()
