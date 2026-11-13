@{
    # All course commands target PowerShell 7, whose UTF-8 reader does not need BOM.
    # Preserve the published UTF-8-no-BOM file contract; Windows PowerShell 5 is not a target.
    ExcludeRules = @('PSUseBOMForUnicodeEncodedFile')
}
