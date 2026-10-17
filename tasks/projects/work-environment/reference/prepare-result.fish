#!/usr/bin/env fish
# Технический файловый fixture; explanation.md принимает человек отдельно.
if test (count $argv) -ne 1
    exit 2
end
cd -- $argv[1]; or exit 1
mkdir -p -- result/current result/archive; or exit 1
cp -- 'source/morning log.txt' result/current/morning.txt; or exit 1
cp -- source/evening.txt result/current/evening.txt; or exit 1
mv -- work/draft.txt result/archive/station.txt; or exit 1
rm -- work/scratch.txt; or exit 1
rmdir -- work; or exit 1
printf '%s\n' 'Dataset: station observations' 'Current: morning.txt, evening.txt' 'Archive: station.txt' > result/README.txt
