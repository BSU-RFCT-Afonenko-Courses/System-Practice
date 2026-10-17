#!/usr/bin/env python3
"""Проверить файлы обработки данных без исполнения присланных сценариев."""
import argparse
import csv
import io
import json
from pathlib import Path
from system_support import ArchiveError, read_zip

MATERIALS = Path(__file__).resolve().parents[1] / 'tasks/projects/data-processing/materials.json'


def csv_rows(data):
    text = data.decode('utf-8')
    if '\r' in text.replace('\r\n', '') or text.startswith('\ufeff'):
        raise ValueError('CSV: нужны UTF-8 без BOM и переводы LF/CRLF')
    rows = list(csv.reader(io.StringIO(text, newline=''), strict=True))
    if not rows or rows[0] != ['Code', 'Units'] or any(len(row) != 2 for row in rows[1:]):
        raise ValueError('CSV: нужны ровно колонки Code,Units и две ячейки в записи')
    return rows


def check_archive(path, route):
    if route not in ('fish', 'powershell'):
        raise ValueError('Выберите fish или powershell')
    errors = []
    manual = ['Сценарий выполняет собственный содержательный конвейер для каждого из двух представлений; данные между стадиями объяснены.',
              'Среда, команды, stdout/stderr и коды трёх процессов подтверждаются разбором и запуском в проверенной среде.',
              'Объяснены числовой порядок, пустая выборка, ошибка входа и сравнение результата.']
    data = json.loads(MATERIALS.read_text())['tasks/materials/data-processing-start.zip']
    ext = 'txt' if route == 'fish' else 'csv'
    script = 'select.fish' if route == 'fish' else 'Select-Readings.ps1'
    try:
        archive = read_zip(path)
        members = set(archive.files) | archive.directories
        if any(n != 'processing' and not n.startswith('processing/') for n in members):
            errors.append('ZIP должен содержать один корень processing')
        files = {n.removeprefix('processing/'): b for n,b in archive.files.items() if n.startswith('processing/')}
        for name, text in data.items():
            relative = name.removeprefix('processing/')
            if files.get(relative) != text.encode('utf-8'):
                errors.append(f'Исходный файл отсутствует или изменён: {relative}')
        original_names = {name.removeprefix('processing/') for name in data}
        for name in files:
            if name.startswith(('inputs/', 'expected/')) and name not in original_names:
                errors.append(f'Лишний исходный файл: {name}')
        for name in [script, 'explanation.md']:
            try:
                if not files.get(name, b'').decode('utf-8-sig').strip():
                    errors.append(f'Нужен непустой читаемый файл: {name}')
            except UnicodeDecodeError:
                errors.append(f'Файл не читается как UTF-8: {name}')
        for output, expected_name in [('selected','selected'),('excluded','excluded'),
                                      ('no-match-excluded','no-match-excluded')]:
            name = f'results/{output}.{ext}'
            expected = data[f'processing/expected/{expected_name}.{ext}'].encode()
            if name not in files:
                errors.append(f'Результат отсутствует: {name}')
                continue
            try:
                actual = files[name]
                equal = actual == expected if route == 'fish' else csv_rows(actual) == csv_rows(expected)
                if not equal: errors.append(f'Данные или порядок результата не совпали: {name}')
            except (UnicodeDecodeError, ValueError, csv.Error) as problem:
                errors.append(f'{name}: {problem}')
        for name in [f'results/empty.{ext}', 'results/selected.err', 'results/empty.err']:
            if files.get(name) != b'':errors.append(f'Нужен файл ровно нулевой длины: {name}')
        try:
            diagnostic = files.get('results/missing.err', b'').decode('utf-8')
            if f'absent.{ext}' not in diagnostic:errors.append('Диагностика missing.err должна содержать имя отсутствующего входа')
        except UnicodeDecodeError:
            errors.append('Диагностика missing.err не читается как UTF-8')
        for stem in ['missing-selected','missing-excluded']:
            missing = f'processing/results/{stem}.{ext}'
            if missing in members or any(n.startswith(missing + '/') for n in members):
                errors.append(f'После ошибки выходной файл должен отсутствовать: {stem}.{ext}')
    except ArchiveError as problem:
        errors.append(str(problem))
    return {'automated': 'fail' if errors else 'pass', 'errors': errors, 'manualRequired': manual}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--route', choices=['fish','powershell'], required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = check_archive(args.archive, args.route)
    text = json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:args.output.write_text(text)
    print(text,end='')
    return result['automated'] != 'pass'

if __name__ == '__main__':raise SystemExit(main())
