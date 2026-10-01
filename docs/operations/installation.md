# Installation

Install `opencode-patchline`, add it to OpenCode's `plugin` array, and restart
OpenCode. Configuration is loaded at startup and is not hot-reloaded.

Run `opencode-patchline doctor` after installation. The initial release targets
OpenCode 1.18.x.

## Installer

```bash
npx opencode-patchline install --lang en
npx opencode-patchline install --global --lang ru
```

Requires Node.js >=20 and OpenCode >=1.18.0 <2. Package registration delegates to
`opencode plugin`, which installs package dependencies and registers the server
and TUI exports. Project configuration is discovered at the Git root (or current
directory outside Git), including `.opencode/`. Global configuration follows
OpenCode's XDG directory, overridden by `OPENCODE_CONFIG_DIR`.

The installer checks for `typescript-language-server`. If missing, it asks before
running `npm install --save-dev` (project) or `npm install --global` for missing
`typescript` and `typescript-language-server` packages. Existing direct package
dependencies are not claimed or removed. Without an interactive terminal,
dependency installation is skipped unless `--yes` is supplied. User-disabled or
custom TypeScript LSP configuration is preserved.

`--lang en|ru` / `--language en|ru` localizes only installer and uninstaller
messages. Language and dependency ownership are stored in
`.opencode-patchline-state.json` in the project root or global configuration
directory. Package-manager and OpenCode subprocess output uses their own language.

### Installing a checkout

```bash
npm install
npm run build
node dist/cli.js install --local --lang ru
```

`--local` registers the package containing the running CLI instead of the npm
registry version. Run it from the project that should receive the plugin, or
include `--global`.

## Uninstaller

```bash
npx opencode-patchline uninstall --dry-run
npx opencode-patchline uninstall --lang ru
npx opencode-patchline uninstall --global --yes
```

`--dry-run` lists changes without writes or package-manager commands. Normal
removal asks for confirmation; `--yes` accepts it. Use the same scope as installation.
The uninstaller removes Patchline strings/tuples from both server and TUI JSON or
JSONC configurations and removes unchanged installer-owned TypeScript LSP settings.
Only the recorded, allowlisted LSP packages are passed to npm uninstall. Other
plugins, user settings and previously present dependencies remain intact.

Configuration edits preserve comments, BOM and line endings. All files are
preflighted before mutation; symlinks, invalid UTF-8/JSONC and stale files are
rejected. Writes are atomic, with unique `.patchline-backup-<id>` copies retained.
A configuration transaction rolls back already-written files on failure unless a
concurrent change prevents safe rollback. Dependency-removal failure retains the
state so a retry can finish cleanup. Successful removal deletes installer state.
OpenCode's shared plugin cache is retained, as it may be used by another scope.

Restart OpenCode after either operation.
