[CmdletBinding()]
param(
    [ValidateSet('Check', 'Format', 'CheckFormat')][string] $Mode = 'Check',
    [Parameter(ValueFromRemainingArguments)][string[]] $Path
)
$ErrorActionPreference = 'Stop'
Import-Module PSScriptAnalyzer -ErrorAction Stop
$settings = Join-Path $PSScriptRoot '../PSScriptAnalyzerSettings.psd1'
$failed = $false
foreach ($file in $Path) {
    if ($Mode -eq 'Check') {
        $tokens = $null
        $parseErrors = $null
        $null = [System.Management.Automation.Language.Parser]::ParseFile(
            (Resolve-Path -LiteralPath $file).Path, [ref] $tokens, [ref] $parseErrors)
        if ($parseErrors.Count -gt 0) {
            $parseErrors | Out-String | Write-Output
            $failed = $true
        }
        # Do not filter Severity: parser errors and every analyzer warning must fail.
        $messages = @(Invoke-ScriptAnalyzer -Path $file -Settings $settings)
        if ($messages.Count -gt 0) {
            $messages | Out-String | Write-Output
            $failed = $true
        }
    }
    else {
        $resolved = (Resolve-Path -LiteralPath $file).Path
        $text = [IO.File]::ReadAllText($resolved)
        $formatted = Invoke-Formatter -ScriptDefinition $text
        if ($Mode -eq 'Format') {
            [IO.File]::WriteAllText($resolved, $formatted, [Text.UTF8Encoding]::new($false))
        }
        elseif ($formatted -cne $text) {
            Write-Output "Needs formatting: $file"
            $failed = $true
        }
    }
}
if ($failed) { exit 1 }
