"""Read a full Git submission as data, without extracting archive paths."""
import gzip
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import system_support


class TarArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='system-tar-reader-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'submission.tar.gz'

    def write(self, entries):
        with tarfile.open(self.path, 'w:gz') as archive:
            for name, data, kind in entries:
                entry = tarfile.TarInfo(name)
                entry.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    entry.linkname = '/tmp/outside'
                if kind == tarfile.REGTYPE:
                    entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data) if entry.size else None)

    def read(self, **limits):
        self.assertTrue(callable(getattr(system_support, 'read_tar_gz', None)),
                        'Published tar.gz submissions need a safe data reader')
        return system_support.read_tar_gz(self.path, **limits)

    def test_preserves_hidden_git_files_and_unicode_paths(self):
        self.write([
            ('versioning/', b'', tarfile.DIRTYPE),
            ('versioning/project/.git/HEAD', b'ref: refs/heads/main\n', tarfile.REGTYPE),
            ('versioning/project/.git/objects/ab/1234', b'compressed object\0', tarfile.REGTYPE),
            ('versioning/project/заметки.txt', 'Секунды\n'.encode(), tarfile.REGTYPE),
        ])
        result = self.read()
        self.assertEqual({
            'versioning/project/.git/HEAD': b'ref: refs/heads/main\n',
            'versioning/project/.git/objects/ab/1234': b'compressed object\0',
            'versioning/project/заметки.txt': 'Секунды\n'.encode(),
        }, result.files)
        self.assertIn('versioning/project/.git/objects/ab', result.directories)
        self.assertEqual([self.path], list(Path(self.temp.name).iterdir()))

    def test_rejects_traversal_absolute_paths_and_duplicate_members(self):
        for names in [('../outside',), ('/outside',), ('versioning/a', 'versioning/a')]:
            with self.subTest(names=names):
                self.write([(name, b'data', tarfile.REGTYPE) for name in names])
                with self.assertRaises(system_support.ArchiveError):
                    self.read()

    def test_rejects_links_and_special_members(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE,
                     tarfile.BLKTYPE, tarfile.FIFOTYPE, tarfile.GNUTYPE_SPARSE]:
            with self.subTest(kind=kind):
                self.write([('versioning/link', b'', kind)])
                with self.assertRaises(system_support.ArchiveError):
                    self.read()

    def test_file_cannot_also_be_a_parent_directory(self):
        for names in [('versioning/a', 'versioning/a/b'),
                      ('versioning/a/b', 'versioning/a')]:
            with self.subTest(names=names):
                self.write([(name, b'data', tarfile.REGTYPE) for name in names])
                with self.assertRaises(system_support.ArchiveError):
                    self.read()

    def test_member_count_and_expanded_file_bytes_are_bounded(self):
        self.write([('versioning/a', b'12345', tarfile.REGTYPE),
                    ('versioning/b', b'67890', tarfile.REGTYPE)])
        for limits in [{'max_entries': 1}, {'max_bytes': 9}]:
            with self.subTest(limits=limits):
                with self.assertRaises(system_support.ArchiveError):
                    self.read(**limits)

    def test_decompressed_container_size_is_bounded_before_tar_parsing(self):
        self.path.write_bytes(gzip.compress(b'\0' * 100000))
        with self.assertRaises(system_support.ArchiveError):
            self.read(max_entries=1, max_bytes=1)

    def test_corrupt_or_truncated_gzip_is_a_readable_archive_error(self):
        for content in [b'not gzip', gzip.compress(b'not tar')[:-4]]:
            with self.subTest(content=content):
                self.path.write_bytes(content)
                with self.assertRaises(system_support.ArchiveError):
                    self.read()


if __name__ == '__main__':
    unittest.main()
