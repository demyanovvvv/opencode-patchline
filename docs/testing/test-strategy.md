# Test Strategy

P0 uses unit and filesystem integration tests for snapshots, stale mutation,
exact and anchored edits, write guards, path safety, encoding, line endings,
large files, and multi-file preflight. P1 adds search, diagnostics, plugin hook,
and real runtime smoke tests. Every regression receives a failing test first.
