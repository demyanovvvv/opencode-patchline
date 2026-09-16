# Development Progress

Status: Stable release 1.0.0; continued hardening

Last updated: 2026-09-13

## Objective

Maintain `opencode-patchline` as a production-grade OpenCode plugin for
snapshot-aware, minimal, stale-safe editing. Preserve user code and working
tree state before optimizing convenience or speed.

## Environment

- Node.js `22.22.2`
- OpenCode `1.18.30`
- `@opencode-ai/plugin@1.18.30`
- `@oh-my-pi/hashline@18.1.5`
- Windows development environment
- The project is maintained in a Git repository; release checks include status,
  diff, package contents, and tag/version consistency.

## Completed

### Core safety

- Snapshot-aware file `read` with bounded ranges and stable line anchors.
- Directory-aware `read` with sorted entries, pagination, and no snapshot.
- Explicit file and directory read limits are clamped to the configured bound.
- Correct empty-file result with `totalLines: 0`.
- Exact snapshot-anchored edits.
- Lazy optional Hashline adapter.
- SHA-256 stale-snapshot verification before writes.
- Observed-line protection.
- Workspace jail with traversal, symlink escape, and `.git` protection.
- Canonical `.git` protection also rejects symlink aliases into repository internals.
- UTF-8, BOM, LF, CRLF, and mixed-ending preservation.
- Existing-file `write` protection.
- Generated-file protection for single writes and create batches.
- Guarded create-batch rollback that preserves external replacements and
  reports rollback conflicts.
- Multi-file preflight.
- Guarded best-effort rollback.
- Rollback rechecks the current digest and preserves external changes.
- Edit-batch rollback also rechecks landed file identity, so same-byte
  replacements are preserved instead of being restored over.
- Canonical path recheck immediately before commit to prevent path identity swaps.
- Existing-file commits and rollback restores use atomic entry replacement, so a
  target symlink swapped after the final check is rejected and not followed.
- Atomic replacement rechecks parent directory identity before temporary-file
  creation and before rename to reject parent swaps.
- Read snapshots retain file identity and reject same-byte replacement files;
  successful edit snapshots record the new identity after atomic replacement.
- Successful edits obtain the landed identity from the temporary file before
  rename, so a same-byte replacement between commit and snapshot registration
  cannot inherit a trusted next snapshot or rollback identity.
- New-file creation rechecks canonical identity after parent creation before
  the exclusive `wx` open, including single writes and create batches.
- Create-batch rollback requires the created file identity and digest to match;
  same-byte replacement files are preserved as conflicts.
- Create tracking records bytes and identity from the exclusive `wx` file
  handle, so a replacement between creation and batch bookkeeping cannot be
  mistaken for the Patchline-created file during rollback.
- Create tracking reads written bytes positionally from offset zero, allowing
  unchanged partial creations to be removed instead of reported as external
  rollback conflicts.
- Batch duplicate detection uses canonical platform-aware path identity before
  any commit, including case-only aliases on Windows.
- Text and AST search services validate result bounds independently of plugin
  schemas, preventing invalid direct API calls from bypassing search limits.
- Read service validates supplied `offset` and `limit` values independently of
  plugin schemas, preventing invalid direct calls from being silently clamped.
- Directory reads reject out-of-range offsets consistently, including empty
  directories; offset 1 remains the valid initial empty result.
- Explicit and configured diagnostic commands request OpenCode `bash`
  permission before execution; denied requests prevent process startup.
- Scoped snapshot invalidation that does not remove another session/worktree's data.

### Search and validation

- Bounded literal text search with regex metacharacters treated literally and
  targeted-file support.
- Literal search include globs correctly treat `**/` as zero or more directories.
- Literal search skips invalid UTF-8 and NUL-containing binary files without
  replacement-character false matches.
- AST structural search.
- AST search rejects invalid UTF-8 instead of parsing replacement characters.
- OpenCode CLI LSP bridge.
- OpenCode CLI LSP bridge arguments are passed without shell interpretation;
  Windows resolves the native `opencode.exe` instead of invoking a command
  wrapper through `cmd.exe`.
- Configured validation command routing.
- Bounded diagnostics output.
- Doctor capability checks and safety self-tests.
- Reproducible large-file benchmark.

### OpenCode integration

- Public `@opencode-ai/plugin` contract verified against OpenCode `1.18.30`.
- Precision overrides for `read`, `edit`, `write`, and `apply_patch`.
- Additional `patchline_grep`, `patchline_lsp`, `ast_search`,
  `patchline_edit_batch`, and `patchline_diagnostics` tools.
- Structured plugin errors retain `code`, `path`, `snapshotId`, `retryable`,
  `writes`, and `details`.
- Direct shell writes are guarded in precision mode.
- `compatibility` mode leaves built-in editing tools and shell behavior alone.
- `disabled` mode registers no tools.

### Runtime configuration

- `maxInitialReadLines` controls the default file read range.
- `maxSearchResults` controls default search bounds.
- `maxDiagnostics` bounds diagnostics by lines, with a 20,000-character hard cap.
- `applyPatchFallback` controls classic new-file `apply_patch` fallback.
- `telemetry: false` avoids retaining detailed local metric events.
- Aggregate counters remain available for the optional summary tool.
- `summary: false` omits `patchline_summary` from the tool registry.
- Configuration behavior is documented in `docs/operations/configuration.md`.

### Packaging

- Public package name is `opencode-patchline`.
- Stable package version is `1.0.0`.
- Complete English and Russian user guides are included in the package.
- Public exports include `PatchlinePlugin`, read result types, services, errors,
  snapshot store, search bridge, and configuration helpers.
- Package dry-run and isolated tarball installation passed.
- Coverage gate runs through `npm run test:coverage` with enforced minimums for
  statements, branches, functions, and lines.
- Release metadata validation is covered by tests for matching and mismatched
  version tags.
- The tag-triggered release workflow publishes through npm Trusted Publishing
  and creates the matching GitHub Release after publication.

## Regression coverage

The test suite currently covers:

- directory and empty-file reads;
- exact and stale-safe edits;
- path, symlink, `.git`, and preservation guards;
- rollback conflicts and canonical path swaps;
- atomic replacement rejection against a post-check target symlink swap;
- atomic replacement rejection after a parent-directory identity swap;
- same-byte replacement-file rejection and chained edit identity tracking;
- same-byte replacement rejection between edit commit and next-snapshot
  registration;
- parent-directory symlink swaps during single and batch file creation;
- same-byte replacement protection during create-batch rollback;
- same-byte replacement protection during edit-batch rollback;
- guarded create-batch rollback conflicts;
- successful removal of unchanged partial files during create-batch rollback;
- snapshot scope and lifecycle behavior;
- existing and generated-file write protection;
- plugin tool contracts and structured errors;
- compatibility, fallback, telemetry, summary, and diagnostics configuration;
- text, AST, and LSP search behavior.
- Windows LSP query shell-injection rejection.
- invalid UTF-8 and binary-file grep behavior.
- invalid UTF-8 rejection during AST search.

## Verification status

The latest full local gate passed locally on Windows. CI also covers Node.js 20
and 22 on Windows, Linux, and macOS:

```text
npm run typecheck
npm test -- --run
npm run test:coverage
npm run lint
npm run build
npm run bench
npm run doctor
npm run smoke:plugin
npm run smoke:package
npm audit --audit-level=high
npm pack --dry-run
```

Latest test result:

```text
12 test files passed
100 tests passed
```

Latest benchmark result:

```text
functionalSuccess: true
Diff: +1 / -1
wholeFileRewrites: 0
staleOverwrites: 0
```

The Vitest dependency chain was upgraded to Vitest 5.0.1. `npm audit` now
reports no vulnerabilities.

## Known limitations

- `@oh-my-pi/hashline@18.1.5` uses a Bun-native runtime loader. Under Node,
  exact anchored edits remain active and doctor reports Hashline as optional.
- Native OpenCode LSP model-facing tooling is disabled unless the relevant
  experimental environment flag is enabled; Patchline uses the CLI bridge.
- Linux and macOS validation is delegated to the GitHub Actions CI matrix;
  this Windows session cannot independently execute those hosted runners. The
  workflow installs OpenCode `1.18.30` before running the LSP bridge tests.
- Compatibility mode intentionally does not replace built-in editing tools; it
  only exposes Patchline's additional discovery and diagnostic tools.
- Plugin smoke probes use bounded HTTP requests, so an unresponsive OpenCode
  endpoint fails within the overall startup deadline instead of hanging the
  release gate.
- On Windows, plugin smoke resolves `opencode.exe` directly and passes arguments
  without shell dispatch, matching the LSP bridge process boundary.
- Plugin smoke creates a temporary Git worktree before starting OpenCode, which
  avoids the global-project bootstrap path and matches production usage.
- Windows CI uses the direct plugin registration smoke while Linux and macOS run
  the OpenCode HTTP registry smoke; hosted Windows OpenCode server bootstrap is
  currently blocked independently of Patchline.
- Diagnostic output is bounded during collection as well as in the final
  result. Timeout handling terminates the process tree and closes inherited
  pipes so descendants cannot hold validation open indefinitely.
- OpenCode cancellation reaches diagnostic commands and the LSP CLI bridge.
  The bridge also has a 30-second deadline and bounded stdout/stderr capture.
- Literal search skips files above an 8 MiB per-file input budget before
  decoding and caps each returned matching-line preview at 2,000 characters.
- Literal search bounds each directory enumeration to 4,096 entries before
  continuing through its children.
- Plugin-formatted grep and AST responses reject output above 20,000 characters.
- Classic new-file patches require one closed envelope with no trailing
  sections, so malformed input fails before any file creation begins.
- `apply_patch` rejects patch input above 8 MiB before parsing or permission
  requests.
- AST search rejects source above an 8 MiB parser budget and caps node previews
  at 2,000 characters. AST traversal stops after one match beyond the requested
  result limit instead of materializing all matches. Hashline input rejects
  content before its first section before requesting edit permission.
- Read rejects files above 8 MiB before loading them and rejects selected lines
  above 20,000 characters before recording snapshots; rendered file pages are
  bounded to the same 20,000-character output limit.
- Directory reads reject directories above 4,096 entries before pagination to
  bound enumeration memory and reject rendered pages above 20,000 characters.
- Writes and edit results reject output above 8 MiB before mutation; create
  batches preflight the same 8 MiB aggregate budget and reject more than 500
  files before path resolution or mutation.
- Edit batches reject more than 500 edits before preflight. Successful mutation
  batch reports are capped at 20,000 characters without converting success into
  a post-mutation error.
- `npm run smoke:package` builds, packs, installs the tarball into an isolated
  temporary consumer, and verifies the public exports without lifecycle scripts.
- Git status and diff inspection are included in the local release gate.

## Next plan

1. Keep this file updated after each safety or contract change.
2. Add targeted tests before changing any stale, path, write, encoding, or
   worktree guard.
3. Investigate atomic write and remaining TOCTOU behavior without weakening
   existing guards.
4. Improve search semantics where needed, especially literal-vs-regex behavior
   and file-targeted grep.
5. Expand AST language coverage only when a concrete supported use case exists.
6. Keep the Linux/macOS/Windows CI matrix green before making cross-platform
   release claims.
7. Monitor `@ast-grep/napi` traversal APIs for future parser-level performance
   improvements; Patchline currently performs bounded traversal at its service
   boundary.
8. Keep structured tool metadata and CLI diagnostics backward-compatible as the
   public recovery contract evolves.

## Release gate

Before a release claim, run typecheck, tests, lint, build, benchmark, doctor,
package smoke installation, OpenCode plugin load, package content inspection,
and dependency audit. Do not use destructive Git or dependency upgrade commands
without explicit approval.
