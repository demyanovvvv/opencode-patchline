# LSP Contract

Status: Accepted

An empty SDK workspace-symbol response is returned as `data: []` with a
`capabilityNote`: it does not prove that the project has no symbols. Some hosts
expose a placeholder HTTP endpoint even while native LSP works. Use native LSP,
AST search or literal search to verify. Nonempty SDK responses retain their
existing representation; this note does not claim that every empty result is
a capability failure.

Runtime LSP dispatch checks the JSON configuration content associated with cached
reports as well as its generation. An in-place configuration edit clears reports,
advances the generation and removes compact LSP exposure before dispatch. A fresh
configuration setup or successful explicit status refresh establishes a new
content baseline. Verified command reports also retain executable/launcher identity
fingerprints (canonical paths, file identity, size and nanosecond timestamps),
command arguments, working directory, PATH and NODE_OPTIONS. Project-root and
ancestor-directory package
manifests and dependency lock metadata (npm, pnpm, Yarn, Bun, Cargo, Go, uv and
Poetry) are additional invalidation inputs, checked up to the filesystem root.
This does not cover arbitrary edits inside installed dependencies. Bare executable names are
resolved through PATH rather than treated as workspace files. Dispatch rechecks
these identities before and after asynchronous host operations, revoking compact
exposure when they change. This is not a transitive dependency-content fingerprint:
a dependency edit that leaves launcher and lock metadata unchanged remains a
separate gate.
Initial configuration publication and explicit refresh recheck configuration
content after asynchronous fingerprinting; neither publishes stale capabilities
when the configuration object is edited in place during that wait.
Runtime fingerprint checks recheck cancellation and generation before revocation;
an obsolete in-flight check cannot clear capabilities published by a newer setup.
Explicit status refresh also snapshots configuration content before preparation
and rejects if it changes in place, rather than treating discarded reports as a
successful empty discovery or establishing a baseline from an obsolete refresh.

Preparation health probes terminate their process tree before returning either
verified capabilities or an error. A successful initialize response does not
leave a background language server running; runtime requests use the host's
managed server instead.
Cancellation of preparation propagates to the caller. Existing, newly installed
and rustup-managed server probe failures must not convert an aborted request into
a configured-but-unverified report or continue installing another server.
Preparation rechecks cancellation after asynchronous executable/runtime discovery,
rustup execution and managed installation before starting the next operation.
Configuration publication rechecks cancellation, original `lsp` identity and its
JSON configuration content after preparation. Replacing, editing in place or
disabling that value while preparation is pending
discards the old reports and does not overwrite the newer configuration.
Preparation also compares JSON configuration content after discovery/runtime/
installer boundaries before starting the next operation. A changed configuration
returns no reports and does not start another install or probe; already running
work retains its existing timeout/cancellation behavior.
The initialize request uses the actual project directory URI for both `rootUri`
and `workspaceFolders`, rather than a placeholder workspace. Capabilities from a
probe remain scoped to the project root that was initialized.
Probe JSON-RPC framing counts raw UTF-8 bytes, retaining incomplete frames across
stdout chunks. Unicode notifications before initialize responses cannot shift
the next frame or turn healthy capabilities into a parsing failure.
Health probes limit headers to 8 KiB and total stdout to 1 MiB; unsafe or larger
declared body lengths fail before waiting for the body. Error details retain only
the last 4,000 characters. These limits apply to preparation probes, not normal
host LSP sessions.
Initialize results require a non-null, non-array capabilities object. Missing or
malformed capabilities fail verification; an empty object is valid but grants no
provider operations.

SDK symbols responses are inspected for error envelopes. Requests forward abort
signals and share one 120-second default deadline across status and symbol
requests; output is bounded to 200,000 characters. Symbol results require a direct
array or an SDK envelope with an array-valued `data` field; null, missing data,
objects and stringified arrays are unavailable rather than successful responses.
When the SDK exposes LSP status,
workspace search requires at least one connected client in the requested
directory. Empty/disconnected status is capability-unavailable; status errors or
malformed responses are unavailable, never a successful empty search. A connected
client's genuine empty symbol result remains valid. Older clients without the
status method retain the existing request path. The status SDK signature does
not accept a signal; the wrapper bounds its wait but cannot cancel that underlying
request. Symbol requests receive the combined cancellation signal.
An SDK method's presence and a server initialize capability are not proof that
the host HTTP operation is implemented. In the inspected integrated host
1.19.0+patchline.1.4.0, the `/find/symbol` handler returns an unconditional empty
array. Empty results cannot distinguish this stub from a legitimate no-match
response. Workspace-symbol integration remains unverified for that host; a
successful direct language-server request does not close the host integration gate.
File-specific plugin calls authorize the canonical target before CLI execution.
The CLI bridge itself rejects explicit `lsp: false` before executable discovery,
file resolution, or process creation, including calls outside the plugin hook.
The plugin config hook also returns before project preparation when `lsp: false`,
after clearing capability reports and removing LSP tools. Explicitly disabled
LSP therefore does not traverse the worktree or probe/install servers during
plugin configuration. Re-enabling configuration still follows normal preparation
and capability verification; a stale in-flight preparation cannot republish tools.
An explicit `patchline_lsp_status` call rechecks discovery and server health with
installation disabled, rather than returning startup reports indefinitely. For
the canonical plugin worktree it clears cached capabilities before preparation
and publishes only the latest configuration/refresh generation. Failed or aborted
refreshes leave no verified cached capability. Status for another worktree cannot
replace the plugin worktree's reports. This explicit refresh is not automatic
toolchain fingerprint invalidation; that gate remains open.
If configuration changes or a newer same-root refresh supersedes a pending status
request, the pending request rejects with `CAPABILITY_UNAVAILABLE` instead of
returning an obsolete verified report to the model.
In compact mode, a final `CAPABILITY_UNAVAILABLE` from the runtime bridge revokes
cached capabilities and removes the LSP tool for the canonical plugin worktree.
A captured tool handle then fails its capability guard without another host call.
Only the current generation can be revoked; other worktrees cannot clear it.
Configuration reload or explicit status refresh can verify capabilities again.
Runtime operations capture their configuration generation before path resolution
and permission. They recheck cancellation/generation before SDK/CLI dispatch,
before fallback and before returning output; a changed generation rejects with
`CAPABILITY_UNAVAILABLE` rather than dispatching or publishing obsolete results.
In the compact profile, document-symbol execution additionally requires the
canonical file to be inside an existing, canonical project root whose preparation
report verified `documentSymbolProvider`. A verified sibling project does not
authorize the request; missing or inaccessible roots fail closed before bridge
execution. This initialization evidence does not prove document indexing or
end-to-end host availability.

The fallback order is the active OpenCode SDK symbol client, native OpenCode
LSP, the CLI bridge, AST, then grep. Workspace-symbol requests use the active
SDK client when available, avoiding an isolated process; document symbols and
diagnostics retain the CLI bridge. OpenCode 1.18.30 exposes model-facing LSP
only when `OPENCODE_EXPERIMENTAL_LSP_TOOL` or global experimental mode is enabled.
Patchline does not start a duplicate server for OpenCode-native recipes. Its
optional CLI bridge is exposed as `patchline_lsp` rather than `lsp`, preserving
OpenCode's native experimental tool when that capability is enabled.

Patchline discovers supported language projects recursively, excluding repository
 dependencies, generated directories, hidden control directories, and
 symlinked directories. Discovery uses extensions, manifests, nearest project
 roots, and shebangs, and may return multiple servers for a monorepo.

The registry covers OpenCode's common native servers and managed npm recipes for
servers not provided by the current OpenCode installation. Explicit `lsp: false`,
per-server disabled entries, and custom commands remain authoritative. Managed
installations live outside the project in a per-user cache, use exact package
versions, an inter-process lock, temporary directories, a completion marker, and
no lifecycle scripts. Project toolchains remain requirements rather than being
silently installed by scanning.

Within one preparation call, projects sharing a managed npm server share its
installation result, including failures. A failed download is not retried for
each project root. The next preparation call retries, so installing or repairing
the toolchain does not leave a persistent negative capability cache. Successful
commands still require a separate initialization handshake for each project root;
installation reuse never grants another root verified capabilities.

Preparation reports distinguish `configured`/`native` from `verified`. A server
is verified only after a bounded LSP `initialize` handshake; finding an executable
on PATH alone is not a working connection. Failed optional setup is reported by
`patchline_lsp_status` and does not prevent OpenCode startup.

Automatic setup is controlled by `lspAutoSetup`, `lspAutoInstall`, `lspMaxEntries`,
and `lspStorageDirectory`. CLI `lsp check` performs discovery without
installation; `lsp setup` permits managed installation. Both support
`--directory` and `--json`.

When the native tool flag is disabled, Patchline's `lsp` tool bridges
`workspaceSymbol`, `documentSymbol`, and diagnostics through the installed
OpenCode CLI. Definition/reference/call hierarchy remain native-only.

The CLI bridge never invokes a shell. It propagates OpenCode tool cancellation,
has a 120-second execution deadline to allow slow OpenCode LSP startup, and bounds each captured output stream to
200,000 characters so an unhealthy CLI cannot retain unbounded memory. A
successful explicit empty JSON result (`[]` or `{}`) is accepted for diagnostics.
Empty or whitespace-only diagnostics stdout is `DIAGNOSTICS_UNAVAILABLE`, with
`validation: "unverified"`; exit code zero alone does not prove clean validation.
Empty symbol results
are returned as `CAPABILITY_UNAVAILABLE` with an explicit native-LSP/AST/grep
fallback hint, since the isolated CLI request cannot prove that a document or
workspace index has been initialized. Disabled or unconfigured LSP is reported
with the same capability error rather than being misreported as no symbols. The bridge requests OpenCode startup logs at INFO level to make
that distinction observable without changing the user's OpenCode configuration.
Capability errors include the requested `operation`. Disabled/unconfigured LSP
adds `lsp: "disabled"`; empty symbol output adds `indexing: "unverified"`. These
are distinct degraded states and integration checks accept the host's actual
state rather than requiring indexing to be unverified when LSP is disabled.
