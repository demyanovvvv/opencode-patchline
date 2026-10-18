# Tool Contracts

Status: Accepted

`patchline_lsp_status` reports per-project preparation and verified connection
state. Its conversation renderer is registered alongside every other server
tool; prepared/configured/installed is not a verified LSP connection.

In precision mode, hosts exposing `jsonSchema` in `tool.definition` receive an
additional provider-facing `not: { required: ["anchor", "offset"] }` constraint.
Runtime selector rejection remains authoritative; older hosts without that
schema hook retain runtime validation. This does not guarantee model compliance.

`read` accepts `filePath`, `offset`, `anchor`, and `limit`. Optional `anchor` is
validated after a required nonempty string `filePath`; invalid paths are rejected
with `INVALID_ARGUMENT` before permission callbacks or path handling. The anchor is
nonempty literal text matched against the LF-normalized file, not a regex. It
must occur exactly once (including overlapping occurrences); the returned page
starts at the line containing that occurrence. Missing/ambiguous anchors,
directory anchors, and combining `anchor` with `offset` are `INVALID_ARGUMENT`.
Selector validation errors explicitly instruct callers to retry with `filePath`
and one selector, omitting the other property entirely; `limit` may be retained.
Rejected selector combinations create no snapshot and authorize no edit.
Both tool profiles publish separate offset/anchor call examples and explicitly
require omitting unused selector properties, rather than supplying defaults or
empty placeholders. This guidance does not relax argument validation.
Missing/ambiguous match errors include up to eight candidate line numbers and
`details.truncated`; repeated occurrences on one line remain distinct matches.
Only nine occurrences are inspected to determine truncation. Candidate hints
do not create a snapshot or mark any source lines as observed.
Existing size/output limits and observed-range snapshot guards apply equally
to anchored reads. Supplied `offset` and `limit`
values must be positive integers; invalid direct service calls are rejected
instead of silently clamped. `maxInitialReadLines` controls the default file page
and directory page cap. Explicit file limits may request up to 2,000 lines.
File reads return a snapshot tag and numbered source lines. Directory reads
return sorted entries without a snapshot; empty directories accept offset 1.
Empty files report zero source lines. File pages are bounded to 20,000 characters
and include only complete source lines. Responses expose `requestedLimit`,
`truncated`, and `nextOffset`; only rendered lines become observed anchors.
`edit` accepts `filePath`, `snapshot`, and either
exact strings or a Hashline patch in the extended profile. In compact precision,
only exact-string arguments are exposed; supplying `hashlinePatch` directly is
`INVALID_ARGUMENT` before permissions or filesystem activity. Extended exact
and Hashline semantics are unchanged.

The exact-string form uses `oldString`/`newString`. `write` accepts `filePath` and
`content`, creating only new files. `patchline_execute` accepts a list of
snapshot-anchored operations and selects exact, Hashline, recoverable batch, or
standard-tool fallback execution when `strategy` is `auto`. Precision mutations
require a snapshot returned by `read`; explicit `strategy: "standard"` routes
without a snapshot or a precision payload. Large replacements return metadata
with `strategy: "standard"`, `nextTool: "apply_patch"`, and zero writes.
The ordinary OpenCode `apply_patch` is not overridden or blocked by precision
mode. Use it for large files, large changes, or unsupported precision operations.
`patchline_apply_patch` handles snapshot-tagged Hashline sections and optional
classic new-file fallback. Native patch attempts conservatively invalidate
Patchline snapshots before and after execution, including partial failures.
The adaptive tool never bypasses the existing edit/write safety services.
Additional tools are `patchline_grep`,
`patchline_lsp`, `ast_search`, `patchline_edit_batch`, and
`patchline_diagnostics`.

Outputs are bounded and include no unchanged full file. Fallback outputs are
compact and do not include full old/new content. Errors contain a stable code
and a corrective action. Successful tool results expose bounded structured
metadata where the OpenCode adapter supports it: `status` (`observed` or
`applied`), `recoveryAction`, and operation-specific fields such as `snapshot`,
`bytesWritten` (actual UTF-8 bytes committed), `bytesRendered`, `added`, `deleted`, `created`, and `validation`. The existing
human-readable output remains available, but consumers should use metadata for
recovery decisions. Mutation tools expose the same validation states:
`not_configured`, `passed`, or `failed`; validation failure does not change an
already-applied mutation into a zero-write result. Mutation cancellation is
propagated from OpenCode and partial cancellation reports rollback details.

Compact `edit` and `patchline_edit_batch` append an already-computed display
diff to their human-readable summaries when it is complete and at most 2,000
characters per file. Oversized or incomplete previews are omitted with an
explicit notice rather than clipped inside a hunk. The aggregate response
retains the 20,000-character output budget; validation failures precede summaries
and previews. Previews are omitted altogether on failed validation or when their
combined summaries and previews exceed 19,000 characters, reserving room for
diagnostic status and preventing aggregate truncation inside a hunk.
Display context does not grant observed-line edit rights and does
not replace stale, identity, preservation or validation checks. Extended output
is unchanged. This preview is a usability change, not evidence of fewer model
reads or provider tokens.

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
bounded to 4,096 entries before literal search continues. Directory entries are
sorted by name before traversal so match order is deterministic and independent
of filesystem readdir order. Formatted grep and AST responses remain bounded at 20,000 characters and are
truncated with an actionable narrowing hint. Grep results report skipped-file
counts and bounded reasons for unreadable, unsupported-encoding, binary, or
oversized files.

`patchline_apply_patch` accepts snapshot-tagged Hashline sections for existing files. It
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
