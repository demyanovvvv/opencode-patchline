# Upgrade Policy

Before supporting a new OpenCode minor version, rerun capability probes and
verify plugin load, duplicate tool ordering, before-hook cancellation, tool
schemas, session/worktree context, and LSP gating. Safety behavior is never
silently downgraded.
