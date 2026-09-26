$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'dist'
$zip = Join-Path $target 'recruitment-resume-copilot-extension.zip'
$extensionRoot = (Resolve-Path (Join-Path $root 'extension')).Path

New-Item -ItemType Directory -Force $target | Out-Null
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$stream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    Get-ChildItem -Path $extensionRoot -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($extensionRoot.Length + 1).Replace('\', '/')
        $entry = $archive.CreateEntry($relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $fileStream = [System.IO.File]::OpenRead($_.FullName)
        try {
            $fileStream.CopyTo($entryStream)
        } finally {
            $fileStream.Dispose()
            $entryStream.Dispose()
        }
    }
} finally {
    $archive.Dispose()
    $stream.Dispose()
}

Write-Output "已生成标准 Zip：$zip"
