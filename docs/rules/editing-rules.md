# Editing Rules

1. Existing source files require snapshot-anchored edit.
2. Verify the live file immediately before writing.
3. Reject stale state with zero writes.
4. Make the smallest semantically correct change.
5. Preserve unrelated code, formatting, imports, comments, BOM, and endings.
6. Never replace current user changes with Git HEAD.
7. Never turn a patch failure into an unrequested whole-file overwrite.
8. Track and justify every fallback.
