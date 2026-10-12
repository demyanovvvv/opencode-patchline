# Compatibility Matrix

| Component | Version | Status |
|---|---|---|
| OpenCode | 1.18.x–1.19.x | verified baseline; integrated version uses installed upstream plus `+patchline.1.3.0` |
| `@opencode-ai/plugin` | 1.19.0 | verified |
| `@oh-my-pi/hashline` | 18.1.5 | Full upstream runtime verified under OpenCode/Bun; Node keeps guarded linear fallback |
| Node.js | 20.x and 22.x | CI matrix; local development uses 22.22.2 |
| Windows | current development host | tested |
| Windows CI | Windows Server 2022, Node.js 20 and 22 | direct plugin registration smoke passes; OpenCode HTTP bootstrap blocked |
| Linux/macOS | GitHub Actions, Node.js 20 and 22 | full CI matrix |
| Release publishing | GitHub Releases, Node.js 24 runner | package archive, SHA-256 checksum, bilingual notes and release gates |

Host artifact selection covers Windows/Linux/macOS x64/arm64; local rebuild and
update verification is Windows x64. Manager-specific discovery supports native
files, canonical symlinks, official npm script/cached binary layouts and npm cmd
shims. Unknown or ambiguous launchers require `--host-binary`. External package
manager upgrades require reinstalling integration on the new upstream version.
This matrix does not claim automatic interception of external manager commands.
