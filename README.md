# Patchline

Precision code editing for OpenCode.

Patchline is a production-ready OpenCode plugin for minimal, snapshot-aware and
stale-safe changes to existing source files. It keeps the familiar OpenCode
workflow while enforcing correctness in deterministic tooling instead of relying
only on model instructions.

**Patchline `1.4.0` · OpenCode `1.19.0` · Integrated host `1.19.0+patchline.1.4.0`**

[Русский](README.ru.md) · [Installation](#installation) · [Usage](docs/operations/usage.md) · [Tools](#tools) · [Documentation](docs/README.md) · [Changelog](CHANGELOG.md) · [Releases](https://github.com/demyanovvvv/opencode-patchline/releases) · [Issues](https://github.com/demyanovvvv/opencode-patchline/issues)

## Contents

- [What it provides](#what-it-provides) and [requirements](#requirements)
- [Installation, updates and removal](#installation)
- [Working with Patchline](docs/operations/usage.md)
- [Runtime modes](#runtime-modes) and [safety model](#safety-model)
- [Tools](#tools) and [search capabilities](#search-and-optional-capabilities)
- [Development and verification](#development-and-verification)
- [Documentation](#documentation), [security](#security-and-privacy) and [license](#license)

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
- OpenCode >=1.18.0 and <2; host artifact targets include Windows/Linux/macOS x64/arm64.
- A project opened as an OpenCode worktree.

The release targets OpenCode `1.19.0` and
`@opencode-ai/plugin@1.19.0`. OpenCode loads plugins through Bun, so the full upstream Hashline runtime is
available there when the native adapter loads. Direct Node use remains supported
with the bounded PUT/CUT fallback. The optional `hashlineRecovery` setting
allows only upstream-proven anchor recovery for ordinary edits; `REM` and `MV`
remain strict stale-safe operations. The installer registers both server and TUI
entrypoints; full conversation styling requires the compatible host it provisions.

## Installation

### Quick start: GitHub release

Download [`opencode-patchline-1.4.0.tgz`](https://github.com/demyanovvvv/opencode-patchline/releases/download/v1.4.0/opencode-patchline-1.4.0.tgz).
Download [SHA256SUMS.txt](https://github.com/demyanovvvv/opencode-patchline/releases/download/v1.4.0/SHA256SUMS.txt)
to the same directory and verify before extracting:

```bash
sha256sum -c SHA256SUMS.txt
# macOS: shasum -a 256 -c SHA256SUMS.txt
```

```powershell
$expected = ((Get-Content .\SHA256SUMS.txt -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash .\opencode-patchline-1.4.0.tgz -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'Archive SHA-256 mismatch' }
```

Extract to a permanent directory and install its runtime dependencies:

```bash
mkdir patchline-1.4.0
tar -xzf opencode-patchline-1.4.0.tgz -C patchline-1.4.0
cd patchline-1.4.0/package
npm install --omit=dev
node dist/cli.js doctor
```

For manual tool registration without provisioning the conversation UI host,
add absolute file URLs to your OpenCode configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/patchline-1.4.0/package/dist/plugin.js"],
  "tui": { "plugin": ["file:///absolute/path/patchline-1.4.0/package/dist/tui.js"] }
}
```

On Windows use a URL such as `file:///C:/tools/patchline-1.4.0/package/dist/plugin.js`.
Keep the extracted directory in place while registration references it.
Restart OpenCode after changing configuration. From that directory, run:

```bash
node dist/cli.js doctor
node dist/cli.js doctor --json
node dist/cli.js config show
node dist/cli.js explain STALE_SNAPSHOT
```

The installer registers server and TUI entrypoints and provisions a compatible
OpenCode conversation UI host. It preserves the currently installed upstream
version when installing Patchline. Host upgrades rebuild only the integrated
host, preserving the installed Patchline version and plugin configuration.
Missing TypeScript LSP dependencies are handled independently:

```bash
node dist/cli.js install --local --yes --lang en
node dist/cli.js install --local --global --yes --lang en
node dist/cli.js host-upgrade --opencode-version 1.19.0
```

Repeat installation to update Patchline without selecting a newer OpenCode.
Use `host-upgrade` when the upstream OpenCode version should change.
The included scripts work from an extracted release or a built checkout. They
use the adjacent package, forward CLI flags and exit codes, and never fetch a CLI
from npm. Run them from the target project, or select it with `--cwd`:

```bash
sh /opt/patchline-1.4.0/package/install.sh --project --cwd /work/my-project --lang en
sh /opt/patchline-1.4.0/package/install.sh --global --yes --lang en
sh /opt/patchline-1.4.0/package/install.sh --project --cwd /work/my-project --dry-run
```

```powershell
& "C:\tools\patchline-1.4.0\package\install.ps1" --project --cwd "C:\work\my-project" --lang en
& "C:\tools\patchline-1.4.0\package\install.ps1" --global --yes --lang en
& "C:\tools\patchline-1.4.0\package\uninstall.ps1" --project --cwd "C:\work\my-project" --dry-run
```

### Installer flags

| Flag | Commands | Meaning |
| --- | --- | --- |
| `--project` | Both | Project scope, the default; discovers the Git root from the selected directory. |
| `--global`, `-g` | Both | Global configuration for all projects. |
| `--cwd <path>` | Both | Select the project without changing the caller's working directory. |
| `--lang en\|ru`, `--language` | Both | Installer language, remembered for the selected scope. |
| `--yes`, `-y` | Both | Accept prompts for automation. |
| `--dry-run` | Both | Preview paths and actions without writes, downloads, builds or package commands. |
| `--help`, `-h` | Both | Show command-specific help. |
| `--local` | Install | Use the package containing this CLI; selects a source, not project scope. |
| `--package <path>` | Install | Use an explicit built package directory instead of `--local`. |
| `--no-host` | Install | Skip UI host provisioning; full cards require an integrated host. |
| `--no-lsp` | Install | Skip TypeScript LSP installation and configuration. |
| `--opencode-version <1.x.y>` | Install | Explicit stable upstream version override. |
| `--host-binary <path>` | Both | Select the OpenCode executable for provisioning/restoration. |
| `--keep-deps` | Uninstall | Retain package dependencies and runtime add-ons. |
| `--restore-host` | Uninstall | Restore verified original OpenCode if no other recorded installation uses it. |

Values accept `--flag value` or `--flag=value`. Unknown, repeated, missing and
conflicting options fail before changes. `--project --global` is invalid;
`--local --global` remains valid. Scripts default to their adjacent package;
an explicit `--package` replaces that default. Plain CLI `install` retains npm
package registration; use `--local` or the scripts for this GitHub release.

`--lang en|ru` (alias `--language`) selects installer/uninstaller messages and
is remembered for that scope. Other Patchline commands keep their existing
language. `--yes` accepts prompts for automation. Project dependencies use
`--save-dev`; global installations use npm's `--global` scope. Bun is installed
globally as a runtime add-on. Existing TypeScript dependencies and user LSP
settings are preserved.

Uninstall with a preview or an interactive confirmation:

```bash
node dist/cli.js uninstall --dry-run --lang en
node dist/cli.js uninstall --lang en
node dist/cli.js uninstall --global --yes --lang en
node dist/cli.js uninstall --project --cwd /work/my-project --keep-deps --yes
node dist/cli.js uninstall --global --restore-host --dry-run
node dist/cli.js uninstall --global --restore-host --yes
```

Removal affects Patchline registrations and installer-owned LSP/runtime additions.
Direct Patchline dependencies in the selected project/config root and project
`.opencode/` are uninstalled. Shared OpenCode caches and source checkouts remain.
Other plugins are retained; configuration backups are kept next to the original
files. Use `sh uninstall.sh` or `./uninstall.ps1` with the same flags and scope.
Regular removal leaves the shared host integrated. `--restore-host` checks the
original backup and installed binary hashes, refuses other recorded owners, and
restores only an unchanged installer-owned `autoupdate` preference. It restores
the saved original version, even after host upgrades. It can be run after normal
removal, with `--host-binary` if the executable is no longer discoverable.
Legacy installations without a verified original backup fail with recovery
guidance; rotating `.patchline-previous` files are not treated as stock originals.
Keep the extracted package while any registered scope or integrated host uses it.
Fully restart OpenCode after installation, update or removal.
See [installation and removal](docs/operations/installation.md).

### Conversation UI and integrated versions

Full styling currently requires a modified OpenCode host: stock OpenCode 1.19.0
does not expose tool-card renderer slots. The installer prepares this integration
automatically and replaces the executable with a guarded backup. Restart OpenCode
after installation. With upstream 1.19.0 and this package, `opencode --version`
reports `1.19.0+patchline.1.4.0`.

The installer preserves the installed upstream version, or accepts an explicit
`--opencode-version 1.19.0` override. Plugin/upstream versions form the integrated version
independently. Exact matching pairs skip rebuilding; new executable replacements
rotate one `.patchline-previous` backup. Integrated host upgrades delegate to the
host-only command. Global `autoupdate` is currently set to `notify` to prevent stock
replacement; existing `false` is preserved.

Cards use the active theme's warning/success/error border colors, English labels,
animated progress, and bottom `Show details` / `Hide details` controls. Text
results reveal twelve lines at a time; files expand independently and native
diffs reveal complete hunks with line numbers and added/removed colors.

Host provisioning requires Git and Bun. Prebuilt integrated hosts, full
cross-component transaction recovery and automatic legacy/source-cache cleanup
remain outside this release. `--restore-host` restores a recorded stock original
and unchanged owned update preference; legacy/manual installs without recovery
evidence require manual repair. Review [the installer contract](docs/specs/installer-contract.md).

### Updating from 1.3.x

Extract 1.4.0 to a new permanent directory, install its runtime dependencies, and
run its installer with the same project/global scope as before. Use `--cwd` for a
project install from outside that project. The currently installed OpenCode
upstream version is preserved; restart OpenCode and run the new package's doctor.
Do not delete the old package while another scope still references it. A legacy
integrated host does not retroactively gain a verified stock-original backup.

### Project LSP

```bash
node /path/to/package/dist/cli.js lsp check --directory /work/my-project --json
node /path/to/package/dist/cli.js lsp setup --directory /work/my-project
```

Check discovers project languages without installing; setup explicitly prepares
managed servers. Prepared/installed is not a verified connection. Use
`patchline_lsp_status` for per-project status and `patchline_lsp` for queries.
Disabled/custom servers are preserved. Managed LSP storage is separate from
installer-owned TypeScript/Bun dependencies. See [doctor and LSP](docs/operations/doctor.md).

For a local checkout, build and install the current directory:

```bash
npm install
npm run build
node dist/cli.js install --local --global --yes
```

Local install wrappers also select the adjacent built package automatically.
To verify the mounted UI locally, run `npm run smoke:tui` with Bun available.

## Runtime modes

`precision` is the default. It replaces `read`, `edit` and `write` with guarded
tools and adds `patchline_apply_patch`, search and diagnostics. Native OpenCode
`apply_patch` remains available and invalidates affected snapshots. Existing
files edited through Patchline require a current snapshot.

`compatibility` leaves OpenCode's built-in editing and shell behavior in place
and adds Patchline discovery and diagnostic tools. `disabled` registers no
Patchline tools.

Configure the mode through the OpenCode plugin tuple:

```json
{
  "plugin": [["file:///absolute/path/patchline-1.2.1/package/dist/plugin.js", {
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

- `read`, `edit`, `write`, `patchline_apply_patch` (native `apply_patch` remains available)
- `patchline_execute` for adaptive snapshot-safe editing
- `patchline_route_search` for selecting a discovery mechanism
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
