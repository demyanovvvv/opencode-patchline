# Observability Contract

Status: Accepted

Local events track mechanism, paths, observed lines, bytes, snapshots, edit
ranges, diff counts, stale conflicts, retries, durations, diagnostics, guarded
writes, and fallbacks. Remote telemetry is off and not implemented by default.
Metrics never include source content.

## Explicit comparison artifacts

The opt-in `benchmark:compare` runner is separate from plugin telemetry. It writes
fixture source diffs, model/tool results, checks and actual provider usage to a
user-selected local directory. It never embeds provider credentials or forwards
events to a telemetry service. It supports only bounded, explicitly requested
live runs and does not treat absent usage or unconfigured model pricing as zero
cost. Its HTML report must render embedded source as inert text. Its input
fixtures are disposable; existing worktree state and runtime guards are preserved.
