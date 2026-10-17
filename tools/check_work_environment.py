#!/usr/bin/env python3
"""Проверка файлового результата; содержание explanation принимает человек."""
import argparse
import json
from pathlib import Path
from system_support import ArchiveError, read_zip

CONTRACT = Path(__file__).resolve().parents[1] / 'tasks/projects/work-environment/expected.json'


def check_archive(path):
    expected = json.loads(CONTRACT.read_text())
    errors = []
    manual = ['Смысл explanation.md: среда, относительный путь, пробел и собственный выбор по справке.',
              'Работа в выбранной оболочке и чтение результата при очном разборе.']
    try:
        archive = read_zip(path)
        prefix = expected['root'] + '/'
        members = set(archive.files) | archive.directories
        if any(name != expected['root'] and not name.startswith(prefix) for name in members):
            errors.append('ZIP должен содержать один корень survey с результатом внутри него')
        files = {name.removeprefix(prefix): data for name, data in archive.files.items() if name.startswith(prefix)}
        for name, text in expected['exactFiles'].items():
            if name not in files:
                errors.append(f'Файл отсутствует: {name}')
            elif files[name] != text.encode('utf-8'):
                errors.append(f'Содержимое не совпало с условием: {name}')
        allowed = set(expected['exactFiles']) | {'result/README.txt'}
        for name in sorted(files):
            if name.startswith(('source/', 'result/')) and name not in allowed:
                errors.append(f'Лишний учебный файл: {name}')
        if any(name == prefix + 'work' or name.startswith(prefix + 'work/') for name in members):
            errors.append('Каталог work должен отсутствовать после завершения работы')
        try:
            readme = files.get('result/README.txt', b'').decode('utf-8').replace('\r\n', '\n')
            if '\r' in readme or readme.removesuffix('\n').split('\n') != expected['readmeLines']:
                errors.append('result/README.txt должен содержать три заданные строки UTF-8 без BOM')
        except UnicodeDecodeError:
            errors.append('result/README.txt не читается как UTF-8')
        try:
            if not files.get('explanation.md', b'').decode('utf-8-sig').strip():
                errors.append('Нужен непустой читаемый explanation.md')
        except UnicodeDecodeError:
            errors.append('explanation.md не читается как UTF-8')
    except ArchiveError as problem:
        errors.append(str(problem))
    return {'automated': 'fail' if errors else 'pass', 'errors': errors, 'manualRequired': manual}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = check_archive(args.archive)
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(text)
    print(text, end='')
    return 0 if result['automated'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
