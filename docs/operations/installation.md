# Installation

Patchline 1.2.1 is distributed as a GitHub release archive, not an npm registry
publication. See the complete [English](../../README.md#installation) and
[Russian](../../README.ru.md#установка) installation instructions. Configuration
is loaded at startup; fully restart OpenCode after updates.

Run `opencode-patchline doctor` after installation. The initial release targets
OpenCode 1.18.x.

## Installer

```bash
node dist/cli.js install --local --lang en --opencode-version 1.18.35
node dist/cli.js install --local --global --lang ru --opencode-version 1.18.35
```

Requires Node.js >=20 and OpenCode >=1.18.0 <2. Package registration delegates to
`opencode plugin`, which installs package dependencies and registers the server
and TUI exports. Project configuration is discovered at the Git root (or current
directory outside Git), including `.opencode/`. Global configuration follows
OpenCode's XDG directory, overridden by `OPENCODE_CONFIG_DIR`.

Run the local command from the newly extracted package to update an existing
registration. Keep the package directory in place while it is registered.
For a source checkout, run from the project to configure:

```bash
npm install
npm run build
node dist/cli.js install --local --lang ru
node dist/cli.js uninstall --dry-run --lang ru
```

PowerShell wrappers in a source checkout remain available when their adjacent
build is present.

Add `--global` for global scope or `--yes` to accept installer prompts. The
standalone wrappers require an npm-published CLI. For this GitHub-only release,
use the built `node dist/cli.js` commands directly.
When `install.ps1` is run from a Patchline source checkout, it uses the adjacent
built CLI and registers that checkout with `--local` instead. Run `npm install`
and `npm run build` in the checkout before using it; no published Patchline
package is required for this path. The target scope still follows the caller's
working directory (or `--global`).
The existing automatic conversation UI host provisioning supports Windows x64;
the shell wrappers do not extend that host's platform support.

The installer checks the supported add-ons independently. If
`typescript-language-server` is missing, it asks before running `npm install
--save-dev` (project) or `npm install --global` for missing `typescript` and
`typescript-language-server` packages. If `bun` is missing, it separately asks
before installing the global `bun` package for the full native Hashline runtime.
Existing direct package dependencies are not claimed or removed. Without an
interactive terminal, each dependency installation is skipped unless `--yes` is
supplied. User-disabled or custom TypeScript LSP configuration is preserved.

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
node dist/cli.js uninstall --dry-run
node dist/cli.js uninstall --lang ru
node dist/cli.js uninstall --global --yes
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
