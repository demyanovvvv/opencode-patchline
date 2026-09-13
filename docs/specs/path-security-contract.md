# Path Security Contract

Status: Accepted

Every path is resolved from the tool context directory and canonicalized. The
real existing path, or nearest existing parent for a new file, must remain
inside the canonical worktree. `.git` internals, traversal, and symlink escape
are rejected, including aliases that resolve to a canonical `.git` path.
Relative path equality is never used as snapshot identity.
