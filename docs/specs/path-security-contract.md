# Path Security Contract

Status: Accepted

Paths are resolved from the tool context worktree and canonicalized. Service
calls remain worktree-bound unless supplied an explicit authorization callback.
The OpenCode adapter permits explicit absolute external paths only after
`external_directory` and operation-specific read/edit authorization against
the canonical target. Relative traversal and workspace symlink escapes remain
rejected, as do lexical and canonical `.git` internals.
External snapshots remain scoped to the originating session and worktree;
the worktree is never expanded to a drive or common ancestor. Commit and
rollback repeat path authorization and existing identity/digest checks.

Authorization callbacks also receive canonical internal targets. Operation
permission patterns are worktree-relative internally; path aliases cannot change
the authorized resource. LSP file requests follow the same canonical checks.

Parent creation traverses relative components from the caller's workspace root;
it never computes a traversal between canonical and lexical path spellings.
Caller root aliases are supported, while each nested target is still checked
against the canonical workspace and protected Git paths.
