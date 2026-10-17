# Benchmark Tasks

Tasks cover a one-line change in a large file, signature plus two callers,
handler validation, a type error, interface-based lookup, React behavior,
three-file edits, structural anti-patterns, external mutation, sequential edits,
monorepo symbol lookup, CRLF, Unicode, and multi-file stale state.

The runnable comparison corpus is `benchmarks/comparison/tasks.ts`: clamped price
calculation, a 2,400-line single edit, signature plus two callers, duplicate-context
selection, coordinated sequential edits, request validation, checkJs type error,
small monorepo lookup, behavior extension, BOM/CRLF/Unicode, mixed endings and
two-module API consistency, and a dirty-worktree task. The price calculation,
large-file and signature tasks form the pilot. The dirty-worktree task stages a
clean baseline, then applies user changes in both the target module and a notes
file before starting either mode. Grading requires those user bytes to survive.

Each task has original files, a golden minimal edit and independent hidden
behavioral checks. Golden diff matching is supplementary: semantically valid
alternative implementations may differ. Preservation checks enforce unchanged
unrelated files and byte fidelity where explicitly requested. The offline suite
also deterministically tests external mutation and stale multi-file preflight;
these are local Patchline safety checks, not model A/B quality measurements.
React and live-model external-mutation scenarios are not implemented in this
initial corpus and must not be inferred from its results.

## Targeted acceptance revision 2 (2026-10-17)

The `targeted` task's editable byte region is the original return statement,
including its indentation and newline. This permits either an inline clamp or
a preceding clamp statement within the function body. The function signature,
braces, leading comment, adjacent `label` function and all other files remain
protected. Behavioral checks still independently verify the clamped result.

Revision 1 permitted only the `percent / 100` expression. That region rejected
a correct preceding clamp statement despite the task prompt allowing it. The
completed `comparison-compact-pilot-2026-10-17` retains its original grading and
corpus fingerprint; it is not regraded with this correction. Future runs use
the changed corpus fingerprint and must not be pooled with revision 1 as if
their acceptance contracts were identical.
