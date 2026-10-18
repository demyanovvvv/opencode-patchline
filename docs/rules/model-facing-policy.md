# Model-Facing Policy

```text
PATCHLINE EDITING POLICY
- When the exact path is known, read that file directly using the smallest useful range; skip discovery searches.
- Locate only when the path or target is unknown; use available LSP for symbols, grep for text, and AST for structure.
- Read the smallest useful source range; use read with anchor and limit for a known unique literal target, without offset. Resolve ambiguous candidates before editing.
- Use snapshot-anchored Patchline edits for precise local changes.
- Select by change scope, representation, and supported operations, not file size alone. Use ordinary apply_patch beyond Patchline limits or for unsupported operations.
- Hashline sections belong to patchline_apply_patch, not ordinary apply_patch.
- Re-read files after ordinary patches before further Patchline edits.
- Never rewrite an existing source file for a local modification.
- Preserve unrelated code and formatting exactly.
- If a snapshot is stale, reread before retrying.
- Run relevant diagnostics and proportional validation after edits.
```

The compact policy includes a generic anchor-read example:
`read({"filePath":"src/main.ts","anchor":"function main","limit":40})`.
For a known file and unique literal target this replaces grep followed by read;
omit `offset` and resolve ambiguity before editing. The example is guidance,
not evidence of reduced model calls or tokens.

When OpenCode configuration explicitly sets `lsp: false`, Patchline omits
`patchline_lsp` and `patchline_lsp_status` from its registered tool map. The
configuration hook applies this before tool registry enumeration in OpenCode
1.19.0. In the extended profile, re-enabling LSP on a subsequent configuration
callback restores the definitions; an already cached host registry still
requires OpenCode restart.
Previously captured tool definitions also reject execution while `lsp: false`
is active, before permission prompts, discovery, or SDK/CLI requests.
Absence of `lsp: false` is not proof of a working language server. After its
configuration callback, the compact profile offers LSP only when project
preparation returned a verified document/workspace-symbol capability. Disabled
automatic preparation, missing/unverified servers, unsupported symbol
capabilities, or preparation failure omit the tool. Each configuration callback
clears the previous reports before preparing again. The compact operation enum
contains only verified `documentSymbol`/`workspaceSymbol` operations; it does
not advertise LSP diagnostics because initialization alone does not verify the
host diagnostic bridge. Previously captured definitions enforce the current
operation capabilities before path discovery, permissions, or requests.
This confirms server initialization capability, not end-to-end host bridge
success for every project. Toolchain-change invalidation remains a separate
gate.
Compact LSP definitions are removed while preparation is pending. Results from
an older configuration callback cannot replace reports or restore definitions
after a newer callback has started (including explicit LSP disablement).

Plugin option `toolProfile` accepts `extended` (default, previous tool surface)
or `compact` (opt-in). Compact precision exposes `read`, `edit`, `write`,
`patchline_edit_batch`, `patchline_grep`, `ast_search`, `patchline_diagnostics`
and `patchline_lsp` (eight plugin tools, seven with explicit `lsp: false`).
Host-native tools are additional; these counts do not describe the full request.
The compact profile omits adaptive/Hashline routers, search routing, standalone
LSP status and activity summary. Its policy directs exact edits to `edit` and
related edits to `patchline_edit_batch`, retaining native patch fallback.
All mutation guards and validation are shared with the extended profile.
Compact uses a dedicated policy rather than filtering the extended Hashline
instructions. Its regression budget is below 1800 UTF-8 bytes (the previous
filtered policy was 2168 bytes). It retains direct-path discovery avoidance,
bounded anchor reading, selector exclusion, latest observed snapshots, stale
recovery, unrelated-code preservation and native-patch mismatch recovery.
It also requires relevant diagnostics and proportional validation after edits.
This byte budget measures policy text only; it is not a provider-token budget
or evidence of fewer model turns. Extended policy remains separately defined.
Compatibility mode still uses host-native read/edit/write; it does not gain
precision tools by selecting compact. Switch back to `extended` to restore the
previous definitions. Configuration changes require an OpenCode restart.
Compact is not yet the default: schema-byte measurements, host integration and
live quality/cost comparisons must establish the final profile first.
