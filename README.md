# Patchline

Precision code editing for OpenCode.

Patchline is a production-ready OpenCode plugin for minimal, snapshot-aware and
stale-safe changes to existing source files. It keeps the familiar OpenCode
workflow while enforcing correctness in deterministic tooling instead of relying
only on model instructions.

**Package version: `1.2.1`** — see `CHANGELOG.md` for release details.
### Working-version migration

OpenCode's ordinary `apply_patch` remains available for large files, large changes,
and operations beyond Patchline's capabilities. Hashline calls now use
`patchline_apply_patch`; migrate previous Hashline `apply_patch` calls accordingly.
Explicit file reads may request up to 2,000 lines; bounded pages expose the next
offset and observe only displayed lines. Absolute external read/edit targets
require OpenCode `external_directory` and operation-specific permissions.
Fully restart OpenCode after updating the plugin.

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
- Themed conversation cards, including `patchline_execute` and `patchline_apply_patch`, with progress, disclosures and bounded diffs.
- `precision`, `compatibility` and `disabled` runtime modes.
- A doctor command, benchmark, package smoke test and OpenCode plugin smoke test.

## Requirements

- Node.js 20 or newer.
- OpenCode >=1.18.0 and <2; the conversation UI host is currently provisioned on Windows x64.
- A project opened as an OpenCode worktree.

Local host verification uses OpenCode `1.18.34` and
`@opencode-ai/plugin@1.18.30`. OpenCode loads plugins through Bun, so the full upstream Hashline runtime is
available there when the native adapter loads. Direct Node use remains supported
with the bounded PUT/CUT fallback. The optional `hashlineRecovery` setting
allows only upstream-proven anchor recovery for ordinary edits; `REM` and `MV`
remain strict stale-safe operations. The installer registers both server and TUI
entrypoints; full conversation styling requires the compatible host it provisions.

## Installation

For manual tool registration (without provisioning the conversation UI host), install the package:

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

The installer registers server and TUI entrypoints and provisions a compatible
OpenCode conversation UI host on Windows x64. It builds the host using Git/Bun,
retains the `opencode` command, and requests confirmation unless `--yes` is used.
Missing TypeScript LSP dependencies are handled independently:

```bash
npx --yes opencode-patchline@latest install
npx --yes opencode-patchline@latest install --global --lang ru
```

Repeat installation to update the registration and integrated host version.
Wrappers are available: `sh install.sh`, `sh uninstall.sh`, `./install.ps1` and
`./uninstall.ps1`. Outside a checkout they fetch the latest published CLI; inside
a built Patchline checkout, install wrappers use that local package automatically.

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

### Conversation UI and integrated versions

Full styling currently requires a modified OpenCode host: stock OpenCode 1.18.34
does not expose tool-card renderer slots. The installer prepares this integration
automatically and replaces the executable with a guarded backup. Restart OpenCode
after installation. With upstream 1.18.34 and this package, `opencode --version`
reports `1.18.34+patchline.1.2.1`.

The installer resolves the latest stable upstream version, or accepts
`--opencode-version 1.18.34`. Plugin/upstream versions form the integrated version
independently. Exact matching pairs skip rebuilding; new executable replacements
rotate one `.patchline-previous` backup. Integrated host upgrades delegate to the
installer. Global `autoupdate` is currently set to `notify` to prevent stock
replacement; existing `false` is preserved.

Cards use the active theme's warning/success/error border colors, English labels,
animated progress, and bottom `Show details` / `Hide details` controls. Text
results reveal twelve lines at a time; files expand independently and native
diffs reveal complete hunks with line numbers and added/removed colors.

Current limitations: host provisioning requires Windows x64, Git and Bun; binary
artifact delivery, cross-component transaction recovery and ownership-aware
legacy-backup/source-cache cleanup are not yet implemented. Uninstall removes
plugin registrations but does not restore the official executable or update
preference. Review [the installer contract](docs/specs/installer-contract.md).

For a local checkout, build and install the current directory:

```bash
npm install
npm run build
node dist/cli.js install --local --global --yes
```

Local install wrappers also select the adjacent built package automatically.
To verify the mounted UI locally, run `npm run smoke:tui` with Bun available.

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
