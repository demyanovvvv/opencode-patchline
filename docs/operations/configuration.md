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

`maxInitialReadLines` sets the default file-read range and the hard directory
entry bound. Explicit file `read.limit` values may request up to 2,000 lines;
output remains bounded and continuation observes only displayed lines.

`precision` (the default) overrides the editing tools and guards direct shell
writes. `compatibility` leaves the built-in `read`, `edit`, `write`, and
`apply_patch` tools and shell behavior untouched while retaining Patchline's
additional discovery and diagnostic tools. The snapshot-dependent
`patchline_edit_batch` tool is available only in `precision` mode. `disabled`
registers no tools.

`applyPatchFallback: false` rejects classic `apply_patch` fallback sections.
Use `patchline_apply_patch` for snapshot-tagged Hashline sections. Native
OpenCode `apply_patch` remains available for large or unsupported operations and
invalidates affected Patchline snapshots.
`maxDiagnostics` bounds diagnostic output to that many lines, in addition to
the hard 20,000-character safety cap. `telemetry: false` does not retain
detailed local events; aggregate counters remain available to the optional
`patchline_summary` tool. Setting `summary: false` omits that tool entirely.

## Project LSP

`lspAutoSetup` and `lspAutoInstall` default to `true`. The former controls project
language/server preparation during plugin startup; the latter permits managed
server installation where a recipe supports it. Set `lspAutoInstall: false` for
discovery without automatic package installation, or `lspAutoSetup: false` to
disable automatic preparation. `lspMaxEntries` bounds discovery (default 30,000);
`lspStorageDirectory` overrides the dedicated managed-server cache.

These runtime options are separate from installer `--no-lsp`, which skips only
installer-side TypeScript provisioning/settings. OpenCode's `lsp: false` and
custom/disabled server entries are honored. Use `lsp check`, explicit `lsp setup`
and `patchline_lsp_status` as described in [doctor](doctor.md).

Installer state is runtime ownership metadata and should not be committed to
source control. Project-local state is ignored by the repository policy. A
failed local install restores the captured package manifest and lockfiles when
npm changed them without an external intervening edit. The shell-write guard
is best-effort detection; OpenCode permission checks remain the authoritative
enforcement boundary.

For mixed line-ending files, unchanged prefix and suffix bytes are preserved.
Newline characters in the changed region use the dominant line ending from
the original document, while BOM and final-newline shape are preserved.
