# Uninstallation

```bash
npx --yes opencode-patchline@latest uninstall --dry-run
npx --yes opencode-patchline@latest uninstall --lang ru
npx --yes opencode-patchline@latest uninstall --global --yes
```

Use the same scope as installation. Normal removal asks for confirmation;
`--dry-run` previews without writes or package-manager commands, and `--yes`
accepts the confirmation for automation.

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