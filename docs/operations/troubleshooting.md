# Troubleshooting

`STALE_SNAPSHOT` requires a fresh narrow read. `WRITE_PROTECTED` requires
anchored edit. `PATH_OUTSIDE_WORKSPACE` indicates traversal or symlink escape.
`CAPABILITY_UNAVAILABLE` means the optional provider is disabled; editing
safety remains active. Restart OpenCode after plugin or config changes.

## Installation and removal

- Missing adjacent package/build: extract the complete release archive and run
  `npm install --omit=dev`, or run `npm install` and `npm run build` in a checkout.
  A standalone wrapper does not download a CLI from npm.
- Wrong project: pass `--project --cwd <path>`; the Git root is selected from that
  directory. `--local` chooses a package source, not the scope. Use `--global` for
  global configuration.
- Host/package mismatch after updating to 1.4.0: rerun the new package's installer
  in the affected scope, restart OpenCode and run its doctor. `host-upgrade`
  expects a matching integrated host/package and does not update Patchline.
- No verified original backup: an old integrated host cannot be assumed stock.
  Remove Patchline registrations, then reinstall OpenCode using its original
  install method. `.patchline-previous` may contain another integrated build.
- Other host owners: remove their registrations with the matching project/global
  scope before requesting `--restore-host`. Missing state files do not prove
  ownership was released; do not delete recovery records to bypass the guard.
- Changed binary/backup/state or interrupted lock: inspect the reported path,
  retain recovery files, and retry after resolving the actual conflict.

Use `--dry-run` to inspect planned actions and `--keep-deps` to preserve package
dependencies. [Removal](uninstallation.md) explains delayed host restoration.
