# Model-Facing Policy

```text
PATCHLINE EDITING POLICY
- Locate relevant code before broad reads.
- Use LSP for symbols, grep for text, and AST search for structure.
- Read the smallest useful source range.
- Existing files must be changed with snapshot-anchored edit.
- Never rewrite an existing source file for a local modification.
- Preserve unrelated code and formatting exactly.
- If a snapshot is stale, reread before retrying.
- Run relevant diagnostics and proportional validation after edits.
```
