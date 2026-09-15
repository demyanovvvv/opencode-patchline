# Diagnostics Contract

Status: Accepted

Diagnostics are proportional to risk and bounded. Patchline distinguishes tool
execution success from validation success. Native OpenCode diagnostics are
preferred; configured commands provide a deterministic fallback. A diagnostics
failure does not conceal a successful write and is reported separately.

Configured commands run only after OpenCode grants `bash` permission. Captured
stdout and stderr are bounded while the process runs, and the final combined
output, including its truncation marker, never exceeds 20,000 characters.
Timeout expiry marks validation unsuccessful, terminates the command process
tree, closes inherited output pipes, and settles without waiting indefinitely
for descendants.
OpenCode tool cancellation is propagated to the command runner and uses the
same process-tree cleanup before rejecting with the abort reason.
