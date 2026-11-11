"""Общая файловая поддержка проверок; учебные данные хранятся отдельно."""
from dataclasses import dataclass
from typing import Literal, NotRequired, TypeGuard, TypedDict
from collections.abc import Mapping, Sequence
import json
import gzip
import io
from pathlib import Path, PurePosixPath
import stat
import tarfile
import zipfile
import zlib


def read_json(path: Path) -> object:
    return json.loads(path.read_text())


def _object_container(value: object) -> TypeGuard[Mapping[object, object]]:
    return isinstance(value, dict)


def _list_container(value: object) -> TypeGuard[Sequence[object]]:
    return isinstance(value, list)


def json_object(value: object) -> dict[str, object]:
    if not _object_container(value):
        raise ValueError('JSON: ожидался объект')
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise ValueError('JSON: ожидался строковый ключ')
        result[key] = item
    return result


def json_string(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError('JSON: ожидалась строка')
    return value


def json_strings(value: object) -> list[str]:
    if not _list_container(value):
        raise ValueError('JSON: ожидался список строк')
    return [json_string(item) for item in value]


def json_texts(value: object) -> dict[str, str]:
    return {key: json_string(item) for key, item in json_object(value).items()}


class CheckResult(TypedDict):
    automated: Literal['pass', 'fail', 'manual']
    errors: list[str]
    manualRequired: list[str]
    toolLimited: NotRequired[bool]
    diagnostics: NotRequired[list[str]]


class ArchiveError(ValueError):
    pass


class ArchiveLimit(ArchiveError):
    """Средство исчерпало ресурсный предел; нарушение учебного договора не установлено."""
    pass


def safe_archive_name(name: str) -> str:
    path = PurePosixPath(name)
    if (not name or '\0' in name or not path.parts or '\\' in name or ':' in name or path.is_absolute()
            or '..' in path.parts or name.rstrip('/') != path.as_posix()):
        raise ArchiveError(f'Недопустимое имя в архиве: {name!r}')
    return path.as_posix()


@dataclass
class Archive:
    files: dict[str, bytes]
    directories: set[str]


def read_zip(path: str | Path, max_entries: int = 1000, max_bytes: int = 8 * 1024 * 1024) -> Archive:
    """Прочитать обычные файлы ZIP без распаковки и исполнения."""
    files: dict[str, bytes] = {}
    directories: set[str] = set()
    seen: set[str] = set()
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > max_entries or sum(e.file_size for e in entries) > max_bytes:
                raise ArchiveLimit('Превышен лимит средства проверки ZIP; передайте архив преподавателю для отдельной проверки')
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


def read_tar_gz(path: str | Path, max_entries: int = 1000, max_bytes: int = 8 * 1024 * 1024) -> Archive:
    """Прочитать обычные файлы tar.gz как данные без извлечения и ссылок."""
    files: dict[str, bytes] = {}
    directories: set[str] = set()
    seen: set[str] = set()
    # Ограничиваем также контейнер: заголовки gzip/PAX и заполнение входят в предел.
    # Оставляем место для обычных заголовков tar, имён и завершающего заполнения.
    container_limit = max_bytes + max_entries * 4096 + 10240
    try:
        with gzip.GzipFile(filename=path, mode='rb') as compressed:
            expanded = compressed.read(container_limit + 1)
        if len(expanded) > container_limit:
            raise ArchiveLimit('Превышен лимит распакованного tar.gz; передайте архив преподавателю для отдельной проверки')
        total = 0
        with tarfile.open(fileobj=io.BytesIO(expanded), mode='r:') as archive:
            for entry in archive:
                name = safe_archive_name(entry.name)
                if len(seen) >= max_entries:
                    raise ArchiveLimit('Превышен лимит записей tar.gz; передайте архив преподавателю для отдельной проверки')
                if name in seen:
                    raise ArchiveError(f'Повторное имя в tar.gz: {name}')
                seen.add(name)
                if entry.issparse() or not (entry.isreg() or entry.isdir()):
                    raise ArchiveError(f'Нужен обычный файл или каталог tar.gz: {name}')
                if entry.size < 0 or (entry.isdir() and entry.size):
                    raise ArchiveError(f'Неверный размер записи tar.gz: {name}')
                total += entry.size
                if total > max_bytes:
                    raise ArchiveLimit('Превышен лимит данных tar.gz; передайте архив преподавателю для отдельной проверки')
                for parent in PurePosixPath(name).parents:
                    if parent.as_posix() != '.':
                        directories.add(parent.as_posix())
                if entry.isdir():
                    directories.add(name)
                else:
                    stream = archive.extractfile(entry)
                    if stream is None:
                        raise ArchiveError(f'Не удалось прочитать файл tar.gz: {name}')
                    with stream:
                        data = stream.read(entry.size + 1)
                    if len(data) != entry.size:
                        raise ArchiveError(f'Неверный размер файла tar.gz: {name}')
                    files[name] = data
    except (tarfile.TarError, OSError, EOFError, UnicodeError, zlib.error) as problem:
        raise ArchiveError(f'Не удалось прочитать tar.gz: {problem}') from problem
    if set(files) & directories:
        raise ArchiveError('Один путь одновременно используется как файл и каталог')
    return Archive(files, directories)
