# Security Rules

- Keep edits inside the canonical worktree.
- Reject `.git`, traversal, malformed paths, and symlink escape.
- Preserve OpenCode permissions.
- Use raw content digests, never timestamps alone, for stale checks.
- Reject invalid UTF-8 rather than corrupting bytes.
- Do not send source or metrics remotely by default.
