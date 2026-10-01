# Uninstallation

```bash
npx opencode-patchline uninstall --dry-run
npx opencode-patchline uninstall --lang ru
npx opencode-patchline uninstall --global --yes
```

Use the same scope as installation. Normal removal asks for confirmation;
`--dry-run` previews without writes or package-manager commands, and `--yes`
accepts the confirmation for automation.

Patchline registrations are removed from server and TUI JSON/JSONC configuration.
Unchanged installer-owned LSP settings and recorded LSP packages are removed;
other plugins and previously present dependencies are preserved. Unique
`.patchline-backup-<id>` files remain beside changed configurations. Successful
removal deletes installer state. The shared OpenCode package cache is retained.

Restart OpenCode after removal. See [installation](installation.md) for scope,
language, ownership and recovery details.