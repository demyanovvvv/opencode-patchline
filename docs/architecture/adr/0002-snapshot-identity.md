# ADR 0002: Snapshot Identity

## Decision

Snapshots are scoped by OpenCode session, canonical worktree, canonical path,
and raw-content digest. Hashline's content tag is retained as the model-facing
anchor, while Patchline's raw digest protects byte-level preservation.

## Consequences

Identical relative paths in different worktrees cannot authorize each other.
Hash collisions in short model tags do not bypass the raw digest check.
