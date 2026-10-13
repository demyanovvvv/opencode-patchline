# Installation

Patchline 1.3.0 is distributed as a GitHub release archive, not an npm registry
publication. See the complete [English](../../README.md#installation) and
[Russian](../../README.ru.md#установка) installation instructions. Configuration
is loaded at startup; fully restart OpenCode after updates.

Run `opencode-patchline doctor` after installation. The initial release targets
OpenCode 1.18.x–1.19.x.

## Installer

```bash
node dist/cli.js install --local --lang en
node dist/cli.js install --local --global --lang ru
node dist/cli.js host-upgrade --opencode-version 1.19.0
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

Both POSIX and PowerShell wrappers use their adjacent built package from a release
or checkout, without npm CLI fetching. Missing builds give setup instructions.
They preserve caller cwd, literal arguments and exit codes. Install defaults to
the adjacent source; an explicit `--package` replaces it. For example:

```bash
sh /opt/patchline/package/install.sh --project --cwd /work/project --lang en
sh /opt/patchline/package/install.sh --global --yes
sh /opt/patchline/package/install.sh --project --cwd /work/project --dry-run
```

```powershell
& "C:\tools\patchline\package\install.ps1" --project --cwd "C:\work\project" --lang ru
& "C:\tools\patchline\package\install.ps1" --global --yes
```

Add `--global` for global scope, `--project` for explicit project scope,
`--cwd <path>` to select a project, or `--yes` to accept installer prompts.
`--dry-run` previews without changes, locks, commands, downloads or builds.
`--no-host` skips the shared UI host; `--no-lsp` skips LSP provisioning/settings.
Bun provisioning is independent. `--host-binary <path>` explicitly selects the
executable when preparing the host. Use `install --help` for the full flag list.
Values accept separate or equals-style arguments; duplicate/conflicting options
are rejected. `--local` selects the package source, not project scope.
Native host targets cover Windows/Linux/macOS x64/arm64; manager/platform smoke
coverage is documented in the installer contract.

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

`--keep-deps` retains dependencies and runtime add-ons. Regular removal leaves
the integrated host and releases its recorded owner after successful cleanup.
`--restore-host` restores the verified original executable/version only when no
other recorded owners remain, and reverts only an unchanged owned autoupdate
preference. Legacy rotating backups are not eligible. Delayed restore can use
`--host-binary <path>`. See [uninstallation](uninstallation.md) for recovery.

Restart OpenCode after either operation.
