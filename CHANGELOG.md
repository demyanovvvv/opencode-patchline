# Changelog

## Unreleased

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
