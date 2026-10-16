param([Parameter(Mandatory)][string]$Survey)
# Технический файловый fixture; explanation.md принимает человек отдельно.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Survey
New-Item -ItemType Directory -Path 'result/current', 'result/archive' -Force | Out-Null
Copy-Item -LiteralPath 'source/morning log.txt' -Destination 'result/current/morning.txt'
Copy-Item -LiteralPath 'source/evening.txt' -Destination 'result/current/evening.txt'
Move-Item -LiteralPath 'work/draft.txt' -Destination 'result/archive/station.txt'
Remove-Item -LiteralPath 'work/scratch.txt'
Remove-Item -LiteralPath 'work'
Set-Content -LiteralPath 'result/README.txt' -Encoding utf8NoBOM -Value @(
    'Dataset: station observations'
    'Current: morning.txt, evening.txt'
    'Archive: station.txt'
)
