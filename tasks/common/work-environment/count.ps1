param([string]$SourcePath, [string]$ReportPath)

$ErrorActionPreference = 'Stop'
if ($PSBoundParameters.Count -ne 2 -or $args.Count -ne 0) {
    Write-Error 'Нужны два пути: входной файл и новый отчёт.' -ErrorAction Continue
    exit 2
}
try {
    if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
        Write-Error "Входной файл не найден: $SourcePath" -ErrorAction Continue
        exit 2
    }
    if (Test-Path -LiteralPath $ReportPath) {
        Write-Error "Отчёт уже существует: $ReportPath" -ErrorAction Continue
        exit 2
    }
    $parent = Split-Path -Path $ReportPath -Parent
    if (-not $parent) { $parent = '.' }
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        Write-Error "Родительский каталог отчёта отсутствует: $parent" -ErrorAction Continue
        exit 2
    }
    $lines = @(Get-Content -LiteralPath $SourcePath -Encoding utf8).Count
    $result = "lines=$lines"
    Set-Content -LiteralPath $ReportPath -Value "$result`n" -Encoding utf8NoBOM -NoNewline
    Write-Output $result
    exit 0
} catch {
    Write-Error $_.Exception.Message -ErrorAction Continue
    exit 2
}
