#!/usr/bin/env fish
if test (count $argv) -ne 2
    printf '%s\n' 'Нужны два пути: входной файл и новый отчёт.' >&2
    exit 2
end
set -l source $argv[1]
set -l report $argv[2]
if not test -f "$source"
    printf 'Входной файл не найден: %s\n' "$source" >&2
    exit 2
end
if test -e "$report"
    printf 'Отчёт уже существует: %s\n' "$report" >&2
    exit 2
end
set -l parent (dirname -- "$report")
if not test -d "$parent"
    printf 'Родительский каталог отчёта отсутствует: %s\n' "$parent" >&2
    exit 2
end
set -l lines (wc -l < "$source")
or begin
    printf 'Не удалось прочитать входной файл: %s\n' "$source" >&2
    exit 2
end
printf 'lines=%s\n' "$lines" > "$report"
or begin
    printf 'Не удалось создать отчёт: %s\n' "$report" >&2
    exit 2
end
printf 'lines=%s\n' "$lines"
