# Changelog

## 1.3.0 - 2026-10-12

### Independent OpenCode and Patchline upgrades

- Preserve the installed OpenCode upstream version when installing or updating Patchline.
- Add a host-only upgrade path used by coordinated OpenCode upgrades; plugin registration and dependencies are not reinstalled.
- Keep the installed Patchline version while rebuilding the integrated host for a new OpenCode version.
- Adapt version comparisons and host source preflight for OpenCode 1.19.0.
- Add regression coverage for independent version lifecycles and platform host targets.
- Normalize CLI and TUI version comparisons; target the exact running installation and reject stale host/package pairs.
- Serialize host updates, preserve script launchers and recognize official npm layouts.
- Retain locked Windows backups after a verified binary swap without stopping running sessions.
- Keep source caches separate per upstream, plugin version and package path; migrate exactly owned legacy adapters.
- Reject unsupported OpenCode 2 migration without replacing the integrated host.

## 1.2.1 - 2026-10-08

### Editing and preservation

- Kept native OpenCode `apply_patch` available in precision mode; moved Hashline
  editing to `patchline_apply_patch` and invalidate snapshots around native patches.
- Accepted empty unused adaptive fields without rejecting exact deletions.
- Added adaptive and Hashline conversation slots and bounded Hashline diffs.
- Honored explicit file read ranges up to 2,000 lines with bounded continuation.
- Authorized absolute external read/edit paths through OpenCode permissions while
  preserving traversal, workspace symlink escape, identity and stale guards.
- Added compensating installer rollback for plugin registration, owned local/global
  dependencies, LSP configuration, and runtime state after partial failures.
- Added versioned installer state metadata and repository ignores for machine-local
  ownership state.
- Strengthened direct shell-write detection for common redirection, interpreter,
  PowerShell, and file-copy forms while documenting permission enforcement as the
  authoritative boundary.
- Preserved dominant line endings for inserted content in mixed-ending documents
  and added regression coverage for suffix-boundary edits.

### Documentation and distribution

- Updated English and Russian user guides with top navigation, release-archive
  installation, usage instructions and the current precision-mode tool contract.
- Moved update history out of the README introduction into this changelog and
  bilingual release notes.
- Prepared GitHub-only distribution with an installable package archive and
  SHA-256 checksum; npm publication is not required by the release workflow.
- Updated the documented OpenCode baseline to 1.18.35. Patchline remains 1.2.1;
  the integrated version for this pair is `1.18.35+patchline.1.2.1`.

## 1.2.0 - 2026-10-01

- Added themed conversation cards for all eleven Patchline tools, status-colored
  borders, animated progress, English footer disclosure, progressive text output
  and independently expandable native diff hunks.
- Added Windows x64 conversation-host provisioning through the existing `opencode`
  command. Integrated versions derive from upstream and package versions, such as
  `1.18.34+patchline.1.2.0`; upstream selection supports `--opencode-version`.
- Routed integrated host upgrades through the installer, protected startup update
  handling and canonicalized NVM executable paths without weakening file guards.
- Made byte-identical host installation a no-op and rotated one previous host
  backup. Historical backups remain retained pending ownership-aware migration.
- Added source-checkout install wrappers, registration deduplication, package
  cleanup and installer/UI regression coverage. Full artifact delivery and
  cross-component update recovery remain follow-up work.

- Added server/TUI entrypoints in one package, native diff metadata and a themed,
  reactive sidebar with animated progress, validation failures and rollback details.
- Compiled TUI JSX using Solid's universal transform; added a mounted Bun/OpenTUI
  smoke covering reactive state changes, diff display and cleanup.
- Verified one-package installation through OpenCode with isolated server/TUI
  configuration; refreshed compatible brace-expansion versions to remove its
  high-severity development dependency advisory.
- Bounded display diffs to complete hunks and an aggregate character budget,
  preserving exact statistics (including blank added lines).
- Tracked landed writes before snapshot bookkeeping and retained applied changes
  when subsequent validation fails; separated preflight, commit and rollback stages.
- Tracked exclusive file creation before I/O completes, including partial writes,
  verification and close failures; preserved unverified or externally changed files
  as rollback conflicts with accurate write counts.
- Applied whole-patch upstream Hashline semantics under Bun: cross-file and scoped
  persistent registers, structural blocks, same-path merges and guarded REM/MV.
  Added an upstream differential corpus and file-operation rollback regressions.
- Added direct `@oh-my-pi/pi-natives` dependency and runtime capability reporting;
  OpenCode/Bun uses the full upstream adapter while Node fallback fails closed on
  live drift. Added opt-in upstream-proven Hashline recovery for ordinary edits,
  active OpenCode SDK workspace-symbol routing, and expanded Hashline smoke coverage.
- Isolated hosted plugin smoke home/config/data/cache and cleared inherited OpenCode
  overrides. Empty CLI symbol results now report unverified indexing as a capability
  error with native LSP/AST/grep recovery guidance.
- Hardened atomic replacement cleanup after landed rename, propagated mutation
  cancellation through guarded rollback, serialized Hashline clipboard updates,
  and added component-wise parent directory guards.
- Added bounded snapshot byte quotas with content pooling, lazy aggregate diff
  materialization, skipped-file search reporting, and unified validation metadata
  for write, Hashline, classic patch, and batch mutations.
- Improved TUI mutation summaries with writes, validation status and hidden-file
  counts.

## 1.1.0 - 2026-09-27

- Added `opencode-patchline doctor --lsp` and `opencode-patchline lsp check`
  with human-readable and JSON setup instructions.
- Added TypeScript LSP capability detection, including project-local
  `npx --no-install` detection on Windows and other platforms.
- Added a ready-to-copy OpenCode TypeScript LSP configuration and explicit
  `ast_search`/`patchline_grep` fallback guidance.
- Changed `patchline_lsp` to report `CAPABILITY_UNAVAILABLE` when OpenCode LSP
  is disabled or unconfigured instead of returning a misleading empty result.
- Added bounded LSP startup error details and preserved shell-free Windows
  process invocation, cancellation, and timeout behavior.
- Restricted snapshot-dependent `patchline_edit_batch` to `precision` mode;
  compatibility mode now leaves all editing behavior to OpenCode built-ins.
- Made the OpenCode plugin smoke test explicitly use precision mode and added
  a real OpenCode black-box runner for isolated tool-call verification.
- Expanded the test suite to 107 tests and updated English/Russian guidance.

## 1.0.0 - 2026-09-22

- First stable release of the Patchline OpenCode plugin.
- Snapshot-aware `read` and stale-safe `edit` for existing files.
- Existing-file `write` protection and guarded multi-file transactions.
- Literal text search, AST search, LSP bridge, diagnostics, and validation hooks.
- Precision, compatibility, and disabled runtime modes.
- Windows, Node.js 20+, OpenCode 1.18.x, package, doctor, benchmark, and plugin
  smoke verification.
- Added structured OpenCode tool metadata with bounded recovery actions and
  bytes/validation details, plus CLI JSON diagnostics, configuration validation,
  and stable error explanations.
- Added tag/version/changelog release checks, npm trusted-publishing workflow,
  and a private vulnerability reporting policy.
- Added enforced V8 coverage thresholds, release metadata regression tests, and
  Node.js 20/22 CI coverage across Windows, Linux, and macOS.
- Bound directory reads to 4,096 entries before pagination to prevent unbounded
  directory enumeration memory use.
- Reject directory pages whose rendered output exceeds 20,000 characters.
- Reject file pages whose rendered output exceeds 20,000 characters before
  recording a snapshot.
- Bound literal-search directory enumeration to 4,096 entries per directory.
- Bound formatted grep and AST tool responses to 20,000 characters.
- Reject create batches above 500 files before path resolution or mutation.
- Reject edit batches above 500 edits before preflight and cap successful
  mutation-batch reports at 20,000 characters with a truncation marker.
- Reject `apply_patch` input above 8 MiB before parsing or permission requests.
- Upgrade Vitest to 5.0.1 and add Node.js 20/22 CI coverage for Windows, Linux
  and macOS.
- Install the pinned OpenCode CLI in the cross-platform CI job so the LSP bridge
  smoke test has the same required executable on every runner.
- Bound AST result traversal so searches stop after one match beyond the
  requested result limit instead of materializing every match.
- Make search include matching independent of canonical temporary-directory aliases
  on hosted Windows and macOS runners.
- Keep the OpenCode plugin smoke startup wait bounded while allowing slower hosted
  runners up to 60 seconds to load the plugin registry.
- Resolve the Windows OpenCode smoke executable directly so plugin loading does not
  depend on shell wrappers or command-file dispatch.
- Include the last registry HTTP failure and OpenCode startup logs when plugin smoke
  reaches its bounded timeout.
- Make plugin smoke create a temporary Git worktree so OpenCode exercises the
  same project bootstrap path as a real OpenCode worktree.
- Use direct plugin registration smoke on Windows CI because the hosted Windows
  OpenCode `1.18.30` server hangs during instance bootstrap; HTTP plugin smoke
  remains active on Linux and macOS.
- Bound diagnostic output during execution and enforce the 20,000-character cap on the complete result.
- Terminate timed-out diagnostic process trees and settle even when descendants inherit output pipes.
- Add a reproducible isolated tarball installation and public-export smoke test.
- Propagate OpenCode cancellation to diagnostic commands and terminate their process trees before rejecting.
- Bound and time-limit the shell-free OpenCode LSP bridge, and propagate tool cancellation to its subprocess.
- Reject classic apply_patch sections outside a single complete patch envelope before creating files.
- Skip text-search files over 8 MiB and cap each returned matching-line preview at 2,000 characters.
- Reject AST input over 8 MiB and cap each returned node preview at 2,000 characters.
- Reject ignored content before the first Hashline section before requesting edit permission.
- Bound file reads before loading input: reject files over 8 MiB and selected lines over 20,000 characters before snapshot creation.
- Bound mutation payloads: writes and edit results are limited to 8 MiB, including an 8 MiB aggregate create-batch budget before the first mutation.
- Run the OpenCode LSP bridge without shell interpretation, including native
  `opencode.exe` resolution on Windows, so query text cannot execute commands.
- Record successful edit identity from the atomically renamed temporary file,
  preventing same-byte replacements from inheriting a trusted next snapshot.
- Read newly created bytes from offset zero on the exclusive file handle so
  create-batch rollback removes unchanged partial files correctly.
- Sort literal-search directory entries by name before traversal so match order
  is deterministic and independent of filesystem readdir order.
- Isolate the release metadata test from the CI `GITHUB_REF_NAME` environment so
  mismatched-tag rejection is exercised on hosted runners.

## 0.1.0

- Initial P0 precision editing engine.
- Snapshot-aware OpenCode `read` and `edit` tools.
- Stale edit rejection and existing-file write protection.
- Cross-platform path and text preservation primitives.
- P1 search, diagnostics, validation, doctor, and benchmark foundations.
- Diagnostic and configured validation commands now require OpenCode `bash`
  permission before execution.
- Added regression coverage for denied diagnostic and post-edit validation
  permissions; the suite now contains 60 tests.
- Read service bounds now reject invalid direct `offset` and `limit` values;
  the suite now contains 61 tests.
- Create-batch bookkeeping now captures the exclusive-created file identity
  before path-based rollback checks; the suite now contains 62 tests.
- OpenCode plugin smoke now bounds each tool-registry HTTP probe to avoid an
  unresponsive server hanging verification indefinitely.
