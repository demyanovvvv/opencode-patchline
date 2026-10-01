# Snapshot Contract

Status: Accepted

A snapshot records the canonical path, normalized content, raw SHA-256 digest,
Hashline tag, observed line set, text shape, session ID, workspace/worktree
identity, and creation time. A snapshot must not be used by another session or
worktree. Expired and least-recently-used entries are removed without changing
files. The store also applies a bounded byte quota with content pooling for
byte-identical documents; scope-specific observed lines remain independent.
