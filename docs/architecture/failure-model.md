# Failure Model

Status: Accepted

Errors use stable codes and actionable messages. Safety errors are closed:
unknown encodings, workspace escapes, missing snapshots, scope mismatches, and
stale state prevent writes. Optional capability failures such as AST or LSP
unavailability return an explicit degraded result and do not weaken editing.

Multi-file commit failures report landed paths and attempt byte-for-byte
rollback. Because portable filesystems cannot guarantee one atomic operation
across several paths, Patchline promises complete preflight and best-effort
rollback rather than claiming strict transactionality.
