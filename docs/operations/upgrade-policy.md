# Upgrade Policy

Before supporting a new OpenCode minor version, rerun capability probes and
verify plugin load, duplicate tool ordering, before-hook cancellation, tool
schemas, session/worktree context, and LSP gating. Safety behavior is never
silently downgraded.

## Independent versions

For the 1.4.0 GitHub archive, download the archive and SHA256SUMS.txt, verify the
checksum, extract to a new permanent directory and install runtime dependencies.
Run the new adjacent installer in every affected scope:

```bash
sh /path/to/patchline-1.4.0/package/install.sh --project --cwd /work/project --lang en
sh /path/to/patchline-1.4.0/package/install.sh --global --yes --lang en
```

PowerShell uses the same flags with `install.ps1`. Restart OpenCode and run the
new package's doctor. Keep the old package until no scope references it. Upgrading
from a legacy integrated host does not create a verified stock-original backup.

- `install --local` updates Patchline on the installed OpenCode upstream version.
- `opencode upgrade` and the OpenCode 1.19 TUI update service invoke the same
  host-only operation. They pass the running binary path and full expected version.
- `node dist/cli.js host-upgrade --opencode-version 1.19.0` changes only OpenCode.
  It never registers the plugin or changes its dependency or configuration files.
- `--host-binary <path>` selects a specific installation; unknown/ambiguous
  launchers are rejected. `--rebuild` repairs the same version after adapter changes.
- Host updates require matching host/package versions, a per-binary exclusive
  lock, source ownership validation, frozen upstream dependencies, version probes
  before/after installation, and guarded binary rollback.

OpenCode 2 migration is rejected for an integrated host until a compatible
Patchline version is installed. External manager updates (npm, Homebrew, Scoop,
Chocolatey, etc.) cannot be intercepted by an inactive plugin. After such an
update, rerun the existing package's local installer to rebuild on the newly
installed upstream version. Keep the release directory in place: the host's
upgrade entrypoint is anchored to that package, not to npm's `latest` tag.

Windows can retain a running old image after replacement. Locked, integration-owned
retired backups are retained; no unrelated process is terminated. An interrupted
update's `.patchline-update-lock` must be inspected before removal/retry.

Verified original backups survive managed host upgrades. `uninstall
--restore-host` returns the saved original version, even if an integrated host
was upgraded later, and refuses restoration while another recorded owner remains.
