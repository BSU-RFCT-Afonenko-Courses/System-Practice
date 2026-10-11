"""Проверки результата; выполняются доверенным supervisor, не ответом студента."""
from pathlib import Path
def cases(tests):
    headers=(Path(tests)/'headers.txt').read_text(encoding='utf-8')
    original=next(line for line in headers.splitlines() if line.startswith('Last-Modified:'))
    alternate=headers.replace(original,'Last-Modified: Wed, 07 Oct 2026 18:19:20 GMT')
    return [{'headers.txt':headers},{'headers.txt':alternate}]
def text(root, name):
    file=Path(root)/name
    if file.is_symlink() or not file.is_file() or file.stat().st_size>65536: return None
    return file.read_text(encoding='utf-8',errors='replace')

def check(root, inputs):
    headers=inputs['headers.txt']
    expected=next(line for line in headers.splitlines() if line.startswith('Last-Modified:'))
    result=text(root,'last-modified.txt')
    errors=text(root,'errors.txt')
    return [
        ('Строка Last-Modified сохранена и дописана без остальных заголовков',result==expected+'\n'+expected+'\n'),
        ('Ошибка чтения отдельного отсутствующего файла сохранена',bool(errors and 'missing.txt' in errors)),
    ]
