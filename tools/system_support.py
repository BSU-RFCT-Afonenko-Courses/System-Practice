"""Общая файловая поддержка проверок; учебные данные хранятся отдельно."""
from dataclasses import dataclass
from pathlib import PurePosixPath
import stat
import zipfile
import zlib


class ArchiveError(ValueError):
    pass


def safe_archive_name(name):
    path = PurePosixPath(name)
    if (not name or '\0' in name or not path.parts or '\\' in name or ':' in name or path.is_absolute()
            or '..' in path.parts or name.rstrip('/') != path.as_posix()):
        raise ArchiveError(f'Недопустимое имя в ZIP: {name!r}')
    return path.as_posix()


@dataclass
class Archive:
    files: dict[str, bytes]
    directories: set[str]


def read_zip(path, max_entries=1000, max_bytes=8 * 1024 * 1024):
    """Прочитать обычные файлы ZIP без распаковки и исполнения."""
    files, directories, seen = {}, set(), set()
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > max_entries or sum(e.file_size for e in entries) > max_bytes:
                raise ArchiveError('Превышен лимит средства проверки ZIP; передайте архив преподавателю для отдельной проверки')
            for entry in entries:
                original = safe_archive_name(entry.orig_filename)
                name = safe_archive_name(entry.filename)
                if original != name:
                    raise ArchiveError(f'Имя изменилось при чтении ZIP: {entry.orig_filename!r}')
                if name in seen:
                    raise ArchiveError(f'Повторное имя в ZIP: {name}')
                seen.add(name)
                kind = stat.S_IFMT(entry.external_attr >> 16)
                if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 1:
                    raise ArchiveError(f'Нужен обычный незашифрованный файл или каталог: {name}')
                if (kind == stat.S_IFDIR and not entry.is_dir()) or (kind == stat.S_IFREG and entry.is_dir()):
                    raise ArchiveError(f'Тип файла и имя в ZIP противоречат друг другу: {name}')
                for parent in PurePosixPath(name).parents:
                    if parent.as_posix() != '.':
                        directories.add(parent.as_posix())
                if entry.is_dir():
                    directories.add(name)
                else:
                    files[name] = archive.read(entry)
    except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError, UnicodeError, zlib.error) as problem:
        raise ArchiveError(f'Не удалось прочитать ZIP: {problem}') from problem
    if set(files) & directories:
        raise ArchiveError('Один путь одновременно используется как файл и каталог')
    return Archive(files, directories)
