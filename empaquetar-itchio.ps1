# Empaqueta el bundle autocontenido (build/bundle/index.html) en un zip
# listo para subir a itch.io.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundle = Join-Path $root "build\bundle\index.html"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zip = Join-Path $root "build\quidditch-master-itchio-$stamp.zip"

if (-not (Test-Path -LiteralPath $bundle)) {
    Write-Host "No existe $bundle. Ejecuta primero: node crear-bundle.mjs"
    exit 1
}

$tmp = Join-Path $env:TEMP ("qmbundle-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item -LiteralPath $bundle -Destination (Join-Path $tmp "index.html")

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $tmp "index.html") -DestinationPath $zip
Remove-Item -LiteralPath $tmp -Recurse -Force

Write-Host "Zip listo para itch.io: $zip"