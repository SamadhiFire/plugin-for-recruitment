$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'dist'
$zip = Join-Path $target 'recruitment-resume-copilot-extension.zip'
$extensionRoot = Join-Path $root 'extension'
New-Item -ItemType Directory -Force $target | Out-Null
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path "$extensionRoot\*" -DestinationPath $zip -Force
Write-Output "已生成：$zip"
