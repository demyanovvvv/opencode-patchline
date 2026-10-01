$ErrorActionPreference = 'Stop'
if ((Test-Path -LiteralPath (Join-Path $PSScriptRoot 'src/cli.ts') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json') -PathType Leaf)) {
    $package = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
    if ($package.name -eq 'opencode-patchline') {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            [Console]::Error.WriteLine('Node.js >=20 is required. Install Node.js and retry.')
            exit 1
        }
        $cli = Join-Path $PSScriptRoot 'dist/cli.js'
        if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
            [Console]::Error.WriteLine("Build the source checkout first: run npm install and npm run build in '$PSScriptRoot', then retry.")
            exit 1
        }
        & node $cli install --local @args
        exit $LASTEXITCODE
    }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npx -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine('Node.js >=20 and npx are required. Install Node.js and retry.')
    exit 1
}
$npx = if ($env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }
& $npx --yes opencode-patchline@latest install @args
exit $LASTEXITCODE
