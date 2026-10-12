# Upgrade Policy

Before supporting a new OpenCode minor version, rerun capability probes and
verify plugin load, duplicate tool ordering, before-hook cancellation, tool
schemas, session/worktree context, and LSP gating. Safety behavior is never
silently downgraded.

## Independent versions

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
