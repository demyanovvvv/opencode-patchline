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

The sidebar uses the active OpenCode theme for every Patchline tool. Mutation
operations (`edit`, `write`, `apply_patch`, `patchline_edit_batch`) show writes,
validation, additions, deletions and bounded file previews. Read, search, route,
LSP, diagnostics and summary tools expose the same activity card with a
structured operation-specific summary.

Activity panels follow the host tool style: themed panel background, a left
accent, horizontal padding, one row of internal padding above/below content,
and external top/bottom separation from adjacent conversation content.
Paths appear directly below the operation heading, before secondary metadata.
Completed mutation diffs are collapsed by default, but changed-file headers
and their theme-colored addition/deletion counts always remain visible.
Card and file headings are not disclosure controls. English footer actions
(`Show details ↓` / `Hide details ↑`, `Show file ↓` / `Hide file ↑`) toggle
details and individual files independently. Selecting text must not toggle
previews. A blank row separates each card heading from its summary. The left
border and status indicator use theme warning while running, success after
completion, and error on failure, independently of disclosure state.
Text results initially show twelve lines and reveal twelve more per footer
action; `Show fewer lines ↑` restores the initial preview. Results retain the
20,000-character display-only bound and explicitly mark omitted content.
Diffs initially show one complete hunk; footer controls reveal subsequent
changes and restore the first-hunk preview without cutting unified-diff hunks.
Expanded view uses OpenTUI's native `diff` renderer in unified mode with
monospace code, syntax highlighting when the file type is known, line numbers,
hunk headers, plus/minus signs, and the current theme's added/removed/context
backgrounds and sign colors. Errors show recovery details; diff disclosure
remains under the same footer controls. Session counters use aligned English
labels and values rather than raw camelCase keys.

Its animated indicator runs only during an operation and stops on completion or
unmount. TUI JSX is compiled with Solid's universal transform so theme, tool
state and expanded state remain reactive. `smoke:tui` requires Bun and mounts
the compiled entrypoint in the native OpenTUI test renderer; it checks
transitions, animation, interactive expansion, native diff rendering,
validation failures, rollback details and disposal.

The TUI view is bounded to four files and the existing aggregate diff preview
budget. It reads only existing tool-part metadata; it does not poll the
filesystem or keep a second copy of snapshots. Preview text is display-only.

## Conversation renderer host extension

Stock OpenCode 1.18.34 does not expose tool-card slots. Conversation rendering
requires the modified host checkout `.opencode-host/` (ignored by Git).
Its session `ToolPart` wraps the existing tool switch in a replacement slot
named `tool_<tool ID>`, passing reactive `part`, `message` and `last` props.
Unregistered slots retain the existing renderer. Patchline registers all eleven
tool IDs through the existing scoped slot API.

Build from `.opencode-host/packages/opencode`:

```powershell
bun run script/build.ts --single --skip-install --skip-embed-web-ui
```

Launch `.opencode-host/packages/opencode/dist/opencode-windows-x64/bin/opencode.exe`
instead of stock `opencode`. Existing configuration applies. The system
installation is not overwritten. The build excludes the embedded web UI.

Verify from `.opencode-host/packages/tui` with `bun run typecheck` and
`bun test test/plugin/slots.test.tsx`. From Patchline set
`PATCHLINE_HOST_SMOKE=1` and run `npm run smoke:tui` to load the actual host
registry with a shared Solid runtime and check replacement, reactive progress,
animation and click-to-open output. This is not an end-to-end session test.