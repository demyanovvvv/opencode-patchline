# Changelog

## Unreleased

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
- Upgrade Vitest to 5.0.1 and add Node.js 22 CI coverage for Windows, Linux and
  macOS.
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
- Pin the Windows CI runner to Windows Server 2022 because OpenCode `1.18.30`
  hangs during project bootstrap on the hosted Windows Server 2025 image.

## Unreleased

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

## 1.0.0 - 2026-09-13

- First stable release of the Patchline OpenCode plugin.
- Snapshot-aware `read` and stale-safe `edit` for existing files.
- Existing-file `write` protection and guarded multi-file transactions.
- Literal text search, AST search, LSP bridge, diagnostics, and validation hooks.
- Precision, compatibility, and disabled runtime modes.
- Windows, Node.js 20+, OpenCode 1.18.x, package, doctor, benchmark, and plugin
  smoke verification.

- Run the OpenCode LSP bridge without shell interpretation, including native
  `opencode.exe` resolution on Windows, so query text cannot execute commands.
- Record successful edit identity from the atomically renamed temporary file,
  preventing same-byte replacements from inheriting a trusted next snapshot.
- Read newly created bytes from offset zero on the exclusive file handle so
  create-batch rollback removes unchanged partial files correctly.

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
