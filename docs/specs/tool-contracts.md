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
code and a corrective action.

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
from 1 through 500.

`apply_patch` accepts snapshot-tagged Hashline sections for existing files. It
also accepts classic `*** Add File` sections after preflighting that every path
is new when `applyPatchFallback` is enabled. Classic update and delete sections
are rejected. `patchline_summary` is registered only when `summary` is enabled.

`patchline_lsp` passes query and file arguments directly to the installed
OpenCode executable without shell interpretation. On Windows it resolves the
native `opencode.exe` from `PATH` and never invokes the `opencode.cmd` wrapper
through a shell.
