# Working with Patchline

[Русский](usage.ru.md) · [User guide](../../README.md) · [Installation](installation.md) · [Configuration](configuration.md) · [Tool contracts](../specs/tool-contracts.md)

## Everyday workflow

1. Locate the target using `patchline_lsp` for symbols, `patchline_grep` for literal
   text, or `ast_search` for syntax structure.
2. Read the smallest useful range with `read`. The response includes the file
   path, snapshot ID, Hashline tag and observed line anchors.
3. Edit only observed content using the returned snapshot. Do not invent tags,
   snapshot IDs or anchors.
4. Inspect the result and diff, then run project diagnostics or tests.

Explicit reads support up to 2,000 lines. Bounded responses expose a continuation
offset; only displayed lines are available as edit anchors.

## Exact edits

Call `edit` with values from the latest `read`:

```json
{
  "filePath": "src/example.ts",
  "snapshot": "<snapshot returned by read>",
  "oldString": "<observed text>",
  "newString": "<replacement text>"
}
```

`newString: ""` deletes the observed text. Use `write` only for new files.

## Hashline and batches

Use `patchline_apply_patch` for Hashline sections. Replace the tag and line
number below with values actually displayed by `read`:

```text
[src/example.ts#<tag returned by read>]
PUT 12.=12:
+replacement line
```

`patchline_edit_batch` preflights multiple snapshot-linked edits before writing.
`patchline_execute` selects an exact, Hashline, batch or standard-tool route.
Inspect each result before the next call. See the [Hashline contract](../specs/hashline-contract.md).

## Native patches and recovery

OpenCode's native `apply_patch` remains available for large files, large changes
and operations outside Patchline's capabilities. Read changed files again after
a native patch before using snapshot-based tools.

- `STALE_SNAPSHOT`: read the current file and rebuild the edit from observed text.
- `fallback_required`: use the `nextTool` reported in the response.
- `WRITE_PROTECTED`: use snapshot-linked `edit` for an existing file.
- Permission denial: request the required OpenCode permission. External absolute
  read/edit paths require `external_directory` and operation-specific permission.
- Failed native context match: read the affected range and rebuild the patch.

Never use shell writes to bypass a rejected edit. Preserve user changes and
unrelated formatting. See [troubleshooting](troubleshooting.md).

## Validation

Use `patchline_diagnostics` for a configured diagnostic command, native LSP when
available, and the project's normal typecheck/tests. Commands require OpenCode's
permission for the exact operation. Use `patchline_summary` for local counters.
For environment checks, run `node dist/cli.js doctor` from the extracted package.
