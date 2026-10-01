# Patchline Visualization Contract

Status: Accepted

Patchline ships both the server (`./server`) and OpenCode TUI (`./tui`) entrypoints
in one npm package. The OpenCode package installer discovers both entrypoints.
After installation or configuration changes, restart OpenCode.
`smoke:install` verifies discovery of both entrypoints through the installed
OpenCode CLI, using an isolated home and XDG/config directories.

The `edit` tool returns a bounded unified `metadata.diff` for OpenCode's native
edit renderer. `apply_patch` returns `metadata.files` in OpenCode's native patch
shape (`type`, `filePath`, `relativePath`, `patch`, `deletions`). Batch edits
return one diff per changed file, with a 20,000-character aggregate preview
budget. Only complete hunks are included; `diffTruncated: true` explicitly marks
omitted content (including an empty preview). Diff computation has a 100 ms /
2,000-edit-distance budget. Exact additions/deletions include blank lines and
are independent of preview limits. Preview text is display-only and must never
be used as an edit source or as proof that a commit succeeded.

Tools report permission, preflight, committing, rollback, validation and
completion through `ToolContext.metadata`. Presentation callbacks cannot stop a
commit or rollback. Thrown errors remain rejected tool calls with a reason,
recovery action, stage, paths and write count where known. `writes` counts landed
file writes, including subsequently restored files; `restored` and `conflicts`
identify rollback outcomes. Unknown commit outcomes never imply zero writes.
A nonzero validation exit retains `status: applied` with `validation: failed`;
a validation exception retains the applied diff, snapshot and `writes: 1` in
error metadata. Hashline batch metadata includes all source and move paths;
`REM`/`MV` failures expose the same landed-write and rollback conflict fields.
Both are shown as applied changes with failed validation.

The sidebar uses the active OpenCode theme and shows only mutation tools
(`edit`, `write`, `apply_patch`, `patchline_edit_batch`), prioritizing a running operation. It reports writes, validation status, and the number of files hidden by the bounded preview.
Its animated indicator runs only during an operation and stops on completion or
unmount. TUI JSX is compiled with Solid's universal transform so theme and tool
state remain reactive. `smoke:tui` requires Bun and mounts the compiled entrypoint
in the native OpenTUI test renderer; it checks transitions, animation, diff,
validation failures, rollback details and disposal.

The TUI view is bounded to four files and twelve preview rows per file. It
reads only existing tool-part metadata; it does not poll the filesystem or
keep a second copy of snapshots.