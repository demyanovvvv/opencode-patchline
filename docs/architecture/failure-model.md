# Failure Model

Status: Accepted

Errors use stable codes and actionable messages. Safety errors are closed:
unknown encodings, workspace escapes, missing snapshots, scope mismatches, and
stale state prevent writes. Optional capability failures such as AST or LSP
unavailability return an explicit degraded result and do not weaken editing.
Hashline runtime unavailability follows the same rule: only the bounded linear
Node fallback is enabled, while unsupported structural or clipboard operations
fail closed.

Multi-file commit failures report landed paths and attempt byte-for-byte
rollback. Because portable filesystems cannot guarantee one atomic operation
across several paths, Patchline promises complete preflight and best-effort
rollback rather than claiming strict transactionality. Installer rollback also
captures local package manifests and lockfiles, restoring them only when their
current contents still reflect the failed installation; external changes are
reported as rollback conflicts. A landed write is tracked
before snapshot bookkeeping, so bookkeeping failures also enter guarded rollback.
The `writes` count records landed file writes, including those subsequently
restored; `details.restored` and `details.conflicts` describe rollback outcomes.
Exclusive creation is tracked as soon as the file is opened, before content,
verification, or close completes. Only confirmed written bytes and the captured
file identity authorize removal; missing identity or changed bytes are reported
as conflicts. Single-file creation uses the same guarded rollback and retains
pre-write safety error codes when no file was created.
Hashline removal/move retains the original file in a guarded temporary backup
until all commits succeed. Rollback restores through an exclusive hard link and
will not overwrite a recreated source or changed destination. Conflicted backups are
retained for recovery. Clipboard register state is published after successful
commit only. Mutation APIs propagate cancellation before preflight and between
commits; cancellation during a partial batch uses the same guarded rollback
and reports `cancelled`, `restored`, and `conflicts` metadata. Atomic replacement
cleanup after a successful rename is best-effort and cannot hide a landed write.
Snapshot and clipboard state is scoped to the session/worktree.

Installer mutations use a compensating transaction across configuration, owned
dependencies, LSP registration, and installer state. A failure restores
previous configuration and state when the files remain unchanged, and reports
rollback conflicts without overwriting external changes. Dependency cleanup is
scoped to the exact local or global installation that was changed.
Presentation callbacks cannot interrupt a commit or rollback. Post-edit validation
failures retain the applied diff, next snapshot and known write count.
