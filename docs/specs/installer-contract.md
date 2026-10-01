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

On Windows x64, installation also provisions the conversation UI host based on
OpenCode 1.18.34. It installs Bun when missing, prepares the pinned OpenCode
checkout (Git is required when no local checkout exists), adds tool replacement
slots, installs build dependencies and builds the CLI without embedded web UI.
Replacement requires confirmation unless `--yes` is supplied. The previous
executable is retained beside the target with a unique backup name. Installation
verifies `opencode --version` reports `1.18.34-patchline-ui.1`; repeat installation
skips rebuilding this host. Unsupported platforms fail instead of claiming full
UI installation. Removing Patchline does not restore or delete the shared host.

After registration, all recognized historical Patchline package/local paths are
collapsed to one selected package entry per config, preserving tuple options.
Similarly named third-party packages are retained. A stock OpenCode upgrade can
replace the host; rerunning the installer restores UI support.

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