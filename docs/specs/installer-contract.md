# Installer and uninstaller contract

Status: Accepted

`install` supports `--global` / `-g`, `--lang en|ru` / `--language en|ru`,
`--yes` / `-y`, and `--local`. `uninstall` supports the scope/language/confirmation
flags and `--dry-run`. Invalid flags must fail before changing configurations.

Installation delegates server/TUI registration and plugin dependency resolution
to the installed OpenCode 1.x plugin command. Missing TypeScript LSP packages
and the Bun runtime add-on require confirmation unless `--yes` is supplied.
The installer checks each add-on independently, installs only missing packages,
and records only packages it installed. Existing packages are not claimed by the
installer. User-disabled and custom LSP settings are preserved.
Installer language preferences affect installer/uninstaller messages only.

Failed local dependency installation captures package manifests and lockfiles
after the npm command returns (including partial failures). Rollback verifies
those captured bytes and file/parent identities before npm cleanup or restoration.
Later external edits are preserved and reported as conflicts. External edits
during the npm subprocess itself cannot be attributed reliably; this remains a
best-effort process boundary rather than an atomic filesystem transaction.
Installer state is checked against the last installer-owned snapshot and restored
byte for byte. Independent rollback stages continue after a conflict and rollback
is attempted only once. A new configuration containing unrelated settings is
edited to remove owned registration rather than deleted.
Failed dependency cleanup retains the current ownership state for recovery and
reports the non-zero cleanup exit code instead of declaring rollback successful.

Repeated installation uses `opencode plugin --force` when the selected scope
already contains Patchline. The bare package name resolves to `@latest` through
OpenCode; explicit local paths/specifiers are preserved. Direct Patchline package
dependencies in the selected root/config directory and project `.opencode/` are
removed through `npm uninstall --prefix <directory> --ignore-scripts`. Manifests
are preflighted and checked again before npm; failure retains installer state for
retry. Dry-run includes package cleanup without invoking npm. Shared OpenCode
package caches and source checkouts are retained because other scopes may use them.

Root `install.sh`, `uninstall.sh`, `install.ps1` and `uninstall.ps1` wrappers invoke
`npx --yes opencode-patchline@latest` with the matching command, forward every
argument and preserve the subprocess exit code and caller's working directory.
They require Node.js and npx; npm's `--yes` only approves fetching the CLI, while
installer confirmations require a separately forwarded `--yes`.

When `install.ps1` is beside a Patchline source checkout (`src/cli.ts` and a
`package.json` named `opencode-patchline`), it instead invokes the adjacent
`dist/cli.js` using Node.js with `install --local`, forwarding all arguments and
preserving the caller's working directory and exit code. A missing build fails
with instructions to run `npm install` and `npm run build`, without registry
lookup. Standalone downloaded wrappers retain the published-package behavior.

On Windows x64, installation provisions a conversation UI host from the latest
stable `opencode-ai` upstream version, or `--opencode-version <1.x.y>`. Patchline
version comes from the installer's package manifest. The executable version is
`<upstream>+patchline.<plugin>` (for example `1.18.34+patchline.1.1.0`). Exact
matching installed pairs skip rebuilding. Upstream and plugin changes therefore
update their respective components independently. Invalid versions fail closed.
It installs Bun when missing, prepares a matching tagged checkout, adds tool
replacement slots and a coordinated update adapter, and builds without embedded
web UI. Unsupported upstream source APIs fail before replacing the executable.
Replacement requires confirmation unless `--yes` is supplied. One fixed
`.patchline-previous` backup is rotated; byte-identical installs do not rotate it.
Command `opencode` is retained. Unsupported platforms fail instead of claiming
full UI installation. Removing Patchline does not yet restore the shared host.
Legacy UUID backups and source caches are retained until ownership-aware cleanup
is implemented; they must not be deleted merely by matching a filename.

After registration, all recognized historical Patchline package/local paths are
collapsed to one selected package entry per config, preserving tuple options.
Similarly named third-party packages are retained. Before provisioning (including
the already-installed fast path), the installer changes global `autoupdate` from
missing/true to `"notify"`, preserving false/notify and unrelated JSONC content,
with guarded writes and backups. This prevents OpenCode's startup updater from
replacing the custom version with stock. Integrated `opencode upgrade` delegates
to the same local installer with the requested upstream version. Startup update
comparison ignores integration build metadata to avoid repeated same-version
notifications. Published artifact delivery, plugin-update coordination outside
the installer, global transaction journaling and managed cleanup remain pending.
The preference is retained on uninstall. Existing global configuration is
required for provisioning. Executable discovery canonicalizes the located path
(including NVM aliases) before regular-file, parent and identity checks.

The scope-specific state records the registered package specifier, language and
allowlisted installer-owned additions. Missing state never authorizes arbitrary
package removal. Uninstallation requires confirmation unless `--yes` is supplied.
Dry-run must not write files, create backups, run npm or delete installer state.

Configuration discovery is bounded to the selected project/Git worktree or global
OpenCode configuration. JSONC edits must retain unrelated values, comments,
encoding markers and line endings. All candidate files are preflighted before
mutation. Unsafe paths, symlinks, malformed configuration, unsupported encoding,
oversized configuration and stale identity/content are rejected. Existing files
are backed up and atomically replaced using the existing guarded write primitive.
Multi-file failures roll back applied configuration writes only while their
post-write contents/identities still match; conflicts retain backups and report
failure. Dependency-removal failures retain state for retry.

Successful removal deletes state, retains other plugins and the shared OpenCode
package cache, and reminds the user to restart OpenCode.
