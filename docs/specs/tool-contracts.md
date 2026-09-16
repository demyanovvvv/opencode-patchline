# Tool Contracts

Status: Accepted

`read` accepts `filePath`, `offset`, and `limit`. Supplied `offset` and `limit`
values must be positive integers; invalid direct service calls are rejected
instead of silently clamped. `limit` is capped by the configured
`maxInitialReadLines` bound. For files it returns a snapshot
tag and numbered source lines. For directories it returns sorted entries and no
snapshot; an empty directory accepts only its initial offset of 1. Empty files
report zero source lines. `edit` accepts `filePath`, `snapshot`, and either
`oldString`/`newString` or a Hashline patch. `write` accepts `filePath` and
`content`, creating only new files. Additional tools are `patchline_grep`,
`patchline_lsp`, `ast_search`, `patchline_edit_batch`, and
`patchline_diagnostics`.

Outputs are bounded and include no unchanged full file. Errors contain a stable
code and a corrective action. Successful tool results expose bounded structured
metadata where the OpenCode adapter supports it: `status` (`observed` or
`applied`), `recoveryAction`, and operation-specific fields such as `snapshot`,
`bytesWritten` (actual UTF-8 bytes committed), `bytesRendered`, `added`, `deleted`, `created`, and `validation`. The existing
human-readable output remains available, but consumers should use metadata for
recovery decisions.

File reads reject files larger than 8 MiB before loading them and reject a
requested range containing a line longer than 20,000 characters before creating
a snapshot. This prevents line-oriented snapshots and tool output from becoming
unbounded while preserving complete text for accepted files. They also reject a
rendered file page above 20,000 characters before recording a snapshot.

Directory reads reject directories with more than 4,096 entries before producing
a paginated result, and reject a page whose rendered output exceeds 20,000
characters. Pagination does not imply unbounded directory enumeration or output.

`write` and exact/Hashline edits reject an output larger than 8 MiB before any
filesystem mutation. A create batch has the same 8 MiB aggregate budget and
preflights that budget before its first file is created. Create batches also
reject more than 500 files before path resolution or filesystem mutation.
Edit batches reject more than 500 edits before snapshot or path preflight.
Successful create and edit batch reports are capped at 20,000 characters with an
explicit truncation marker; output truncation does not change mutation success.

`patchline_diagnostics` requests the OpenCode `bash` permission for the exact
command before execution. Configured post-edit validation commands request the
same permission after a successful edit and before they run. A denied request
prevents the command from starting.

`patchline_grep` treats `pattern` as case-sensitive literal text. Regular
expression semantics are intentionally not part of this tool contract; use AST
search for structural patterns and LSP for symbol relationships. Its optional
`path` may identify either a workspace-relative file or directory; a file path
limits the search to that file. Only valid UTF-8 text files are searched;
invalid UTF-8 and NUL-containing binary files are skipped rather than decoded
with replacement characters or returned as false matches. `include` globs use
`*` for one path segment and `**/` for zero or more directory segments.
Search result limits are validated at the service boundary and must be integers
from 1 through 500. Files larger than 8 MiB are skipped before their content is
loaded, including files that grow past the limit while being read. Each returned
matching-line preview is capped at 2,000 characters. Each enumerated directory is
bounded to 4,096 entries before literal search continues. Formatted grep and AST
responses are rejected above 20,000 characters.

`apply_patch` accepts snapshot-tagged Hashline sections for existing files. It
rejects non-whitespace content before the first Hashline section before asking
for edit permission. It
also accepts classic `*** Add File` sections after preflighting that every path
is new when `applyPatchFallback` is enabled. Classic update and delete sections
are rejected. The classic format requires exactly one `*** Begin Patch` / `***
End Patch` envelope and rejects non-whitespace trailing content before any file
is created. Patch input is limited to 8 MiB before parsing or permission requests.
`patchline_summary` is registered only when `summary` is enabled.

`patchline_lsp` passes query and file arguments directly to the installed
OpenCode executable without shell interpretation. On Windows it resolves the
native `opencode.exe` from `PATH` and never invokes the `opencode.cmd` wrapper
through a shell.
