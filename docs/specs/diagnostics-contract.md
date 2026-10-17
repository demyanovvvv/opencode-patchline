# Diagnostics Contract

Batch, classic-create, adaptive exact and Hashline mutation results include failed post-edit validation
reasons in model-facing text as well as metadata. The reason precedes per-file
summaries so summary truncation does not hide the validation failure.
Failed post-edit command summaries identify the command and either its exit code
or timeout. Empty stdout/stderr is explicitly reported as `(no output)` rather
than producing an empty failure reason.

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
Results expose `timedOut` separately from `ok` and `exitCode`. Timeout output
includes the configured deadline even when captured logs are truncated, within
the same 20,000-character budget. The model-facing diagnostics tool labels a
timeout as incomplete validation, rather than a clean check or a normal exit
failure with an unknown code. Post-mutation validation retains the timeout
reason alongside the applied-write status.
OpenCode tool cancellation is propagated to the command runner and uses the
same process-tree cleanup before rejecting with the abort reason.
