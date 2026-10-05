# Model-Facing Policy

```text
PATCHLINE EDITING POLICY
- Locate relevant code before broad reads.
- Use LSP for symbols, grep for text, and AST search for structure.
- Read the smallest useful source range.
- Use snapshot-anchored Patchline edits for precise local changes.
- Use ordinary apply_patch for large files, large changes, or unsupported Patchline operations.
- Hashline sections belong to patchline_apply_patch, not ordinary apply_patch.
- Re-read files after ordinary patches before further Patchline edits.
- Never rewrite an existing source file for a local modification.
- Preserve unrelated code and formatting exactly.
- If a snapshot is stale, reread before retrying.
- Run relevant diagnostics and proportional validation after edits.
```
