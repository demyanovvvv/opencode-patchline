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