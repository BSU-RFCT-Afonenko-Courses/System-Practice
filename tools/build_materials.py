#!/usr/bin/env python3
"""Детерминированная упаковка объявленных учебных данных."""
import argparse
import hashlib
import io
import json
import os
import re
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
import zipfile
from system_support import safe_archive_name


def target(root, relative):
    safe_archive_name(relative)
    current = root
    parts = PurePosixPath(relative).parts
    for index, component in enumerate(parts):
        current = current / component
        if current.is_symlink() or (current.exists() and index < len(parts) - 1 and not current.is_dir()):
            raise ValueError(f'Небезопасный путь: {relative}')
    if current.exists() and not current.is_file():
        raise ValueError(f'Ожидался обычный файл: {relative}')
    return current


def packed(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, text in sorted(entries.items()):
            safe_archive_name(name)
            if name.endswith('/') or not isinstance(text, (str, bytes)):
                raise ValueError('Материалы задают обычные файлы как UTF-8 текст или точные байты')
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 16, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, text.encode('utf-8') if isinstance(text,str) else text)
    return output.getvalue()


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name + '.', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def build(root, write=False, project="work-environment"):
    root = Path(root).resolve(strict=True)
    if not re.fullmatch(r'[a-z][a-z0-9-]*', project):
        raise ValueError('Недопустимое имя проекта материалов')
    directory = f'tasks/projects/{project}'
    data = json.loads(target(root, directory + '/materials.json').read_text())
    if project == 'work-environment':
        for archive, prefix in [('practice/materials/work-environment-demo.zip', 'lab'),
                                ('tasks/materials/work-environment-start.zip', 'survey')]:
            for script in ['count.fish', 'count.ps1']:
                member = prefix + '/tools/' + script
                if member in data[archive]:
                    raise ValueError('Повторный источник общего счётчика: ' + member)
                data[archive][member] = target(root, 'tasks/common/work-environment/' + script).read_bytes()
    index = target(root, directory + '/materials-hashes.json')
    previous = json.loads(index.read_text()) if index.exists() else {}
    planned = {}
    for name, entries in data.items():
        if not name.startswith(('practice/materials/', 'tasks/materials/')) or not name.endswith('.zip'):
            raise ValueError(f'Не объявлен каталог публикации материала: {name}')
        path = target(root, name)
        content = packed(entries)
        expected = hashlib.sha256(content).hexdigest()
        actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
        if actual is not None and actual != expected and actual != previous.get(name):
            raise ValueError(f'Локальная правка ZIP сохранена: {name}')
        planned[name] = (path, content, expected, actual)
    if not planned or set(previous) - set(planned):
        raise ValueError('Пустой или уменьшенный состав материалов требует отдельного рассмотрения')
    hashes = {name: row[2] for name, row in sorted(planned.items())}
    if not write:
        if previous != hashes or any(expected != actual for _, _, expected, actual in planned.values()):
            raise ValueError('Материалы отсутствуют или устарели; нужна проверенная упаковка --write')
        return hashes
    # Проверки всех путей и локальных правок завершены до первой записи.
    for path, content, expected, actual in planned.values():
        if expected != actual:
            atomic_write(path, content)
    content = (json.dumps(hashes, ensure_ascii=False, indent=2) + '\n').encode()
    if not index.exists() or index.read_bytes() != content:
        atomic_write(index, content)
    return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--project', default='work-environment')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    print(json.dumps(build(args.root, write=args.write, project=args.project), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as problem:
        print(problem, file=sys.stderr)
        raise SystemExit(1)
