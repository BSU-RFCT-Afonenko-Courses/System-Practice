"""Общие гарантии чтения ZIP сохраняются независимо от предметного задания."""

from pathlib import Path
import stat
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from system_support import ArchiveError, ArchiveLimit, read_zip


class ZipArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="system-zip-reader-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "submission.zip"

    def test_preserves_bytes_hidden_files_and_parent_directories(self) -> None:
        with zipfile.ZipFile(self.path, "w") as archive:
            archive.writestr("survey/source/заметки.txt", b"\xff\x00")
            archive.writestr("survey/.git/HEAD", b"ref: refs/heads/main\n")
        result = read_zip(self.path)
        self.assertEqual(
            {
                "survey/source/заметки.txt": b"\xff\x00",
                "survey/.git/HEAD": b"ref: refs/heads/main\n",
            },
            result.files,
        )
        self.assertEqual({"survey", "survey/source", "survey/.git"}, result.directories)
        self.assertEqual([self.path], list(self.path.parent.iterdir()))

    def test_rejects_unsafe_paths_duplicate_names_and_symlinks(self) -> None:
        for kind in ["traversal", "absolute", "duplicate", "symlink"]:
            with self.subTest(kind=kind):
                with zipfile.ZipFile(self.path, "w") as archive:
                    if kind == "traversal":
                        archive.writestr("../outside.txt", b"data")
                    elif kind == "absolute":
                        archive.writestr("/outside.txt", b"data")
                    elif kind == "duplicate":
                        archive.writestr("survey/a", b"first")
                        with self.assertWarns(UserWarning):
                            archive.writestr("survey/a", b"second")
                    else:
                        info = zipfile.ZipInfo("survey/link")
                        info.create_system = 3
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                        archive.writestr(info, b"/tmp/outside")
                with self.assertRaises(ArchiveError):
                    read_zip(self.path)
                self.assertFalse((self.path.parent / "outside.txt").exists())

    def test_rejects_contradictory_regular_file_and_directory_modes(self) -> None:
        for name, mode in [("survey/a", stat.S_IFDIR), ("survey/a/", stat.S_IFREG)]:
            with self.subTest(name=name):
                with zipfile.ZipFile(self.path, "w") as archive:
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = (mode | 0o644) << 16
                    archive.writestr(info, b"")
                with self.assertRaises(ArchiveError):
                    read_zip(self.path)

    def test_file_cannot_also_be_a_parent_directory(self) -> None:
        for names in [("survey/a", "survey/a/b"), ("survey/a/b", "survey/a")]:
            with self.subTest(names=names):
                with zipfile.ZipFile(self.path, "w") as archive:
                    for name in names:
                        archive.writestr(name, b"data")
                with self.assertRaises(ArchiveError):
                    read_zip(self.path)

    def test_reader_reports_resource_limits_separately(self) -> None:
        with zipfile.ZipFile(self.path, "w") as archive:
            archive.writestr("survey/a", b"12345")
            archive.writestr("survey/b", b"67890")
        for limits in [{"max_entries": 1}, {"max_bytes": 9}]:
            with self.subTest(limits=limits), self.assertRaises(ArchiveLimit):
                read_zip(self.path, **limits)


if __name__ == "__main__":
    unittest.main()
