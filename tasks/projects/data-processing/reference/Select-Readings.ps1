[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $InputPath,
    [Parameter(Mandatory)][string] $SelectedPath,
    [Parameter(Mandatory)][string] $ExcludedPath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
    throw "Нет входного файла: $InputPath"
}
$readings = Import-Csv -LiteralPath $InputPath -Encoding utf8
$readings |
    Where-Object { $_.State -ceq 'keep' } |
    Sort-Object -Property @{ Expression = { [int]$_.Units } }, Code -Culture en-US |
    Select-Object -Property Code, Units |
    Export-Csv -LiteralPath $SelectedPath -Encoding utf8NoBOM
$readings |
    Where-Object { $_.State -ceq 'skip' } |
    Sort-Object -Property Code -Culture en-US |
    Select-Object -Property Code, Units |
    Export-Csv -LiteralPath $ExcludedPath -Encoding utf8NoBOM
