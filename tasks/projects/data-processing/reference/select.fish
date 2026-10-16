# Два самостоятельных представления, по авторскому договору v2.
if not test -f "$argv[1]"
    printf 'Нет входного файла: %s\n' "$argv[1]" >&2
    exit 1
end
grep '|keep$' -- "$argv[1]" | env LC_ALL=C sort -t '|' -k2,2n -k1,1 | cut -d '|' -f1,2 > "$argv[2]"
grep '|skip$' -- "$argv[1]" | env LC_ALL=C sort -t '|' -k1,1 | cut -d '|' -f1,2 > "$argv[3]"
