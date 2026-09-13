# Patchline Engineering Rules

- Preserve user code before optimizing convenience, speed, or elegance.
- Inspect the installed OpenCode and dependency APIs before changing adapters.
- Existing files require snapshot-aware edits and current-state verification.
- Never weaken stale, path, write, encoding, or worktree guards.
- Prefer one narrow read, one minimal edit, and targeted validation.
- Keep unrelated formatting, imports, comments, names, and files unchanged.
- Use LSP for semantics, grep for text, and AST search for structure.
- Write a failing regression test for every behavior or safety fix.
- Update the relevant file under `docs/specs/`, `docs/rules/`, or ADRs when
  changing a public contract or architectural decision.
- Run typecheck, tests, lint, build, doctor, benchmark smoke, package smoke, and
  dependency audit before release claims.
- Do not reset, stash, discard, or rewrite user worktree changes.
