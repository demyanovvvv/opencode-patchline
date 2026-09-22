# Patchline

Precision code editing for OpenCode.

Patchline is a production-ready OpenCode plugin for minimal, snapshot-aware and
stale-safe changes to existing source files. It keeps the familiar OpenCode
workflow while enforcing correctness in deterministic tooling instead of relying
only on model instructions.

**Current release: `1.0.0`**

## What it provides

- Snapshot-aware `read` with bounded output and stable line anchors.
- Exact and anchored `edit` operations linked to the snapshot that was read.
- Stale-state rejection before every write. A stale edit writes zero bytes.
- Existing-file `write` protection. Use `edit` for existing source files.
- Workspace, traversal, symlink, `.git`, encoding, BOM and line-ending guards.
- Multi-file preflight and guarded best-effort rollback.
- Literal text search, AST structural search and an OpenCode LSP bridge.
- Permission-aware diagnostics and configured post-edit validation.
- `precision`, `compatibility` and `disabled` runtime modes.
- A doctor command, benchmark, package smoke test and OpenCode plugin smoke test.

## Requirements

- Node.js 20 or newer.
- OpenCode 1.18.x.
- A project opened as an OpenCode worktree.

Patchline is verified against OpenCode `1.18.30` and
`@opencode-ai/plugin@1.18.30`. Windows, Linux and macOS are covered by the
GitHub Actions matrix on Node.js 20 and 22; Windows uses direct plugin
registration smoke because the hosted OpenCode HTTP bootstrap is blocked.

## Installation

Install the package:

```bash
npm install opencode-patchline
```

Add it to the OpenCode configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-patchline"]
}
```

Restart OpenCode after changing configuration. Check the local environment with:

```bash
npx opencode-patchline doctor
npx opencode-patchline doctor --json
npx opencode-patchline config show
npx opencode-patchline explain STALE_SNAPSHOT
```

The package also provides a non-destructive installer that delegates config
changes to OpenCode:

```bash
npx opencode-patchline install
npx opencode-patchline install --global
```

## Runtime modes

`precision` is the default. It replaces `read`, `edit`, `write` and
`apply_patch` with guarded tools and registers Patchline search and diagnostics.
Existing files must be edited from a current snapshot. Classic `apply_patch` is
accepted only for creating new files; snapshot-tagged sections remain the
precision editing path.

`compatibility` leaves OpenCode's built-in editing and shell behavior in place
and adds Patchline discovery and diagnostic tools. `disabled` registers no
Patchline tools.

Configure the mode through the OpenCode plugin tuple:

```json
{
  "plugin": [["opencode-patchline", {
    "mode": "precision",
    "maxInitialReadLines": 120,
    "maxSearchResults": 30,
    "maxDiagnostics": 30,
    "applyPatchFallback": true,
    "telemetry": false,
    "summary": true
  }]]
}
```

All options are validated during plugin load. See
[`docs/operations/configuration.md`](docs/operations/configuration.md).

## Safety model

1. `read` records the raw bytes, file identity, session, worktree and a bounded
   view of the file.
2. `edit` verifies the snapshot immediately before preflight using a SHA-256
   digest and identity checks.
3. A mismatch returns `STALE_SNAPSHOT` and does not write.
4. Existing files are committed through guarded atomic replacement while
   preserving encoding and line endings.
5. Batch operations validate all targets before the first commit and preserve
   external changes during rollback.

Diagnostic and configured validation commands request OpenCode `bash`
permission for the exact command. If permission is denied, the command is not
started.

Important error codes include `STALE_SNAPSHOT`, `WRITE_PROTECTED`,
`PATH_OUTSIDE_WORKSPACE`, `SYMLINK_ESCAPE`, `GENERATED_FILE` and
`FALLBACK_REJECTED`.

## Tools

Patchline preserves familiar names and adds focused tools:

- `read`, `edit`, `write`, `apply_patch`
- `patchline_grep` for bounded literal text search
- `patchline_lsp` for symbol-oriented queries through the OpenCode CLI bridge
- `ast_search` for structural syntax patterns
- `patchline_edit_batch` for validated multi-file edits
- `patchline_diagnostics` for permission-aware diagnostics
- `patchline_summary` for optional local aggregate counters

Use LSP for symbols, grep for literal text, AST search for syntax structure, and
the smallest useful `read` range before editing.

## Search and optional capabilities

Search results are bounded. Invalid UTF-8 and NUL-containing binary files are
skipped by literal search. The AST provider is capability-detected. Hashline is
loaded lazily because its upstream runtime is Bun-oriented; on Node.js, exact
snapshot-anchored edits remain available and `doctor` reports Hashline as
optional. Native OpenCode LSP is used only when its experimental capability is
enabled; otherwise Patchline uses the CLI bridge.

## Development and verification

```bash
npm install
npm run typecheck
npm test -- --run
npm run lint
npm run build
npm run bench
npm run doctor
npm run smoke:plugin
npm pack --dry-run
```

The release gate currently covers 12 test files and 100 tests. The latest local
benchmark reports `functionalSuccess: true`, `+1 / -1`, zero whole-file
rewrites and zero stale overwrites.

## Documentation

- [`README.ru.md`](README.ru.md) - Russian guide.
- [`docs/README.md`](docs/README.md) - complete technical documentation index.
- [`docs/operations/installation.md`](docs/operations/installation.md) - setup.
- [`docs/operations/configuration.md`](docs/operations/configuration.md) - all
  runtime options.
- [`docs/operations/troubleshooting.md`](docs/operations/troubleshooting.md) -
  common errors.
- [`docs/specs/`](docs/specs/) - normative runtime contracts.
- [`docs/architecture/`](docs/architecture/) - architecture and decisions.
- [`docs/testing/`](docs/testing/) - testing strategy and scenarios.
- [`CHANGELOG.md`](CHANGELOG.md) - release history.

## Security and privacy

Patchline does not send source code or metrics remotely by default. It preserves
OpenCode permissions, rejects unsafe paths and symlink escapes, and uses raw
content digests rather than timestamps for stale checks. Report security issues
through the repository's private security channel when available.

## License

MIT. See [`LICENSE`](LICENSE).
