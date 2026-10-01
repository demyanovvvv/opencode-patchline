$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or (-not (Get-Command npx -ErrorAction SilentlyContinue))) {
    [Console]::Error.WriteLine('Node.js >=20 and npx are required. Install Node.js and retry.')
    exit 1
}
$npx = if ($env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }
& $npx --yes opencode-patchline@latest uninstall @args
exit $LASTEXITCODE