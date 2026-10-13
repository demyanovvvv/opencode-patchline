$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine('Node.js >=20 is required. Install Node.js and retry.')
    exit 1
}
& node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine('Node.js >=20 is required.')
    exit 1
}
$manifest = Join-Path $PSScriptRoot 'package.json'
$cli = Join-Path $PSScriptRoot 'dist/cli.js'
$valid = $false
if ((Test-Path -LiteralPath $manifest -PathType Leaf) -and (Test-Path -LiteralPath $cli -PathType Leaf)) {
    try { $valid = (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name -eq 'opencode-patchline' } catch { $valid = $false }
}
if (-not $valid) {
    [Console]::Error.WriteLine('Use this script inside an extracted Patchline release package, or build the checkout with npm install and npm run build first.')
    exit 1
}
& node $cli uninstall @args
exit $LASTEXITCODE
