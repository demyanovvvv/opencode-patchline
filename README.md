# Patchline

Precision code editing for OpenCode.

Patchline is a production-ready OpenCode plugin for minimal, snapshot-aware and
stale-safe changes to existing source files. It keeps the familiar OpenCode
workflow while enforcing correctness in deterministic tooling instead of relying
only on model instructions.

**Package version: `1.1.0`** (see `CHANGELOG.md` for unreleased changes)

## What it provides

- Snapshot-aware `read` with bounded output and stable line anchors.
- Exact and current-format Hashline `edit` operations linked to the snapshot that was read.
- Stale-state rejection before every write. A stale edit writes zero bytes.
- Existing-file `write` protection. Use `edit` for existing source files.
- Workspace, traversal, symlink, `.git`, encoding, BOM and line-ending guards.
- Multi-file preflight and guarded best-effort rollback with cancellation-safe recovery.
- Collision-safe snapshot tags, bounded snapshot memory, and bounded Node PUT/CUT fallback.
- Literal text search, AST structural search and an OpenCode LSP bridge.
- Permission-aware diagnostics and configured post-edit validation.
- OpenCode-native unified diff metadata for edits and patch batches, with bounded computation and previews.
- One-package TUI entrypoint with themed Patchline progress, writes/validation counts, hidden-file indicators and failure cards.
- `precision`, `compatibility` and `disabled` runtime modes.
- A doctor command, benchmark, package smoke test and OpenCode plugin smoke test.

## Requirements

- Node.js 20 or newer.
- OpenCode 1.18.x.
- A project opened as an OpenCode worktree.

Local verification uses OpenCode `1.18.33` and
`@opencode-ai/plugin@1.18.30`. OpenCode loads plugins through Bun, so the full upstream Hashline runtime is
available there when the native adapter loads. Direct Node use remains supported
with the bounded PUT/CUT fallback. The optional `hashlineRecovery` setting
allows only upstream-proven anchor recovery for ordinary edits; `REM` and `MV`
remain strict stale-safe operations. The TUI entrypoint must be installed in the
OpenCode TUI configuration separately.

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

The installer registers the server and TUI entrypoints through OpenCode and
asks independently before installing missing TypeScript LSP dependencies and
the optional Bun runtime add-on for full native Hashline support:

```bash
npx --yes opencode-patchline@latest install
npx --yes opencode-patchline@latest install --global --lang ru
```

Repeat installation to replace an existing registration with the latest version.
Wrappers are also available: `sh install.sh`, `sh uninstall.sh`, `./install.ps1`
and `./uninstall.ps1`. They forward all CLI arguments, fetch the latest published
CLI, and use the caller's current project (or `--global`).

`--lang en|ru` (alias `--language`) selects installer/uninstaller messages and
is remembered for that scope. Other Patchline commands keep their existing
language. `--yes` accepts prompts for automation. Project dependencies use
`--save-dev`; global installations use npm's `--global` scope. Bun is installed
globally as a runtime add-on. Existing TypeScript dependencies and user LSP
settings are preserved.

Uninstall with a preview or an interactive confirmation:

```bash
npx --yes opencode-patchline@latest uninstall --dry-run
npx --yes opencode-patchline@latest uninstall
npx --yes opencode-patchline@latest uninstall --global --yes
```

Removal affects Patchline registrations and installer-owned LSP/runtime additions.
Direct Patchline dependencies in the selected project/config root and project
`.opencode/` are uninstalled. Shared OpenCode caches and source checkouts remain.
Other plugins are retained; configuration backups are kept next to the original
files. See [installation and removal](docs/operations/installation.md).

For the new TUI panel, use this installer with a package containing both
`./server` and `./tui` exports. OpenCode discovers both and updates its server
and TUI plugin configurations. Adding only the server entry to `opencode.json`
loads the tools and native diff cards; the sidebar also needs the TUI entry.
Restart OpenCode after installing either entrypoint. The sidebar must be visible.
The TUI changes in this worktree are unreleased; an older npm package will not
contain them.

For a local checkout, build first and use OpenCode's package-directory installer:

```bash
npm install
npm run build
opencode plugin /absolute/path/to/opencode-patchline
```

The compact sidebar shows up to four files and twelve diff rows per file,
including explicit preview truncation and validation/rollback outcomes. Native
`edit` / `apply_patch` cards remain available in the conversation.
To verify the mounted UI locally, install Bun and run `npm run smoke:tui`.

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
    "hashlineRecovery": false,
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
loaded lazily because its upstream runtime is Bun-oriented. Bun supports whole
patches, cross-file clipboard registers, structural blocks, same-path merging,
and guarded `REM`/`MV`; Node retains exact edits and linear `PUT`/`CUT` fallback.
Named registers are session/worktree-scoped and publish only after a successful
commit. Native OpenCode LSP is used when its experimental capability is enabled;
otherwise Patchline uses the CLI bridge. Disabled LSP and empty symbol results
return explicit capability errors: an isolated CLI process cannot confirm index
initialization. Use native LSP for semantic symbols or AST/grep for discovery.

For an interactive setup guide, use `opencode-patchline doctor --lsp` or
`opencode-patchline lsp check --json`. The guide shows the TypeScript language
server installation command, a ready-to-copy OpenCode configuration, and the
`ast_search`/`patchline_grep` fallbacks. It never edits configuration or installs
dependencies automatically.

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
npm run smoke:hashline
npm run smoke:hashline:differential
npm run smoke:tui
npm run smoke:package
npm run smoke:install
npm run smoke:installer-lifecycle
npm run smoke:installer-lsp
npm pack --dry-run
```

The release gate covers the full Vitest suite plus Bun Hashline differential,
mounted TUI, package-install and isolated OpenCode installer smoke checks. The
benchmark reports `functionalSuccess: true`, `+1 / -1`, zero whole-file rewrites
and zero stale overwrites.

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
