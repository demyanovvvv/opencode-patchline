# Uninstallation

```bash
node dist/cli.js uninstall --dry-run
node dist/cli.js uninstall --lang ru
node dist/cli.js uninstall --global --yes
node dist/cli.js uninstall --project --cwd /work/project --keep-deps --yes
node dist/cli.js uninstall --global --restore-host --dry-run
node dist/cli.js uninstall --global --restore-host --yes
```

Run from the extracted release package and use the same scope as installation.
Normal removal asks for confirmation;
`--dry-run` previews without writes or package-manager commands, and `--yes`
accepts the confirmation for automation.
Use `--cwd <path>` to select the project, `--project` for explicit project scope,
and `--help` to see command-specific flags. Values also accept `--flag=value`.

Patchline registrations are removed from server and TUI JSON/JSONC configuration.
Direct `opencode-patchline` dependencies in the selected project/config root and
project `.opencode/package.json` are uninstalled with npm (lifecycle scripts
disabled). Other dependencies remain. Package cleanup is included in dry-run.
The equivalent wrappers are `sh uninstall.sh` and `./uninstall.ps1`; arguments
are forwarded, and project scope follows the caller's working directory.
Unchanged installer-owned LSP settings, recorded LSP packages and runtime add-ons
are removed. Only installer-owned `bun` is removed globally; existing Bun
installations remain. Other plugins and previously present dependencies are
preserved. Unique
`.patchline-backup-<id>` files remain beside changed configurations. Successful
removal deletes installer state. The shared OpenCode package cache is retained.

Restart OpenCode after removal. See [installation](installation.md) for scope,
language, ownership and recovery details.

## Dependencies and original host

`--keep-deps` retains direct Patchline dependencies, recorded LSP packages and Bun,
while still removing registrations and unchanged owned LSP settings. Regular
removal retains the integrated host and releases its recorded owner only after
package cleanup succeeds. Failed cleanup retains state for retry.

`--restore-host` restores the verified `<binary>.patchline-original`, using the
ownership and SHA-256 record in `<binary>.patchline-recovery.json`. It refuses
restoration if any other recorded project/global owner remains, or if the binary,
backup or ownership record changed. Original backups are immutable across host
upgrades; restoring returns the saved original version, not the latest upstream.
Legacy installations without a verified original are not inferred from rotating
`.patchline-previous` files; use your original OpenCode install method to repair
those manually after removing Patchline registrations.

Only an unchanged installer-owned `autoupdate: "notify"` preference is reverted.
Other user settings, comments and formatting remain. The host, backup, receipt
and affected settings are rechecked under lock after confirmation. Backups and
recovery evidence remain after restoration. Delayed restore after normal removal
is supported; add `--host-binary <path>` if OpenCode is no longer discoverable.
Unrecorded/manual plugin installations cannot be enumerated automatically.
Keep the package directory while the shared integrated host still uses its CLI.
