# Configuration

Plugin options are passed through the OpenCode plugin tuple:

```json
{
  "plugin": [["opencode-patchline", {
    "mode": "precision",
    "maxInitialReadLines": 120,
    "maxSearchResults": 30,
    "maxDiagnostics": 30,
    "applyPatchFallback": true,
    "hashlineRecovery": false,
    "telemetry": false,
    "summary": true
  }]]
}
```

Options may set read/search/diagnostic limits, snapshot TTL, generated-file
patterns, explicit full-replacement allowlists, local summary output, and
validation commands. `hashlineRecovery` defaults to `false`; when enabled, only
upstream-proven ordinary Hashline anchor recovery is allowed. `REM` and `MV`
remain strict stale-safe operations. Invalid options fail during plugin load.

`maxInitialReadLines` is a hard per-call bound for both file lines and
directory entries. An explicit `read.limit` above this value is clamped rather
than allowed to bypass the output bound.

`precision` (the default) overrides the editing tools and guards direct shell
writes. `compatibility` leaves the built-in `read`, `edit`, `write`, and
`apply_patch` tools and shell behavior untouched while retaining Patchline's
additional discovery and diagnostic tools. The snapshot-dependent
`patchline_edit_batch` tool is available only in `precision` mode. `disabled`
registers no tools.

`applyPatchFallback: false` rejects classic new-file `apply_patch` sections;
snapshot-tagged Hashline sections remain the precision editing path.
`maxDiagnostics` bounds diagnostic output to that many lines, in addition to
the hard 20,000-character safety cap. `telemetry: false` does not retain
detailed local events; aggregate counters remain available to the optional
`patchline_summary` tool. Setting `summary: false` omits that tool entirely.
