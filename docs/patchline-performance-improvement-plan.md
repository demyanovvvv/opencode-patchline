# План повышения эффективности Patchline без потери качества

Дата: 2026-10-16.

Статус: P0–P4 частично реализованы и покрыты локальными/контролируемыми проверками;
P5 Windows safety gates выполнены частично. Экспериментальное подтверждение
выигрыша, полный platform/isolation gate и итоговый acceptance ещё не выполнены.

### Текущее выполнение

- User authorized two fresh serial diagnostic sessions (180-second process
  deadline each) and will provide the independent holdout owner/corpus. The
  requested aggregate token ceiling was not supplied; no new provider request
  has been dispatched pending that clarification. Temporary script output is
  now exclusive `serial-diagnostic-v4`, preserving v3; phase artifacts and
  measurement-before-grading are prepared. Holdout ownership/composition remain
  pending delivery, not verified by the user's intent to provide them.

- Temporary diagnostic observability completed: exclusive timestamp artifacts
  now bracket setup, process start/end, grading start/end, cleanup start,
  relay closure, and cleanup end. TypeScript transpilation reports zero syntax
  errors without executing the script or making provider requests. Historical
  v3 artifacts remain unchanged; new execution still requires fresh authorization
  and a new exclusive output directory. This instrumentation is preparation,
  not evidence that the historical delay is fixed.

- Local three-files phase reproduction (no external model): fixture preparation
  275ms, unchanged-workspace grading 243ms (functional failure/preservation pass
  as expected), cleanup 4ms. These phases do not reproduce the 586-second v3
  inter-dispatch delay. The temporary diagnostic script now saves process code,
  timeout, duration and relay measurements before grading, matching the existing
  runner's measurement-first principle. It was not rerun; existing exclusive
  v3 directory also prevents accidental reuse of the consumed authorization.

- Serial v3 timeline correction from authoritative dispatch timestamps:
  slot 1 `2026-10-18T16:47:31.189Z`, slot 2
  `2026-10-18T16:57:17.471Z`, a 586282ms interval. The 600000ms enclosing
  limit therefore left under 14 seconds after slot-2 dispatch (and less after
  setup), not its intended 180-second window. Slot 2 is an interrupted attempt,
  not evidence of a provider timeout. The unexplained overrun belongs to slot-1
  setup/run/grading/cleanup before the next dispatch; the temporary script did
  not retain per-phase timestamps or run duration, so finer attribution cannot
  be recovered. Future authorized diagnostics require phase timing and an outer
  limit that includes setup/grading/cleanup, not just process deadlines.

- Fresh rebuilt installed-host controlled session passed via
  `node scripts/native-session-smoke.mjs --compact --serial-tools`: actual host
  tool loop, hidden-tool assertions, multi-file native mismatch with no writes,
  fresh-read recovery, and request forwarding of the serial option. This uses
  a controlled provider and consumes no external model-session authorization;
  it verifies the current build's integration but not external-provider serial
  compliance or autonomous anchor/batch adoption.

- P1 real-session inventory audit: v10 first provider requests offer stock 7,
  original 9, optimized 13 tools. Optimized names are `apply_patch`, `ast_search`,
  `bash`, `edit`, `glob`, `grep`, `patchline_diagnostics`, `patchline_edit_batch`,
  `patchline_grep`, `read`, `skill`, `todowrite`, `write`. Therefore the proposed
  8–10 total-tool target is not met by the measured compact host, despite
  removing five plugin routers/status tools. Native `grep` and `patchline_grep`
  coexist, but removing the latter needs host-capability/fallback evidence;
  tool count alone is not grounds to remove a supported search path. Earlier
  plugin-only counts must not be presented as full host footprint acceptance.

- V10 extra-turn localization from actual event inputs: targeted optimized
  repeats both add a second glob for `**/AGENTS.md` before read/apply_patch;
  stock/original repeat 0 use glob/read/apply_patch/bash. Large-file optimized
  uses glob/grep/read/snapshot-edit/bash (repeat 0 `patchline_grep`, repeat 1
  native grep), versus stock/original glob/grep/apply_patch/bash. The bounded
  read authorizes snapshot editing and must not be removed to match native
  patch turn count. Anchor-read could combine search and observation, but the
  measured model did not select it. No evidence supports bypassing instruction
  discovery or snapshot guards as a performance fix.

- Additional attribution from immutable v10 results (no new model requests):
  stock/original/optimized used 36/36/40 provider calls and model steps.
  Optimized targeted and large-file each used six steps in both repeats versus
  five for stock; three-files used eight in every treatment/repeat. Summed tool
  time improved to 3551ms versus stock 4064ms, insufficient to offset extra
  model turns. Across requests, tool-schema bytes were 536400/654624/685280
  (14900/18184/17132 per call); system bytes 194032/197560/267704; tool-result
  bytes 34041/34347/35477. Thus compact reduced schema bytes against original
  per call but remained above stock, with larger system context and extra
  turns. Byte counts are not token estimates; actual total tokens remain the
  acceptance metric. This directs optimization toward turn count/host footprint,
  rather than further tool micro-latency tuning without end-to-end evidence.

- Serial timeout localization without paid requests: a controlled HTTP upstream
  opened SSE, emitted one frame, and never ended. Relay timeout 250ms closed
  the fetch and cleanup in 293ms, retained HTTP 200 and null usage, and recorded
  `Provider transport failure or timeout`. Together with the process timeout
  check, this excludes the simple idle-child and stalled-SSE reproductions;
  it does not identify which phase consumed the interrupted v3 slot-2 deadline.

- P3 cache audit against current source: `fingerprintLspCommand` includes
  command/cwd/PATH/NODE_OPTIONS and ancestor manifest/lock metadata; manager
  snapshots configured LSP entries and rejects a changed configuration during
  preparation. Fresh health/manager tests pass (36/36). The implementation
  explicitly fingerprints launcher identity, not transitive dependency content;
  therefore unchanged manifests/locks with replaced imported dependency bytes
  remain outside the proven invalidation scope. Do not mark the full toolchain
  invalidation criterion closed on these tests alone.

- Fresh offline benchmark smoke executed from the approved temporary directory
  to preserve repository report files: one-line edit functional success,
  30 context lines, one addition/deletion, no whole-file rewrite or stale
  overwrite; repeated-read index reused in all five samples (median 1.71ms),
  bounded grep found one match across 48 files without truncation/skips.
  Artifact: `C:/Users/demya/AppData/Local/Temp/opencode/benchmarks/reports/latest.json`.
  These are descriptive single-run local measurements, not stock-relative
  token/time acceptance. `wsl.exe --list --quiet` still returns no installed
  distribution, leaving Linux execution/isolation evidence unavailable here.

- Current-worktree verification after fragment telemetry and serial diagnostic:
  `npm test` passed all 73 test files (697 passed, 1 skipped, 698 total);
  `npm run typecheck` and `npm run lint` also passed. This supersedes the older
  full-suite count, but provides local correctness evidence only, not release,
  platform/isolation, holdout, or end-to-end performance acceptance.
  Fresh follow-up `npm run build`, `npm run doctor`,
  `npm run audit:dependencies`, and `npm run smoke:package` passed (isolated
  tarball installation/public imports; no high/critical advisories). Direct
  package-smoke invocation first failed because it requires npm_execpath;
  the supported npm script then passed. Doctor reports native LSP disabled
  and no TypeScript server in its default environment, so this is not a new
  general LSP capability proof; controlled persistent-server evidence retains
  its narrower scope.

- Serial-tools diagnostic v3 consumed both newly authorized dispatches with
  model option `parallel_tool_calls: false`. Slot 1 timed out: one HTTP 200
  response, null provider usage, incomplete tool-call stream with no calls;
  functional grading failed (no intended edits), preservation passed. Slot 2
  has a dispatch record but no result: the enclosing command exceeded 600000ms.
  Current process inspection confirms no diagnostic node/opencode process
  remains. Preserve `serial-diagnostic-v3/dispatch-{1,2}.json` and
  `result-1.json`; missing slot-2 evidence is unknown, not success or zero usage.
  These attempts cannot establish provider compliance, quality equivalence,
  or performance; no authorized retry remains. Investigate timeout/cleanup
  behavior locally before requesting any further paid diagnostic sessions.
  Local follow-up: direct `runProcess` idle-child timeout (250ms) returned
  `timedOut:true` in 403ms; existing targeted process-tree timeout and real
  streaming-relay tests both passed (2 tests). Thus the generic timeout path
  is not reproduced as broken; these checks do not explain the interrupted
  external session or prove bounded cleanup for every provider stream.

- Controlled installed-host check confirms model-level option
  `parallel_tool_calls: false` is forwarded in the actual provider request.
  `node scripts/native-session-smoke.mjs --compact --serial-tools` passed after
  first failing when the option was absent. This provides a verified diagnostic
  configuration path despite no explicit native-route field found earlier;
  it does not establish external provider compliance or token savings. Default
  smoke/global configuration remain unchanged; option applies only with flag.

- Installed-host source inspection: native `packages/llm/src/protocols/
  openai-compatible-chat.ts` delegates to `OpenAIChat.protocol`; the delegated
  `openai-chat.ts` declares/lowers `tool_choice` but has no parallel-call option
  in the inspected source. Session/provider source searches likewise found no
  `parallelToolCalls` / `parallel_tool_calls`. This is evidence about this native
  route only, not the separate AI-SDK adapter or whether this benchmark selects
  that native route. Do not silently inject a request override or claim host
  support based on generic OpenAI documentation. No configuration changed.

- Two newly authorized structural diagnostics completed without timeout and
  reproduced the same pattern: second provider response initializes three read
  calls and one bash call, each with exactly one string argument fragment that
  is empty; no missing-property or non-string argument fragments were observed.
  Later individual calls receive many nonempty fragments and valid JSON.
  Evidence: approved temp `parallel-diagnostic-v2/result-{1,2}.json` and durable
  dispatch records. This supports initialization-only parallel responses in the
  recognized tool-call delta format; unrecognized frame shapes remain possible.
  Temporary script's event usage is null and it did not retain provider usage
  or final grading, so these are structural diagnostics only, not performance
  or quality evidence. Both newly authorized sessions consumed; no retry budget.

- Two authorized parallel-call diagnostic dispatches failed before any relay
  requests: temporary diagnostic script incorrectly called `runProcess` with
  positional cwd/env/timeout rather than its options object. Both recorded
  immediate timeout, null usage and zero relay responses. They provide no
  provider-format evidence and are not successful diagnostic sessions. Ledger
  and outputs preserved under approved temp `parallel-diagnostic-v1/`; call
  signature corrected afterwards without rerunning or replacing failed slots.
  Treat both dispatches as consumed; any retry requires authorization.

- Streaming diagnostic covers three interleaved indexed read calls with empty
  initialization followed by fragmented arguments, reordered call fragments,
  CRLF SSE and every possible two-chunk transport split. Existing relay parser
  reconstructed exact argument byte counts/SHA256 and valid file paths in all
  cases; targeted test passed without production changes. This rules out this
  standard indexed streaming pattern as a reproduction of v10's missing
  arguments, not every possible upstream format or UTF-8 transport behavior.

- v10 empty-read localization: in three-files repeat 1, all three treatments'
  second provider response has `responseToolCalls.complete: true` and three
  read calls with `argumentsBytes: 0`, empty-string SHA256, `validJson: false`
  and `readPathValid: false`. Subsequent single reads have nonzero valid JSON
  arguments. This places the observed missing arguments at or before the
  relay's response reconstruction, rather than only at Patchline execution.
  It does not distinguish upstream malformed parallel-call streaming from a
  reconstruction bug; raw content is intentionally not retained. Investigate
  streaming format/indices and controlled fragmented parallel responses before
  changing tool schemas or suppressing validation. No external calls used.

- Provider-boundary diagnostic now asserts the exact generic anchor-read policy
  example exists in actual compact-session system messages, not only the plugin
  hook output. Controlled compact native-session smoke passed this assertion
  alongside schema and mutation guards. Thus the local installed host can
  transmit this guidance; this does not prove the external provider follows it
  or retrospectively inspect v10 request contents. No external calls used.

- Authorized anchor-example candidate v10 completed 18/18 sessions, integrity
  complete, all treatments 6/6 successful. Stock: 242626 tokens / 209668.2141 ms;
  original: 261890 / 251792.4653; optimized: 273533 / 248261.4739. Optimized
  is 12.74% worse in tokens and 18.41% slower than stock, and 4.45% worse in
  tokens than original. No optimized anchor read was selected in any of six
  sessions; both large-file runs retained discovery + grep + bounded read +
  snapshot edit + bash. The example did not demonstrate the intended behavioral
  improvement and is not an accepted performance optimization. Six shared
  empty read errors persist in optimized three-files tasks. Evidence preserved
  in `patchline-attribution-anchor-v10/attribution-manifest.json` and
  `patchline-attribution-anchor-run-v10/{results.json,summary.md}` under approved
  opencode temp. All 18 authorized dispatches consumed; no further live budget.

- Post-v9 candidate adds a generic anchor-read JSON example to compact policy
  explicitly replacing grep then read, retaining ambiguity/offset/snapshot/
  validation rules and the <1800-byte bound. Regression RED/GREEN: 98 plugin
  tests, typecheck and lint passed. Fresh build and both extended/compact
  native-session controlled-provider smokes passed, including no-write native
  mismatch recovery and compact hidden-tool assertions. This candidate is
  distinct from v9 and has no external-model performance evidence; v9 results
  must not be attributed to it.

- Full v9 trace aggregation (all six sessions per treatment): stock/original/
  optimized used 38/38/39 model steps, 37/36/37 tool calls and 4500/3750/3457 ms
  summed tool execution. Optimized token components: 114561 uncached input,
  149248 cache-read and 2386 output; stock: 120332/132224/3209. Total-token
  accounting therefore reverses the apparent uncached-input improvement.
  Optimized used native apply_patch five times and snapshot edit once; neither
  anchor reads nor batch edits were selected. All three treatments had three
  empty-argument read errors in each three-files repeat (six per treatment);
  stock also had one empty-argument bash error. These shared failures cannot
  be attributed solely to Patchline. Counts computed from final graded
  `results.json`, not pre-grading attempt outcomes. A new candidate should
  address model-step/context overhead; repeated unchanged pilots are not an
  optimization strategy. No additional provider dispatches were made.

- Post-v9 local verification: immutable attribution preparation reverified
  against current harness, plugin artifacts and installed binaries without
  provider calls. Full test suite: 73 files, 695 passed / one skipped (696);
  typecheck and lint passed. These checks do not change the failed performance
  acceptance or establish holdout/platform-isolation coverage.

- Newly authorized v9 attribution pilot completed all 18 sessions with complete
  integrity and 6/6 successful tasks in each treatment. Stock: 255765 tokens,
  212654.1895 ms; original: 277580 tokens, 260965.2946 ms; optimized: 266195
  tokens, 245498.6424 ms. Optimized improves over original by 4.10% tokens and
  5.93% time, but remains worse than stock by 4.08% tokens and 15.45% time.
  Performance acceptance is not established; no observed failures in six pairs
  do not establish quality non-inferiority. Immutable preparation and raw run
  evidence: temporary `patchline-attribution-quality-v9/attribution-manifest.json`
  and `patchline-attribution-quality-run-v9/` under the approved opencode temp
  directory. All 18 authorized dispatches are consumed; further live sessions
  require new authorization. Historical interrupted v8 was not resumed.

- v9 trace diagnosis, not a causal aggregate: optimized targeted repeat 1 used
  two globs, read, native apply_patch and bash (five tools, zero tool errors,
  618 ms summed tool time within about 40.4 s total). Optimized large-file
  repeat 1 used glob, grep, bounded read, snapshot-bearing edit and bash
  (five tools, zero errors, 724 ms summed tool time within about 38.4 s total).
  Thus snapshot editing was exercised, but the anchor optimization was not
  selected in this observed large-file run; no claim that all optimized runs
  bypass Patchline is warranted. Improving local edit latency alone cannot
  explain or remove the tens-of-seconds end-to-end deficit in these examples.
  Evidence: v9 `results.json` events/tools and toolTiming, not raw attempt
  `success` fields (attempts are persisted before final grading).

- Quality veto is now surfaced in both Markdown and the HTML report's leading
  notices, independently of positive token/time savings. HTML uses escaped JSON
  and `textContent` for task identifiers; empty results explicitly state that
  absence of quality regression is not established. Targeted comparison suite
  (125 tests), typecheck and lint passed after the shared notice implementation.

- Built distribution verified against the actual persistent Windows host after
  the empty-SDK-response fix: four native LSP operations still returned known
  symbols/locations, while `runOpenCodeLspClient` returned `data: []` with the
  asserted `capabilityNote` warning against treating emptiness as absence.
  Regression followed RED/GREEN; 172 search/plugin/deep-review tests plus
  typecheck/lint passed. Contract updated in `docs/specs/lsp-contract.md`.
  This verifies the packaged bridge behavior, not SDK endpoint functionality.

- Same-session differential LSP probe now also verified native
  `workspaceSymbol(query: gateExample)` returns the known function, while the
  actual installed SDK `find.symbols` plus Patchline `runOpenCodeLspClient`
  returns an envelope with `data: []`. This isolates the missing capability to
  the HTTP SDK endpoint rather than TypeScript workspace indexing. All four
  native operations and the expected SDK limitation were checked in one run;
  temporary host/fixture cleaned, no external model used.

- Actual installed SDK workspace-symbol bridge probe did not find the known
  `gateExample` symbol, despite the same persistent host returning native
  symbols/definition/references. Root cause confirmed in installed host source
  `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts`:
  `findSymbol` unconditionally returns `[]` (lines 62–64). Thus connected LSP
  status and SDK method availability are insufficient capability evidence for
  this host version. SDK workspace-symbol parity remains unavailable; empty
  results must not be interpreted as proof that the project has no symbols.
  Native LSP remains a verified alternative in this controlled Windows host.
  No user configuration or installed host source was changed by the probe.

- Capable Windows persistent-host LSP check passed against a real installed
  TypeScript language server, using a local controlled HTTP provider and an
  isolated `opencode serve` session. Native `lsp` returned document symbols
  `answer`/`gateExample`, definition at zero-based line 0 character 16, and
  references at declaration plus call (line 1 character 22). The final probe
  selected the function call, not the adjacent variable. Temporary script:
  `Temp/opencode/persistent-lsp-gate.mjs`; host process tree and fixture cleaned
  after execution. No external model calls. This closes the native persistent
  Windows symbol/definition/reference capability probe, not SDK bridge parity,
  Linux capability, cache invalidation matrix or performance acceptance.

- Fresh offline comparison at `patchline-current-local-gates-final` passed
  corpus behavioral/preservation checks with zero measured model pairs and
  savings correctly withheld. Anchor replay (20 balanced warm pairs) retained
  identical pages: median 4.3319 ms versus grep+read 6.9672 ms, one versus two
  calls, 419 versus 623 output characters. Batch replay retained identical final
  bytes and halved calls, but mean local time was 10.4280 ms versus sequential
  9.9597 ms (no local latency win established; tails also worse). These are
  local measurements, not provider-token or end-to-end acceptance evidence.
  Latest full suite: 693 passed, one skipped across 73 files; dependency audit
  found no high/critical advisories. Doctor retained explicit missing native
  LSP toolchain/flag status rather than reporting that gate as passed.

- Windows host-upgrade gate passed with `npm run smoke:host-upgrade`:
  rebuilt the temporary integrated host, exercised CLI downgrade to 1.18.35
  and upgrade to 1.19.0, repeated upgrade idempotently, and verified byte-identical
  OpenCode/TUI configuration with unrelated plugins preserved. The script used
  an isolated temporary binary/configuration and cleaned them in `finally`.
  This is Windows installation evidence, not Linux/isolation or performance
  acceptance. No model requests were made.

- Attribution resume now binds saved results to model/provider/step/timeout
  settings fingerprints; missing historical identity fails closed. Regression
  tests reproduced both missing validation and incorrect provider wiring before
  fixes; 123 comparison tests, typecheck and lint passed. A local interrupted-slot
  test also preserved raw evidence while consuming the next slot; it does not
  establish full concurrent-runner isolation.

- Attribution resume grading regression fixed: grader emits `complete`, not
  `completed`. Extracted validator covers actual status, duplicates, null,
  wrong treatment and undispatched results; 120 comparison tests/typecheck/lint
  passed. Offline verification against the two real v8 saved measurements
  passed schedule membership and raw artifact hash/field checks, assuming
  three consumed slots solely for this diagnostic. No historical ledger was
  fabricated, manifest changed or execution resumed; v8 remains interrupted.

- Token-only reporting follow-up: regenerated current offline artifacts after
  removing monetary commentary from Markdown/HTML and runner notes; content
  search found no tariff/cost/free-price claims. Typecheck/lint and full suite
  passed (689 passed, one skipped, 73 files). Browser checked the preceding
  HTML generation via temporary loopback server: dynamic sections rendered,
  zero console errors/warnings, zero sessions correctly shown as no savings
  data. Server was stopped. This is rendering evidence for offline empty-data
  report, not attribution/full-series acceptance or visual review of all states.

- Current comparison harness offline check passed local checks and golden
  behavioral/preservation evaluation for the corpus, with report at temporary
  `patchline-current-golden-ledger-check`. Report correctly has zero measured
  pairs and no token/time savings. Comparison suites passed 118 tests, including
  concurrent attribution reservation; extended plugin smoke registered all
  11 required tools. Golden fixtures validate grading mechanics, not actual
  model quality, independent holdout or representative performance.

- Installer flags smoke passed project/global wrappers, cwd, read-only preview,
  component flags and removal. Host-restoration smoke initially rejected the
  default integrated executable as an invalid original backup, as intended.
  Re-running with the prepared stock OpenCode executable passed native binary
  replacement, guarded restore, original hash/version and delayed preview in
  its temporary fixture. No user host binary was replaced by this smoke.

- Refreshed Bun/runtime safety checks: Hashline differential corpus passed all
  12 cases against the installed upstream. Hashline Bun smoke passed clipboard,
  blocks, merging, MV/REM, stale/unseen/path guards and failed-register isolation.
  Mounted TUI smoke passed reactive progress, diff and validation-failure rendering.
  These exercise current runtime paths independently of Node fallback; they do
  not establish a full upstream corpus equivalence or performance acceptance.

- Patchline's actual `runOpenCodeLspBridge` diagnostics path also returned and
  parsed the fixture's expected TS2322 through the installed integrated host.
  Source inspection explains the symbol-probe limitation: native host LSP tool
  touches the document before querying; the standalone CLI document-symbols
  command directly queries a fresh instance. Empty CLI symbols therefore do not
  demonstrate a broken persistent host capability. No adapter changes made;
  persistent-session symbol verification remains required.

- LSP probe correction: the previous fixture had no explicit OpenCode LSP
  config, so its empty symbols result alone was inconclusive. With an explicit
  temporary config pointing to the installed TypeScript language server, the
  integrated host `debug lsp diagnostics` reports the expected TS2322 on main.ts
  (number returned as string, line 1 zero-based). This proves real host/server
  diagnostics for that fixture. A separate fresh-process `document-symbols`
  request still returns []; symbol capability and persistent-session behavior
  remain unverified. No real-model calls or global configuration edits used.

- Refreshed installer integration gates locally: `smoke:installer-lsp` passed
  actual npm installation of TypeScript/server dependencies, configured server
  version launch and uninstall dependency removal in a temporary project.
  `smoke:installer-lifecycle` passed Russian install, read-only preview, removal
  and unrelated-plugin preservation. Server version launch is not proof that
  the integrated host offers working symbol/definition/references capabilities;
  capable-host LSP and Linux/platform gates remain open.

- Current local gate refresh after attribution-ledger changes: build and doctor
  passed host/package identity, CRLF/BOM and zero-overwrite self-tests. Doctor
  still reports no TypeScript language server and disabled native LSP flag, so
  capable-host LSP is not satisfied. Benchmark smoke preserved the one-line
  edit (one add/delete, zero whole-file/stale overwrites), with line-index reuse
  in all five repeated reads. Isolated tarball/public-import package smoke passed;
  dependency audit found no high/critical advisories. These local observations
  do not establish provider-token savings, Linux/isolation or study acceptance.

- User declined a replacement live series after the v8 harness mismatch and
  selected local work. No new provider calls are authorized by that choice.
  Sequential attribution reservation now rejects out-of-order slots before
  execution (RED/GREEN). Full local suite passed 687 tests, one skipped, across
  73 files; typecheck/lint passed. An additional concurrent-reservation test
  confirms exactly one winner among eight callers for a single slot; this is
  not full concurrent-runner isolation. Reporting contract documents ledger
  consumption, artifact validation and unchanged-harness requirements.

- Compact v8 received explicit authorization for 18 sessions. The terminal
  timeout interrupted slot 3 after two saved successful measurements (stock
  targeted 39374 tokens/31.7s; original targeted 42610 tokens/40.3s). Slot 3 is
  consumed, not retryable; 15 authorized launches remain. No optimized result
  was saved. Attribution now has durable exclusive/fsynced dispatch records
  and resume validation of schedule, preparation and raw artifacts; 117
  comparison tests, typecheck and lint passed. The v8 manifest predates this
  harness change: verification explicitly rejects it with "Attribution harness
  changed since preparation". Preserve v8 as interrupted evidence; do not
  rewrite its manifest or combine a changed-harness continuation as unchanged
  experimental provenance. No additional provider launches occurred here.

- Follow-up compact safety audit restored the explicit proportional post-edit
  diagnostics/validation instruction (RED then GREEN), still below 1800 UTF-8
  bytes. Read schema composition now preserves pre-existing provider `not`
  constraints through `allOf`, without mutating the original schema (regression
  RED then GREEN). 98 plugin tests, typecheck, lint, build and compact native
  session smoke passed. Before these two follow-ups the full suite passed
  685 tests with one skipped across 73 files; that full-suite result does not
  cover the subsequent changes. Neither change has new live-provider evidence.

- Compact policy now uses a dedicated shorter text rather than filtering the
  extended Hashline policy. RED regression measured the previous 2168 bytes
  against a <1800-byte budget; current policy passes with snapshot/observed-range,
  stale recovery, native patch recovery, unrelated-code and selector guidance.
  97 plugin tests, typecheck, lint and compact native-session smoke passed.
  Provider token savings and model behavior remain unmeasured; no new live
  sessions were used and the v7 performance deficit is not declared resolved.

- v7 decomposition: stock/original/optimized provider calls 39/36/40, summed
  provider exchange 163166.0654/165486.5416/218874.4603 ms; summed tool execution
  5112/4028/3893 ms. First-request schema bytes 14900/18184/17132 and targeted
  system bytes 5386/5484/7703. Optimized's 84-second large-file outlier includes
  70631.2 ms provider exchange, not a comparable local-tool stall. All six invalid
  read inputs per treatment are `{}` on three-files (three per repeat), and are
  therefore not an optimized-only failure. Stock/original used native apply_patch
  for all six tasks; optimized used edit for both large-file repeats and native
  patch for the other four. This identifies policy/context and extra model turns
  as candidates; local runtime tuning alone cannot explain observed time excess.

- Schema attribution v7 completed all 18 newly authorized sessions, complete
  integrity/usage, all three treatments 6/6 successful. Stock: 262486 tokens,
  209522.6257 ms; original: 261402 tokens, 247771.3448 ms; optimized: 273905 tokens,
  303111.1081 ms. Optimized remains 4.35% higher tokens and 44.67% higher time
  than stock; one optimized large-file session took 84 seconds and is retained.
  Optimized read recovery improved descriptively versus v6: 10/16 successful,
  zero upstream selector conflicts (v6 0/28 successful, 17 conflicts). Six invalid
  upstream paths remain in each treatment; optimized has 38 tool calls/6 errors,
  stock37/6, original34/6. Cross-series cache/routing/time are uncontrolled, so
  this is consistent with the structural fix, not causal/statistical acceptance.
  Artifacts: `C:/Users/demya/AppData/Local/Temp/opencode/patchline-attribution-schema-run-v7/`.
  All 18 new authorizations consumed; full130 remains premature on these results.

- Implemented precision read selector exclusion through host `tool.definition`
  JSON Schema (`not` requiring both anchor/offset). Native compact boundary test
  failed before implementation and passed after build; extended boundary smoke
  also passed, proving the constraint reaches the controlled provider in both
  profiles. Runtime guards unchanged. 128 plugin/read-edit tests, typecheck and
  lint passed. Older hosts lacking the schema hook retain runtime validation;
  real-model compliance and stock-relative improvement remain unproven.

- Further installed API inspection identified a possible structural-schema route:
  SDK `tool.definition` can replace provider-facing parameters without changing
  runtime read arguments. Host registry separately tracks `parameters` and
  `jsonSchema`, dropping its cached schema when parameters are replaced. This
  requires native-session provider-boundary proof: local Zod conversion alone
  cannot establish that a read selector constraint survives the host/provider
  pipeline. No schema change is implemented or live efficacy claimed yet.

- Installed SDK/host inspection for the read failure: SDK 1.19.0 `tool()` accepts
  a Zod raw shape, and integrated host registry wraps plugin args with
  `z.object(args)` before JSON Schema conversion. Current read represents anchor
  and offset as independent optional properties; their mutual exclusion is only
  prose plus runtime validation, not a structural provider-schema constraint.
  A root union cannot simply replace `args` under this installed contract.
  Follow-up designs must preserve existing read safety/API or explicitly version
  the model-facing contract, and require host-boundary regression coverage before
  another live pilot. This explains the missing structural constraint, not why
  this provider repeatedly ignores required filePath.

- Attribution v6 trace audit: optimized made 44 tool calls, 29 tool errors and
  28 read attempts with zero successful reads. Seventeen reads combined anchor
  with offset; eleven had invalid/missing filePath. Provider response telemetry
  independently records the same 17 selector conflicts and 11 invalid paths,
  so these are present upstream rather than inferred solely from host errors.
  Stock had 36 calls/6 errors and 8/14 successful reads; original had 36 calls/
  7 errors and 9/15 successful reads. All four optimized failures exhausted eight
  steps; both successes used grep/apply_patch, not successful Patchline reading.
  Existing schema prose/examples and retry messages therefore did not resolve
  selector/path generation failures in this series. A structural schema/policy
  investigation is needed before another live experiment; guards must remain.

- Newly authorized attribution v6 completed all 18 sessions with complete usage
  and integrity (`C:/Users/demya/AppData/Local/Temp/opencode/patchline-attribution-current-run-v6/`).
  Stock: 6/6, 255411 tokens, 213042.679 ms; original: 6/6, 268923 tokens,
  246005.1314 ms; optimized: 2/6, 305056 tokens, 259091.0622 ms. Optimized versus
  stock used 19.44% more tokens and 21.61% more time. All four optimized failures
  (targeted and three-files, both repeats) preserved files but made zero intended
  changes. This pilot rejects proceeding to full130 on the present candidate;
  root-cause analysis is required. All 18 new authorizations are consumed.

- Resume raw-artifact checks now preserve execution errors as an unchanged
  prefix while allowing grading errors to append. RED/GREEN tests reject removed
  or replaced execution errors and accept appended grading errors; 116 targeted
  tests, typecheck and lint passed. This closes an error-hiding gap, not the
  remaining grading authentication or end-to-end acceptance gates.

- Current offline comparison golden checks passed (report in
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-current-golden-check/`);
  plugin smoke registered all 11 required extended tools. The strengthened raw-
  artifact verifier accepted the historical recovery dataset: 12 dispatches,
  11 verified measurements, zero remaining schedule slots. Its interrupted
  attempt remains consumed and the dataset remains incomplete; this offline
  artifact check does not bypass the newer execution-identity resume gate.

- Current local benchmark smoke passed: one-line edit functional success,
  added/deleted 1/1, zero stale overwrites and whole-file rewrites, line-index
  reuse 5/5 (p50 1.95 ms, p95 2.71 ms). Native session smokes passed for extended
  and compact against a controlled provider, including mismatch no-write and
  recovery. These validate local/host behavior, not live-model quality or stock-
  relative token/time targets; no authorized real provider sessions were consumed.

- New profile execution identities pin model, steps, timeout and provider config
  via SHA-256, preventing changed settings from silently resuming a series. Raw
  credentials are not included in persisted identity. Historical executions
  without this fingerprint are not retroactively upgraded and fail closed on
  resume. RED/GREEN regression, 116 comparison/runtime tests, typecheck and lint
  passed. No new provider sessions were used.

- Resume verification additionally rejects changed measurement fields such as
  reported usage or duration even when the referenced raw artifact hash is valid.
  RED/GREEN regression, 115 comparison/runtime tests, typecheck and lint passed.
  The strengthened verifier also accepted all 12 existing guidance measurements
  against their dispatch ledger and raw artifact bytes, without provider calls.

- Profile resume now rejects malformed/duplicate/out-of-ledger outcomes and
  validates the actual `{ file, sha256 }` measurement reference format. Before
  accepting previous results, it hashes saved raw bytes and checks task/repeat/
  profile/mode identity. Regression coverage includes byte tampering and identity
  mismatch; 115 comparison/runtime tests, typecheck and lint passed. This does not
  authenticate grading outcomes or establish external provenance, and is not a
  substitute for the full study or acceptance gates.

- After the resume integrity changes, the full local suite passed: 73 files,
  683 passed/1 skipped. Current build and isolated-tarball package smoke passed;
  doctor confirmed integrated host/package match and stale/write plus CRLF/BOM
  checks; dependency audit found no high/critical advisories. Doctor still reports
  no TypeScript language server and the optional native LSP flag disabled, so the
  capable-host LSP gate remains open.

- New schema-guidance diagnostic completed all 12 newly authorized attempts in
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-profile-guidance-v1/`, with
  durable dispatch records and pre/post measurement identity checks. Integrity
  complete. Extended 4/6 successful, 215757 tokens, 247961.5899 ms; compact 4/6,
  194239 tokens, 232552.5144 ms. Descriptive compact savings: 9.97% tokens,
  6.21% time. These are profile-to-profile contrasts, not the stock OpenCode
  contrasts required by §12; they cannot establish whether its 20%/10% targets
  are met and are not acceptance evidence.
  Extended reads: 8 successful of 18, 6 selector conflicts, 4 missing paths;
  compact: 8 successful of 17, 5 conflicts, 4 missing paths. Both profiles failed
  targeted/large-file repeat0 and passed all repeat1 tasks; provider/order/cache
  effects remain uncontrolled, so historical improvement cannot be attributed
  causally to descriptions. All new 12 authorizations consumed. Full current
  local suite before this experiment: 73 files, 681 passed/1 skipped.
  Repeat stratification: repeat0 extended/compact both 1/3 successful, 10/11
  tool errors, 142944/130530 tokens and 127474.709/125084.9931 ms (8.68% token,
  1.87% time savings). Repeat1 both 3/3 successful, zero tool errors,
  72813/63709 tokens and 120486.8809/107467.5213 ms (12.50% token, 10.81% time).
  Every conflicting/missing-path read belongs to repeat0. The balanced reverse
  order does not remove this repeat-level instability; even the clean repeat1
  descriptive token saving is 12.50% against extended, not against stock OpenCode.
  Do not pool historical diagnostics
  or claim an accepted profile from this dataset.
  Provider call counts repeat0→repeat1: extended 21→13, compact 20→12.
  Cache-read tokens also changed (extended 63232→35328; compact 58240→17408),
  with cacheWrite=0. Total token accounting includes cache reads; the improved
  repeat cannot be explained as a controlled warm-cache comparison. Provider
  routing and causal explanation for the error concentration remain unknown.

- Read schema guidance follow-up: both profiles now publish separate valid
  offset/anchor examples, mandatory filePath guidance, and explicit omission of
  the unused selector (no default offset/empty anchor). Plugin regression was
  RED→GREEN; 96 plugin tests, typecheck/lint passed. Build and both controlled
  native session smokes passed. Additional provider-boundary assertions confirmed
  that both examples and both selector descriptions survive host schema conversion
  in extended and compact. This rules out loss of these new descriptions in the
  tested host path; it does not prove real-model compliance. All earlier real
  measurements predate this schema-description change.

- Recovery series continuation completed all seven remaining authorized attempts
  after verifying source/dist/host/lock identity against profile-execution.json.
  Five legacy dispatch records were explicitly marked reconstructed (four from
  completed results, fifth from shell dispatch output); they do not claim original
  dispatch timestamps. Total authorization consumed: 12 attempts, 11 completed
  measurements and one interrupted three-files/extended/repeat0 without usage.
  Extended completed 4/5 tasks, 243265 tokens; compact 2/6, 303048 tokens.
  All 46 read calls failed: extended 12 selector conflicts + 4 missing paths;
  compact 18 conflicts + 12 missing paths. No successful read recovery occurred.
  Dataset integrity remains incomplete; no aggregate savings or acceptance may be
  inferred. CLI progress counted completed results (ending 11/12), not dispatched
  attempts; dispatch ledger is authoritative for authorization accounting.
  New real sessions require fresh consent. Resume CLI/typecheck/lint and 112
  comparison tests passed, but comprehensive controlled resume integration and
  post-session artifact validation remain follow-ups.

- Read recovery real-model follow-up: user authorized another 12 sessions.
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-profile-recovery-v1/`
  contains four completed measurements; shell timeout interrupted the fifth
  dispatched session, and a process inspection found no surviving runner.
  Count five dispatched attempts against authorization; at most seven remain.
  Do not restart the whole schedule or treat the fifth attempt as unused.
  Completed outcomes: targeted extended PASS / compact FAIL, large-file both
  PASS. Inspection of all completed tool events found 14 rejected read calls
  and zero successful reads: 11 anchor+offset conflicts and three missing paths.
  Successful tasks used grep/apply_patch instead; task PASS does not establish
  read recovery. The stronger error text therefore has no demonstrated recovery
  benefit in this partial dataset. Results remain incomplete, without savings.
  Resume requires a durable dispatch ledger and artifact identity verification;
  preserve existing measurements and account for the interrupted attempt.

- Derived offline profile report generated without provider calls in
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-profile-diagnostic-v3-offline-report/`.
  Source results SHA-256:
  `77f92f36e2b471f7b4a482d610f36da49bbccaf6f5605f3f145e8c6d1acbc880`.
  All 12 run payloads compare identical between source and derived JSON;
  diagnostic integrity is complete and acceptance remains not-established.
  HTML content was inspected, but browser rendering verification could not run
  because the Playwright profile is already in use; no user browser was closed.

- P3 ancestor-workspace follow-up: command fingerprints now include supported
  manifest/lock metadata in parent directories through filesystem root. A new
  RED→GREEN nested-project regression covers ancestor pnpm lock creation/removal.
  Targeted LSP health/plugin checks: 113 passed; typecheck/lint passed. This
  supersedes the earlier ancestor-lock limitation, but does not cover arbitrary
  transitive dependency content changes. Earlier guard latency measurements
  predate this broader traversal and must not be reused as its performance result.
  Refreshed warm microprobe (10 warmups, 100 samples, Node executable, repository
  cwd, ancestor traversal enabled): median 4.2243 ms, p95 5.3277 ms, max 5.9447 ms
  per guard. This is metadata-check overhead, not a whole-session measurement or
  a paired performance estimate. Full current suite: 73 files, 674 passed,
  1 skipped; build passed after the ancestor-lock change.

- Refreshed local gates after diagnostic reporting changes: doctor passed its
  stale/write and CRLF/BOM self-tests and confirmed integrated host 1.19.0 /
  Patchline 1.4.0; it still reports no TypeScript language server and disabled
  optional native LSP flag. Dependency audit reports no high/critical advisories.
  Package smoke passed isolated tarball installation/public imports after build.
  Benchmark smoke (`npm run bench -- --help`, which runs the benchmark rather than
  displaying help) returned functionalSuccess=true, one added/deleted line,
  zero whole-file rewrites/stale overwrites and reused line index on all five
  repeated reads. These local checks do not close real-host LSP, cross-platform,
  isolation or full-series/holdout acceptance gates.

- Read recovery follow-up: selector rejection now explicitly says to retain
  filePath and omit the other selector property entirely. RED→GREEN regression
  verifies no snapshot after rejection, successful bounded anchor retry and
  unchanged file bytes. Current local verification after this change: 73 test
  files, 671 passed/1 skipped; typecheck, lint and build passed. Controlled native
  session smoke passed sequentially for compact and extended. These are local
  safety/integration gates, not evidence of real-model recovery improvement;
  the preceding 12-session diagnostic predates this change and rebuilt dist.

- Завершён отдельный diagnostic extended/compact: 12 разрешённых сессий,
  3 задачи × 2 профиля × 2 повтора с обратным порядком второго повтора.
  Evidence: `C:/Users/demya/AppData/Local/Temp/opencode/patchline-profile-diagnostic-v3/results.json`
  и `profile-execution.json`; v1/v2 остановились на preflight без сессий.
  Extended: 2/6 успешных, 310720 токенов, 291282.4268 ms; compact: 3/6,
  257562 токена, 246877.1008 ms. Описательная разница −17.1% токенов и
  −15.2% времени не доказывает quality noninferiority или acceptance.
  Повторная проверка сохранённых tool events выявила 22/14 read-вызовов
  с одновременными anchor+offset и 6/4 без filePath (extended/compact).
  В targeted обе пары повторов завершились без исправления: модель повторяла
  конфликтующие аргументы после INVALID_ARGUMENT. Provider telemetry также
  фиксирует некорректные аргументы на границе ответа; потеря аргументов только
  адаптером не объясняет наблюдения. Следующий шаг — проверяемое улучшение
  описания/восстановления read без ослабления взаимоисключения anchor/offset.
  Все 12 разрешений использованы; новые реальные сессии требуют согласования.
  Diagnostic runner пока сохраняет results.json, но не формирует отдельный
  HTML/CSV/integrity report; full130 и holdout этим экспериментом не заменены.

- P3 follow-up: bare executable PATH resolution and project-root manifest/lock
  metadata changes now invalidate command fingerprints (RED→GREEN). Runtime
  generation checks prevent an old fingerprint result from revoking newly
  published capabilities; initial publication rechecks in-place config content.
  Latest targeted gate: 112 tests + typecheck/lint. Local warm guard microprobe
  (100 samples, one executable, current project root): median 1.315 ms,
  p95 1.975 ms, max 2.398 ms. This measures a single metadata guard, not a whole
  LSP request or end-to-end session; ancestor locks/transitive dependencies remain
  open and no overall time saving is inferred.

- P3 executable/launcher identity invalidation: verified command reports snapshot
  canonical paths, file identity/size/nanosecond timestamps, command/cwd/PATH and
  NODE_OPTIONS. Runtime checks revoke compact capability after launcher change;
  RED demonstrated obsolete host dispatch before fix. Separate RED found in-place
  config mutation during asynchronous fingerprint publication; status refresh now
  rejects it. Targeted 123 tests, typecheck/lint/build and controlled native
  extended+compact session smokes pass. Transitive dependency-only edits and
  real capable host integration remain open; metadata identity is not a full
  dependency-content digest or proof of end-to-end performance acceptance.

- Provider response telemetry: relay теперь восстанавливает fragmented SSE
  tool calls отдельно по choice/tool index и сохраняет только byte counts,
  SHA-256, JSON validity и read path/anchor-offset flags. Ограничения 2 MB/128
  calls; interrupted/malformed/overflow помечаются incomplete, non-SSE — null.
  Local HTTP integration выявила RED на корректном usage-only frame и прошла
  после исправления; privacy, fragmented calls, malformed/interrupt/bounds
  regressions проходят: runtime 45/45, typecheck/lint. Исторические payloads
  не восстановлены; причина compact quality regression остаётся открытой.

- Provider-boundary schema probe через native controlled smoke: required
  `filePath` и type string сохранены в фактическом provider request compact
  (проверки добавлены в smoke, запуск прошёл). Временная диагностическая
  проверка `additionalProperties === false` упала: в provider schema поле
  отсутствует, хотя локальный Zod JSON Schema содержит false. Это реальное
  host/provider schema transformation; требование false не является текущим
  provider contract, поэтому не оставлено как ложный smoke invariant.
  Сохранён regression на required path. Нет evidence, что эта трансформация
  породила пустые read args: required field остаётся обязательным, schema
  допускает дополнительные поля, но не отсутствие filePath.

- Локальная schema/policy проверка current plugin (оба profiles, `lsp:false`):
  read JSON schemas и descriptions идентичны; required содержит `filePath`,
  additionalProperties false, anchor/offset оба optional. System policy:
  extended 2556 bytes, compact 2168 bytes (JSON bytes не provider tokens).
  Следовательно, гипотеза «compact убрал required filePath из plugin read schema»
  опровергнута для current plugin. Проверка не сравнивает historical original
  schema и не доказывает host-transformed provider schema. Взаимоисключение
  anchor/offset выражено текстом и runtime guard, но не JSON Schema: это
  конкретный оставшийся источник неоднозначности, не установленная причина
  трёх functional failures. Нельзя приписывать регрессию только read schema
  без ablation policy/whole-tool-surface и provider-boundary evidence.

- Runtime boundary fix после v5: plugin `read` проверяет nonempty string
  `filePath` до permission/path handling и возвращает `INVALID_ARGUMENT` для
  missing/null/empty/numeric. RED→GREEN plugin regression; native controlled
  provider smoke явно проверяет `INVALID_ARGUMENT`, отсутствие TypeError/replaceAll
  и продолжение recovery после неверных args. Полный suite: 73 files,
  654 passed / 1 skipped; typecheck/lint прошли. Эта правка не доказывает
  quality non-inferiority и меняет source/dist, поэтому preparation v5 теперь
  исторический snapshot, непригодный для нового запуска без переподготовки.

- Controlled-provider native session reproduction выполнен локально:
  `node scripts/native-session-smoke.mjs --compact` прошёл с добавленными
  известными provider payload `read({})` и `read({filePath,anchor,offset:1})`.
  Host events сохраняют `{}` и error для первого, anchor/offset rejection для
  второго; после ошибок валидное anchor-чтение, native patch recovery и
  snapshot edit/batch продолжают работать. Это доказывает воспроизводимость
  ошибок при намеренно неверном payload, но не происхождение исторических
  пустых args и не причинность quality regression. Реальный provider не вызывался.

- Ограничение attribution v5 forensic evidence: `relay.ts` сохраняет usage,
  request hash/section sizes и response byte count, но не provider response
  tool-call arguments. Поэтому `{}` в host events нельзя считать доказательством
  исходного model payload или отличить от adapter argument loss задним числом.
  Installed host source `tool/registry.ts:125–154` строит Zod schema из plugin
  args, использует `safeParse` в `Schema.declare` и вызывает `def.execute`;
  это статическое наблюдение, не доказательство фактического runtime validation
  для проблемных вызовов. Требуется локальный controlled-provider reproduction
  с пустыми/валидными args и без ослабления guards. Исторические artifacts не
  дополняются вымышленными payload и не считаются полным protocol trace.

- Разбор attribution v5: optimized targeted repeat 0 содержит 5 tool errors,
  three-files repeat 0 — 8, repeat 1 — 7. В traces повторяются `read` с
  одновременно `anchor` и `offset: 1`, отклоняемые действующим контрактом;
  three-files также содержит три подряд `read` с `{}` и host exception
  `undefined is not an object (evaluating 'e.replaceAll')` в каждом повторе.
  Original three-files имеет 3 tool errors, но проходит grading: сам факт
  tool errors не доказывает причинность compact quality regression.
  Нельзя ослаблять anchor/offset guard ради этого результата. Следующая
  проверка — воспроизведение host argument/schema path для пустых read args
  и сопоставление фактического provider tool-call payload с host events.

- Attribution v5 выполнен после явного разрешения пользователя на 18 сессий.
  Артефакты: `C:/Users/demya/AppData/Local/Temp/opencode/patchline-attribution-pilot-v5/`
  (`results.json`, raw attempts, HTML, CSV, Markdown); preparation v5 независимо
  проверен до запуска, revalidation выполнена перед/после каждой сессии.
  Все 18 identities присутствуют без duplicates/unexpected. Stock: 5/6 success,
  369443.56 ms, tokens unknown (large-file repeat 0 timeout 180s). Original:
  6/6 success, 255088 tokens, 264362.27 ms. Optimized: 3/6 success,
  286815 tokens, 285626.41 ms. Integrity incomplete из-за unknown stock usage;
  все savings contrasts null, acceptance не установлен. Optimized failures:
  targeted repeat 0 boundary 1200 вместо 1000; three-files оба повтора не
  выполняют новую сигнатуру/второй вызов. Preservation у этих трёх failures
  сохранён. Нельзя принимать compact по этому пилоту или заменять unknown нулём.
  Дальнейшие provider sessions не разрешены этим завершённым лимитом 18.

- Attribution runner: добавлен отдельный `run-attribution` с фиксированным
  manifest, явным `--max-sessions 18`, canonical binary/plugin/profile каждого
  treatment, свежими home/workspace и проверкой manifest до/после сессии.
  CLI regression подтверждает отказ при изменении plugin до credentials/provider.
  Реальное выполнение 18 сессий и controlled-provider end-to-end ещё не доказаны.
  Текущие проверки: 73 test files, 653 passed / 1 skipped; build, typecheck,
  lint, doctor и isolated package smoke прошли. Doctor по-прежнему не подтверждает
  реальный LSP: TypeScript language server отсутствует, native flag disabled.

- Malformed preparation manifest roots now reject with the explicit invalid-design
  error rather than dereferencing null. RED null-root regression then GREEN;
  92 comparison/runtime tests, typecheck/lint passed. No execution was launched.

- Preparation revalidation helper now rejects changed model/schedule/design,
  corpus or host/plugin/distribution fingerprints; unchanged snapshots verify
  without granting execution authorization. RED missing helper then GREEN;
  92 comparison/runtime tests, typecheck/lint passed. This helper still needs
  connection to the future dispatch path and separate dependency provenance.

- Primary-runner artifact ambiguity fixed: attribution-only original/optimized
  plugin flags now reject outside `prepare-attribution` rather than being silently
  ignored by paid `run`. Two RED cases reproduced ignored selection, then GREEN;
  92 comparison/runtime tests, typecheck and lint passed. Reporting contract updated.

- Preparation CLI no longer silently ignores experiment-design overrides:
  explicit model/steps/timeout/session-cap/repeats/variant/profile/stage flags
  reject before normal parsing of those values. Eight RED regression cases
  then GREEN; 90 comparison/runtime tests, typecheck/lint passed. Fixed manifest
  parameters therefore cannot be mistaken for accepted user overrides.

- Preparation CLI now exercised end-to-end with deliberately non-executable host
  fixture files and a nonexistent credential-config path: succeeds without
  reading provider config or executing hosts; repeat invocation fails and preserves
  manifest bytes. Targeted integration test, typecheck and lint passed. The same
  `prepare-attribution` CLI created an actual enriched snapshot at
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-attribution-prepared-v2/attribution-manifest.json`
  using real host/plugin artifacts, full distribution trees, fixed design limits
  and corpus hash. This is still preparation-only, execution unauthorized.

- Full external dependency-content snapshots obtained separately from measured
  sessions using the strict tree fingerprinter. Original temporary installation:
  11,883 files, SHA-256
  `ab08aea0b388bf302821f4f52051cd73170d088b3a0c6d1bf4eb1b0e90c0afd2`,
  34,334 ms on the completed retry. Current workspace installation: 11,886 files,
  SHA-256 `f9a044f037e20136e2cfd395ff5e20fa21ae09ef74f7cc7cef439153e5bcf511`,
  99,615 ms. An initial combined attempt exceeded 120 seconds; process inspection
  confirmed no matching node/tsx job remained before retrying. These costs must
  stay outside measured session durations. Different dependency hashes are an
  unresolved attribution confound until file-level differences are explained;
  snapshots alone do not prove matching runtime dependencies or isolation.
  Follow-up full file-level comparison reproduced both hashes and explained
  the difference: no original-only files; current-only files are Vitest's
  `.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json` and hidden
  native copies `@ast-grep/.napi-win32-x64-msvc-lnDwGlw3/ast-grep-napi.win32-x64-msvc.node`
  and `@node-rs/.xxhash-win32-x64-msvc-TsSDebOu/xxhash.win32-x64-msvc.node`.
  The sole changed common file is internal `node_modules/.package-lock.json`.
  All other common dependency files match exactly. Standard-path native binaries
  match across installations and their hidden copies: ast-grep SHA-256
  `30dee02c0fe28a91448054a2fcca341082f62129007b0e95af3f8182f1133482`,
  xxhash `455b6cc0171ed36dbcf8b87a17773bfd7495a5b3f0c599cf353a94401c210728`.
  Root lockfiles both match SHA-256
  `8c0a9025fd4dd6446b6a4829c8a4c7296809d2be7caa605cbac59154f141b323`.
  No dependency files were deleted/rewritten. This explains the observed content
  delta; dispatch-time provenance and actual module-resolution identity remain
  separate requirements rather than assuming raw tree hashes must be identical.
  Node 22 ESM-resolution probe anchored at each actual `dist/plugin.js` resolved
  `@opencode-ai/plugin`, `@ast-grep/napi`, `@node-rs/xxhash`, `diff`, and `zod`
  into that installation's own node_modules; entry bytes match between treatments
  for all five. The first CommonJS `createRequire.resolve` probe rejected the
  ESM-only plugin exports; it was not treated as runtime failure. The successful
  probe uses `--experimental-import-meta-resolve` and ESM import conditions.
  This is Node resolution evidence only, not proof of Bun/OpenCode conditional
  resolution or every transitive import/native loader decision.
  Separate Bun 1.4.2 probe now resolves the same five dependencies from each
  actual distribution directory to matching entry hashes. Native loading also
  succeeds in both installations: ast-grep parses a TypeScript declaration to
  root kind `program`; xxhash returns identical `9094790062208907191` for the
  fixed attribution probe string. This covers installed standalone Bun resolution
  and these native operations, not instrumentation of bundled host resolution.

- Fresh cumulative gate after attribution-preparation additions: build passed;
  73 test files passed, 631 tests passed/1 skipped, zero failures (632 total).
  Typecheck/lint passed in the preceding targeted gate. Independent temporary
  rebuild matched current dist exactly:
  source SHA-256 `648958ceb357d5b1481d03ca6b74ba010f509c9f87ee2bdf5f76a1cf337702f4`,
  current/rebuilt dist SHA-256
  `00bc36f3a72385d0a6b629feb09845af6ae97a6ef7d9365071e9b3ff1c0ae296`.
  Compact actual-host controlled-provider session smoke passed after the build.
  This establishes current local correctness/build provenance, not live savings
  or completion of the remaining attribution/platform/quality gates.

- Current preparation refreshed and independently verified through the CLI at
  Cumulative local verification after attribution provenance/reporting changes:
  73 test files passed, 650 tests passed and 1 skipped; build and doctor passed.
  Doctor still reports no TypeScript language server and disabled native LSP
  flag, so this is not evidence for the real-LSP acceptance gate. Release
  metadata check with explicit `v1.4.0` passed; dependency audit found no
  high/critical advisories. No release or performance acceptance is claimed.
  Additional current checks passed: extended plugin smoke (11 required tools),
  package smoke through npm (isolated tarball installation/public imports), and
  offline comparison benchmark check. Offline report:
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-offline-check-current/index.html`.
  These checks made no paid model requests and do not establish live savings.

- Previous preparation refreshed and independently verified through the CLI at
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-attribution-prepared-v4/attribution-manifest.json`.
  This newer snapshot includes complete adjacent installed dependency trees for
  both real plugins; separate CLI verification passed. A local regression also
  confirms that appearance of a previously absent dependency installation
  invalidates preparation. No provider sessions were launched. The v3 snapshot
  below predates dependency-tree coverage and subsequent harness changes.

- Earlier preparation refreshed and independently verified through the CLI at
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-attribution-prepared-v3/attribution-manifest.json`.
  It pins the comparison harness, current source tree and root lockfile as well
  as real host/plugin/distribution artifacts. `verify-attribution` passed against
  the actual paths without provider requests. Historical v1/v2 artifacts remain
  unchanged. Latest cumulative suite: 73 files, 648 passed, 1 skipped; build
  passed before this refresh. Installed dependency provenance and actual
  three-treatment provider execution remain open.

- Proposed attribution pilot (preparation only; no paid execution authorized):
  three treatments S=stock, O=original Patchline extended, C=current optimized
  Patchline compact; tasks `targeted`, `large-file`, `three-files`; two repeats
  each, 18 measured sessions total. For each task use S/O/C on repeat 1 and
  C/O/S on repeat 2. Repeat 1 task order: targeted, large-file, three-files;
  repeat 2: three-files, large-file, targeted. All sessions
  use fresh homes/workspaces/processes, model `omniroute/vilao/gpt-6.1-sol`,
  temperature 0, steps 8 and timeout 180 seconds. Provider cache is observed
  through usage counters, not labelled controlled cold/warm. This small pilot
  cannot establish confidence intervals, non-inferiority, or full acceptance.
  Historical compact pilot mean was 24,394 tokens/session and 32.7 seconds;
  historical original pilot mean was 34,623 tokens/session and 55.7 seconds.
  Planning envelope: 0.44–0.63 million measured tokens, roughly 10–17 minutes
  measured runtime; timeout ceiling 54 minutes plus setup/grading. These are
   historical estimates, not token caps or guarantees. User clarification on
   2026-10-17: estimate tokens only, not monetary cost; tariff/currency approval
   is therefore no longer a preparation prerequisite. This clarification does
   not itself specify a hard token cap or authorize an unbounded experiment.
   Retry overhead must remain visible in measured token usage.
   Latest cumulative local verification: `npx vitest run --maxWorkers=2`
   passed 73 files, 646 tests with 1 skipped; `npm run build` passed. These
   results cover the current preparation additions, not live attribution
   execution or performance acceptance.
   Required preflight: identify immutable original source/package and hash;
  hash both host binaries, each plugin artifact, harness/corpus/lockfile and
  source state; persist the complete schedule and approval before first API
  request. Existing runner only supports stock/current plugin, uses current
  `dist/plugin.js`, and `--variant` is a model variant, so it cannot yet execute
  this three-treatment schedule faithfully. A separate explicit treatment
  selection/schedule implementation and offline regression are required.
  Schedule preparation now has an executable `attributionSchedule()` helper
  with separate treatment IDs, 18 unique entries and reversed task/treatment
  order on repeat 2. Regression observed RED (missing function), then GREEN;
  all 40 comparison tests, typecheck and lint passed. This helper does not
  launch sessions or change the existing paired runner; artifact selection,
  immutable manifest persistence and three-treatment execution remain open.
  Explicit artifact mapping is now represented by `attributionTreatments()`:
  nonempty host/plugin paths are mandatory, normalized identical original/current
  plugin paths are rejected (case-insensitive on Windows), stock has no plugin,
  and both Patchline treatments share the integrated binary with extended/compact
  profiles respectively. RED missing-function regression then GREEN; 41 comparison
  tests, typecheck and lint passed. This is path-level mapping only: realpath,
  artifact hashes and immutable pre-request persistence are still required.
  Artifact preflight helper `fingerprintAttributionArtifacts()` now resolves
  realpaths, requires regular files, records byte lengths/SHA-256 and rejects
  original/optimized plugins with identical bytes even at distinct paths.
  Missing-function regression observed RED, then GREEN; 77 comparison/runtime
  tests, typecheck and lint passed. This hashes entry artifacts only, not their
  transitive module trees; manifest persistence, dependency-tree provenance and
  before-dispatch stale revalidation remain required before paid execution.
  `saveAttributionManifest()` now re-fingerprints entry artifacts against the
  caller's expected snapshot before exclusive (`wx`) persistence, records all
  18 scheduled entries and explicitly marks `executionAuthorized: false`.
  Regression verifies existing manifests remain byte-identical on retry and
  changed artifacts produce no new manifest. RED then GREEN; 77 comparison/runtime
  tests, typecheck and lint passed. This is a preparation manifest, not a complete
  execution approval/provenance record; no API dispatch is attached to it.
  Actual preparation manifest created exclusively at
  `C:/Users/demya/AppData/Local/Temp/opencode/patchline-attribution-preparation-2026-10-17.json`,
  SHA-256 `d86e263f860cf12ad08adfe4566c6c4c3ca18cf2674d926cd5cbb5d1308f1565`.
  It contains the real three-treatment artifact snapshots and 18-entry schedule;
  optimized plugin SHA-256 is
  `9ae49017b45adec2f1708488d892f63a08b7557537db59ceb9517637c9a7519b`.
  Separate full distribution-tree snapshots (200 files each): original
  `fc4a1235f8f7c5e1efcc7c97d7e5fa3fbfa4b86400b3bce887e988eca71eb1cf`,
  optimized `00bc36f3a72385d0a6b629feb09845af6ae97a6ef7d9365071e9b3ff1c0ae296`.
  Comparison harness tree (10 files):
  `bf1a85bd9c1c251ee67098eb17d720903bc1225d6d45364e5f5593cfaabd9e79`.
  These snapshots are preparation evidence, not permanent identities after later
  builds/edits. Node_modules dependency contents are not covered by dist hashes.
  Preparation manifest generation now also pins the proposed model, temperature,
  session/step/timeout limits, explicit uncontrolled-provider-cache classification
  and SHA-256 of the complete current corpus (prompts, fixtures and checks).
  Regression failed for missing fields, then passed; 77 comparison/runtime tests,
  typecheck and lint passed. The earlier persisted manifest is preserved as a
  historical preparation snapshot and does not retroactively contain these fields.
  Attribution artifact snapshots now include the entire canonical plugin parent
  directory via the strict tree fingerprinter, covering emitted sibling modules
  rather than only `plugin.js`. A changed/added sibling rejects stale manifest
  persistence with no output file. RED missing distribution hash then GREEN;
  77 comparison/runtime tests, typecheck and lint passed. Keep preparation output
  outside the measured distribution directory. External node_modules remain
  outside this distribution snapshot and require separate provenance.
  Preparation output boundary is now enforced: canonicalize the output parent
  and reject a manifest path inside either measured plugin directory, preventing
  the write from invalidating its own captured tree. RED demonstrated successful
  self-contaminating persistence; GREEN rejects before output creation.
  78 comparison/runtime tests, typecheck and lint passed.
  Separate attribution run-integrity validation now checks the exact 18-session
  design without coercing original/optimized into the same `patchline` identity.
  Missing/extra/duplicate identities, incomplete grading, nonpositive/nonfinite
  duration or unavailable/nonpositive token measurement reject completeness.
  RED missing validator then GREEN; 79 comparison/runtime tests, typecheck and
  lint passed. Existing two-mode primary-study validation is unchanged.
  Three-treatment descriptive summary now reports sessions/successes and total
  tokens/time per treatment, retaining failed-session costs. Savings comparisons
  are unavailable unless all 18 identities/measurements/grading are complete;
  acceptance is always explicitly `not-established-pilot`. Regression verifies
  failed original sessions remain in totals and incomplete input suppresses
  savings. RED then GREEN; 80 comparison/runtime tests, typecheck/lint passed.
  Original-source candidate verified from Git on 2026-10-17:
  `fc46a873bf7679577312e1b0bf4819ce22b4673d` (current committed release
  baseline; optimization work remains uncommitted). Git blob identities:
  `src/plugin.ts` = `543f9f8983c5762316bf27384f3568f8a5e71746`,
  `package-lock.json` = `a22edba3c31d35d598ab5f285829d06e84a09617`,
  `src/config.ts` = `aeeda32e33ce5334efe02e334b7b90ab0c3ccbb1`.
  These are Git object IDs, not SHA-256 artifact hashes. Committed sources
  have no `toolProfile`/`readAnchor` matches in config/plugin/read-service;
  no committed `dist/plugin.js` exists. Build the baseline in an isolated
  temporary export, preserve the active worktree, then verify its actual
  extended schema and runtime before approving it as treatment O. Historical
  pilot provenance must still be compared before calling this the identical
  historical baseline; the commit alone does not establish that identity.
  Baseline export/build completed in the preapproved temporary directory
  `patchline-original-fc46a873`: `npm ci --ignore-scripts --no-audit --no-fund`,
  then explicit `npm run build` succeeded. `node scripts/plugin-smoke.mjs`
  passed with 11 Patchline tools registered. Built `dist/plugin.js` is 58,242
  bytes, SHA-256
  `0d516462ff594b9db0ff0dd45d28ad402774067d8572b40fdf718b48b0903616`.
  Exported lockfile Git blob still matches the committed object above;
  SHA-256 is
  `8c0a9025fd4dd6446b6a4829c8a4c7296809d2be7caa605cbac59154f141b323`.
  This verifies an isolated source build and plugin-registration smoke only,
  not actual provider schemas, historical identity, or live task quality.
  Additional baseline gates: `npm run typecheck` passed;
  `node scripts/native-session-smoke.mjs` passed against the actual host with
  a local controlled provider (native tool loop, multi-file mismatch zero-write,
  fresh read, recovery and event counter). This is not paid model evaluation.
  Host executable fingerprints captured for pilot preflight (SHA-256): stock
  `bb731f311416df16691fa16763eb87657c4a5f5f3bcff5202718c416e8f7ab1a`
  (180,714,888 bytes), integrated
  `408ea55d07b2c1313daa3e08439c55a58fe001731db30d5f282822ebef410885`
  (138,115,584 bytes). Recheck these immediately before any approved run;
  differing hosts are part of the stock-versus-integrated intervention, while
  original-versus-optimized must use the same integrated executable.
  Keep this attribution series separate from the 130-session primary study;
  never pool historical grader revisions. Approval must specify 18 sessions,
  runtime limit, monetary limit/currency and the applicable provider tariffs.

- Cumulative current-state gate after configuration invalidation changes:
  JSON report success:true, 628 passed/1 skipped, 0 failed. Typecheck/lint/build
  and compact controlled-provider host-session smoke passed. Header status now
  reflects implemented P0–P4 work without claiming full acceptance. Paid experiments
  remain subject to the explicit approval requirement in phase B.

- P3 status content guard: RED in-place edit during refresh returned successful
  empty projects instead of changed-configuration recovery. Refresh now compares
  captured JSON content before publishing/returning; GREEN regression, 104
  manager/plugin tests +typecheck/lint passed. Contract updated.

- P3 runtime configuration-content invalidation: RED in-place disabled edit still
  returned SDK symbols. Runtime guards now compare cached JSON configuration
  content, clear reports/compact exposure and advance generation before dispatch.
  Setup and successful status refresh establish the baseline. 103 manager/plugin
  tests +typecheck/lint passed before final status-baseline synchronization;
  executable/dependency fingerprint invalidation is still open.

- P5 package metadata/current tarball check: `check:release -- v1.4.0` passed
  package-version/changelog consistency (not a release or tag creation). Bare
  invocation correctly required an explicit tag. Fresh `smoke:package` rebuilt
  current dist and passed isolated tarball installation/public imports. This
  metadata script does not inspect docs/host contracts or prove release readiness.

- P5 native host source gate: explicit existing checkout
  `patchline-host-source-1.19.0-1.4.0-2a510acdc62a`, exact HEAD tag v1.19.0,
  `native-host-smoke.mjs` passed 28 tests/67 assertions (Bun 1.4.2, Windows).
  Initial invocation without OPENCODE_PATCHLINE_HOST_SOURCE correctly refused;
  configured rerun exit0. `npm run audit:dependencies` also passed, no high/critical
  advisories. This verifies that checkout's native apply_patch tests, not Linux
  coverage, independent OS isolation or full live-model performance acceptance.

- P3 configuration continuation verification: full current-production suite
  624 passed/1 skipped, success:true, typecheck/lint/build/compact host smoke passed.
  Added runtime-discovery and installer-return configuration-change coverage;
  installer probe marker remains absent (ENOENT), proving no command launch.
  102 manager/plugin tests passed, then strengthened marker assertion passed with
  all 17 manager tests +typecheck/lint. No toolchain fingerprint acceptance claimed.

- P3 preparation config continuation: RED discovery disabling LSP still invoked
  managed install and returned configured/unverified. Configuration-content checks
  after discovery/runtime/installer boundaries now stop subsequent work and discard
  obsolete reports. GREEN installations0; 100 manager/plugin tests +typecheck/lint
  passed. Before this latest fix full JSON suite was 623 passed/1 skipped,
  typecheck/lint/build and compact host smoke passed; not attributed to newer code.

- P3 in-place configuration publication: RED same-object disabled edit still
  returned stale missing report. Publication now compares original JSON content
  as well as identity, discarding reports on in-place configuration changes.
  99 manager/plugin tests, typecheck/lint passed. This covers configuration
  publication, not automatic executable/dependency fingerprint invalidation.

- P3 setup publication race: RED configureProjectLsp overwrote concurrent lsp:false
  with {} after discovery. Publication now checks original lsp identity/value and
  cancellation after preparation, returning no stale reports when replaced.
  GREEN regression and 98 manager/plugin tests, typecheck/lint passed. In-place
  object mutation fingerprinting is not claimed by this identity guard.

- P3 SDK in-flight generation coverage: success и unavailable SDK outcomes после
  отключения конфигурации оба отклоняются, CLI fallback calls0. 130 targeted
  plugin/search tests +typecheck/lint прошли. Cumulative JSON evidence затем:
  621 passed/1 skipped, 0 failed, success:true; build, compact native-session smoke
  и offline comparison check прошли. Полный performance acceptance не заявляется.

- P3 permission/config race: RED diagnostics dispatch completed after permission
  callback disabled LSP. Runtime operations now capture generation before awaits,
  recheck cancellation/generation before dispatch/fallback/output. GREEN regression
  proves bridge calls0; 128 plugin/search tests, typecheck/lint прошли.
  Контракт обновлён; это configuration guard, не toolchain fingerprint cache.

- P3 cumulative boundary verification: successful SDK→CLI fallback и
  DIAGNOSTICS_UNAVAILABLE не отзывают verified compact capability (оба повторных
  вызова действительно доходят до wrappers); final CAPABILITY_UNAVAILABLE
  по-прежнему блокирует повтор. Full JSON reporter evidence:
  `.vitest/json/output.json`, success:true, 618 passed/1 skipped, 0 failed.
  Typecheck/lint/build, compact plugin smoke (8 tools) и compact controlled-provider
  native-session smoke прошли. Это текущая локальная регрессия, не live-model
  acceptance и не automatic toolchain fingerprint gate.

- P3 runtime negative-capability invalidation: RED final unavailable bridge
  оставлял compact LSP зарегистрированным. Теперь final CAPABILITY_UNAVAILABLE
  отзывает cached reports/tool только для canonical plugin worktree и текущей
  generation; captured handle отклоняет повтор без нового SDK/CLI вызова.
  SDK→CLI recovery при первом вызове сохранён. 125 plugin/search tests,
  typecheck/lint прошли до дополнительной post-realpath generation guard;
  automatic fingerprint invalidation по-прежнему отдельный открытый gate.

- P3 status-response generation guard: RED race returned configured/verified
  after lsp:false despite keeping tools disabled. Superseded refreshes now reject
  CAPABILITY_UNAVAILABLE before returning reports; a second regression covers
  overlapping same-root refreshes. Contract updated; full cache invalidation and
  live attribution remain separate gates. 136 targeted plugin/manager/search
  tests, typecheck и lint прошли; full suite предыдущего шага — 614/1, не
  приписывается этому последнему изменению.

- P3 explicit status refresh: regression RED показала startup configured/verified
  после исчезновения сервера. `patchline_lsp_status` теперь делает fresh preparation
  с install:false, очищает capabilities для canonical plugin root и публикует
  только текущую configuration/refresh generation; другой worktree не заменяет
  reports. Итог: 614 tests passed/1 skipped (73 files), typecheck/lint/build и
  compact native-session smoke прошли, включая status-refresh/disable race.
  Automatic toolchain fingerprint
  invalidation остаётся открытой; явный refresh не закрывает весь cache gate.

- Cumulative verification после P3 cancellation guards: 612 tests passed,
  1 skipped (73 files), typecheck/lint/build, compact controlled-provider
  native-session smoke и offline comparison check прошли. Дополнительные runtime
  discovery/managed-installer cancellation regressions подтверждают отсутствие
  missing-toolchain/configured success после abort. Это не full130/holdout,
  не capable Linux gate и не доказательство live token/time acceptance.
  Последовательно также прошли compact plugin smoke (8 required tools), extended
  native-session smoke и isolated tarball package smoke. Doctor exit0 явно
  сообщает отсутствие системного TypeScript LSP и disabled native flag; benchmark
  functionalSuccess=true, wholeFileRewrites/staleOverwrites=0; hardening/scalability
  exit0 (10k files p50 106.216ms/p95 134.341ms, peak RSS 131076096 bytes).
  Dependency audit: 0 vulnerabilities. Локальные timings этого прогона не являются
  сбалансированным before/after attribution и не подтверждают live speedup.

- P3 cancellation continuation: RED discovery returned undefined after abort,
  затем npm installer был вызван один раз. Post-await signal checks добавлены
  после executable/runtime/rustup discovery, rustup run и managed preparation;
  GREEN installation count0. 101 targeted health/manager/plugin tests,
  typecheck/lint прошли. Это исключает новую работу после уже наблюдаемого abort,
  не меняет обязательный handshake, install policy или timeout budgets.

- P3 preparation cancellation fix: RED existing-server probe возвращал configured/
  unverified report после abort. Inner probe fallbacks теперь rethrow cancellation
  через signal guard (existing, managed npm, rustup), outer guard прекращает
  preparation. Discovery-cancellation/no-install case также проверен. 100 targeted
  health/manager/plugin tests +typecheck/lint прошли. Contract обновлён; обычный
  unavailable probe по-прежнему допускает unverified report, timeout не ослаблен.

- P2 stale batch host-loop gate: после successful batch повтор с прежними
  snapshots и oldString, совпадающим уже с updated bytes, отклонён как stale/
  snapshot error. Проверены именно batch event sequence error→completed→error и
  final bytes обоих файлов `updated\n` (не `stale overwrite`). Compact/extended
  session smokes и lint прошли. Guards не менялись; coverage расширена на actual
  host→plugin invocation, без real-model/API spending.

- P2 compact batch host-loop gate: два anchor reads передают snapshots через
  actual provider history; первый patchline_edit_batch с missing exact во втором
  файле отклонён, оба файла byte-unchanged подтверждены до следующего request.
  Исправленный batch с теми же valid snapshots completed, оба final files
  `updated\n`. Проверены error/completed tool events; compact/extended session
  smoke и lint прошли. Это host transport/preflight/recovery evidence; fewer
  real-model turns или gain по latency из controlled script не выводятся.

- P1/P2 compact exact-edit end-to-end: controlled host session читает exact.txt
  через anchor, извлекает Snapshot из actual outgoing provider tool-result history
  и выполняет compact edit с этим snapshot; final bytes `updated\n`, edit event
  completed. Это проверяет не только schema, но read observation/session continuity/
  snapshot transport/write. Compact и extended smoke +lint прошли; никакого
  real-model reasoning или paid usage, production behavior не менялось.

- P1/P2 final schema/anchor integration: compact controlled host-loop теперь
  проверяет actual outgoing JSON schema: edit.snapshot required, oldString/
  newString present, hashlinePatch absent; read.anchor/limit present. Recovery
  использует реальный anchor read без offset через host tool execution. Compact
  и extended session smokes +lint прошли. Production logic не менялась; это
  serialization/execution characterization, не real-model turn reduction.

- P1/P2 controlled full host loop: `native-session-smoke.mjs --compact` добавлен
  к существующему scenario. На каждом actual request проверены unique tool names
  и отсутствие hidden compact tools; intentional multi-file context mismatch
  оставил оба файла unchanged, затем read + corrected native patch изменили оба
  файла. Compact и extended smoke прошли; extended event counter assertion
  сохранён, lint проходит. Controlled local provider, без внешних API/model
  reasoning; это integration/safety gate, не качество реальной модели.

- P1 actual provider-request surface: local mock OpenAI-compatible provider,
  installed stock vs integrated host, fixed OK response/no tool execution,
  lsp:false. First request stock10 tools/21599 tool JSON bytes/19694 system bytes;
  extended19/23793/22520; compact15/21901/22102. Native/plugin duplicate names
  отсутствуют после session selection. Compact hidden routers/summary/duplicate
  apply_patch отсутствуют; native apply_patch retained. Compact vs extended tools
  −1892 bytes (~7.95%), tool+system sections −2310 (~4.99%); compact vs stock
  total этих sections +2710 bytes. Это actual request shape integration evidence,
  не provider tokens/quality/time acceptance. Artifact:
  `benchmarks/reports/host-footprint-2026-10-17/provider-request.json`.
  External API spending отсутствовал; temporary processes/homes removed.

- P1 host-registry footprint probe: isolated stock/extended/compact processes,
  `lsp:false`, experimental/tool selector openai/gpt-4.1 (no model requests).
  Stock12 entries/22977 JSON bytes; extended24/29580; compact20/27820. Compact
  registry на1760 bytes меньше extended (~5.95%), но больше stock. Registry
  содержит duplicate read/edit/write (native+plugin); session selection применяется
  позднее, поэтому это не final tool surface/token acceptance evidence. Raw counts/
  IDs сохранены в `benchmarks/reports/host-footprint-2026-10-17/results.json`.
  Нужно проверить actual selection/provider schema, не считать registry дубль
  автоматически модельным дублем. Temporary servers terminated/homes removed.

- Local validation refresh после SDK shape fix: doctor exit0 (host/SDK/AST,
  CRLF/BOM и stale/write self-test OK; system TS server отсутствует, native LSP
  flag disabled); dependency audit no high/critical; package smoke прошёл.
  Benchmark smoke functionalSuccess=true, wholeFileRewrites=0, staleOverwrites=0,
  46.14ms; repeated reads p50=2.38ms/p95=2.46ms. Hardening/scalability scripts
  exit0; 10k-file scalability p50=136.5571ms/p95=162.8368ms, peakRSS=131104768.
  Эти concurrent local runs — smoke/current-state observations, не balanced
  attribution и не evidence достижения live time/token targets.

- P3 SDK result-shape integrity: 6 RED cases (undefined TypeError; null/object/
  invalid data/string давали success)→GREEN. Wrapper принимает direct array или
  envelope.data array, malformed ответы дают DIAGNOSTICS_UNAVAILABLE и fallback;
  genuine empty arrays valid. 150 targeted tests/typecheck/lint прошли. Contract
  output budget уточнён по current code: 200000 chars, без runtime limit change.

- Cumulative status-guard verification: 73 files, 601 tests passed/1 skipped;
  typecheck/lint/build и compact host smoke (8 tools) прошли последовательно.
  Дополнительный cancellation test подтверждает: abort во время status отклоняет
  wrapper, поздний connected response не запускает symbols. Underlying status
  request остаётся non-cancellable из-за текущей SDK signature; это явно описано
  в LSP contract. Full host symbols/paid quality gates остаются открытыми.

- P3 active SDK status guard: два RED cases (cold status выдавал success [],
  status вообще не запрашивался)→GREEN. При доступном `lsp.status` symbols теперь
  требует connected client в requested directory; empty/disconnected даёт
  capability-unavailable с fallback, malformed/error status unavailable. Connected
  empty search остаётся valid, SDK без status сохраняет compatibility path.
  Shared deadline охватывает status+symbols; stalled-status regression проверен.
  143 targeted tests +typecheck/lint прошли. Это предотвращает cold useless call,
  но не исправляет unconditional HTTP stub при connected client; P3 host gate открыт.

- P3 active-server cold-symbol gate: isolated installed host with real
  `typescript-language-server@5.0.1`, custom `.ts` configuration and retained
  `gateExample` fixture returned HTTP200 `/lsp`=[] then `/find/symbol` data=[].
  `runOpenCodeLspClient` faithfully returned `{"data":[]}`. Follow-up inspection
  обнаружила более прямую причину: installed host HTTP handler
  `server/routes/instance/httpapi/handlers/file.ts` `findSymbol` (lines62–64)
  безусловно возвращает `[]`, не вызывает LSP вообще. Отдельно internal
  workspaceSymbol использует `runAll` existing clients, но это не доказывает
  причину HTTP result. Verified provider capability не доказывает работоспособность
  SDK endpoint. Empty matches сами по себе не ошибка; различать их по содержимому
  ответа невозможно. Model/API
  spending отсутствовали; isolated server tree завершён, temporary home удалён.

- P3 controlled warm protocol gate: тот же real TS server после initialize +
  initialized + didOpen вернул `gateExample` и через documentSymbol, и через
  workspace/symbol (kind12, main.ts lines0–2). Это подтверждает server capability
  и корректность fixture, локализует пробел в host integration; не доказывает
  active SDK/CLI symbols. Отдельный server tree завершён. HTTP stub требует
  host-adapter решения и regression до заявления P3 symbols-ready.

- Remaining-gates audit (§§5–13): общая зелёная регрессия не закрывает P0
  independent execution-isolation check (§5.2), P1 full host footprint integration,
  P2 model-turn/total-cost acceptance (§7.4), P3 toolchain/config invalidation и
  active-session symbols end-to-end (§8), P4 balanced before/after cold/warm
  attribution (§9). Capable Linux/Windows matrix (§10), original-vs-optimized
  attribution, заранее отделённый holdout и full130 (§11), quality non-inferiority
  margin/sample size и positive lower confidence bound (§12) остаются открыты.
  Следующий локальный gate: P3 cache invalidation/active-session integration;
  новые paid runs требуют отдельного согласования (§11), текущие измерения его
  не заменяют. Финальный release-gate set пока не заявляется пройденным.

- Cumulative verification после health/AST changes: 73 files, 594 tests passed,
  1 skipped (`vitest --maxWorkers=2`); typecheck/lint/build, isolated package
  smoke и offline comparison check проходят. Compact host smoke при параллельном
  package rebuild сначала зарегистрировал только native tools и истёк по timeout;
  отдельный повтор после окончания build прошёл (8 required tools). Причина первого
  сбоя не доказана; это не свидетельство стабильности concurrent build/startup.

- P4 AST first-use measurement: сохранены 5 fresh-process samples ×6 searches в
  `benchmarks/reports/ast-lazy-2026-10-17/results.json`. Во всех процессах native
  parser отсутствовал после module import и присутствовал после поиска; все 30
  вызовов нашли ровно один node. Import 18.69–21.29ms, первый поиск 15.79–17.85ms,
  последующие 1.96–3.84ms. Это current-dist probe с uncontrolled OS caches,
  без before baseline; live speedup/provider tokens им не подтверждены.

- P4 AST lazy loading: `search/ast.ts` static native parser import загружался
  вместе с plugin. Subprocess RED states [true,true,true] (import/invalid/valid
  request)→GREEN [false,false,true]; parser теперь deferred после path/language/
  bounded read checks, cancellation до/после import. 108 search/plugin tests,
  typecheck/lint/build проходят. Первая AST operation платит initialization;
  live time/token выигрыш этим тестом не измерен.

- P3 initialize result shape: health принимал malformed capabilities (missing,
  null, array, string, result=true) как verified. Пять RED→GREEN cases; теперь
  требуется non-null non-array object, valid {} не invents providers. 98 targeted
  tests, typecheck/lint проходят. Это handshake integrity, не full runtime gate.

- P3 probe resource budget: раньше bounded timeout не ограничивал accumulated
  stdout/Content-Length. Три RED cases (oversized header/body/unsafe integer)
  давали только timeout; теперь header≤8KiB, total stdout≤1MiB, invalid length
  fail-fast, error tail≤4000 chars. Дополнительно проверен flood valid notifications.
  91 targeted tests +9 health tests, typecheck/lint проходят. Runtime host LSP
  limits не менялись; project guards не ослаблены.

- P3 UTF-8 probe framing: health сравнивал Content-Length bytes, но извлекал
  body через string character offsets. RED fixture с Unicode notification и
  разделением UTF-8 codepoint между chunks вернул invalid JSON вместо initialize.
  Input теперь Buffer; frame boundaries считаются в bytes, JSON декодируется
  только после полного frame. 93 targeted tests, typecheck/lint проходят.

- P3 project-scoped handshake: health initialize раньше посылал rootUri=null и
  фиктивный file:///workspace, несмотря на project cwd. RED server-fixture
  отклонил wrong project root; теперь rootUri/workspaceFolders содержат actual
  project URI через pathToFileURL. 92 targeted tests, typecheck/lint проходят.
  Это исправляет scope capability evidence, не доказывает indexing/host symbols.

- P3 Windows capable CLI diagnostics: изолированный temp TS fixture с реальным
  typescript-language-server 5.0.1/TypeScript 5.9.3 через installed OpenCode
  1.19.0+patchline.1.4.0 вернул ожидаемый severity=1 code=2322 (number→string),
  ~2457ms. Document symbols вернул [] (~1449ms), bridge корректно сообщил
  CAPABILITY_UNAVAILABLE. Installed host debug/lsp.ts подтверждает: diagnostics
  вызывает touchFile(full), document-symbols только documentSymbol(uri), без
  открытия документа. Это подтверждает доступность diagnostics, но не symbols
  end-to-end/active-session SDK gate. Model/API calls не выполнялись, глобальная
  конфигурация не менялась; temp fixture сохранён для повторения.

- P3 real-server probe обнаружил process leak: health возвращал verified после
  initialize, но оставлял сервер живым (Node command завис до 25s timeout).
  RED regression проверяет PID живого fixture server; cleanup теперь завершает
  tree до resolve/reject на всех finish paths. 13 targeted tests, typecheck/lint
  проходят. Внешний временный typescript-language-server 5.0.1 + TypeScript 5.9.3
  после fix подтвердил document/workspace symbols и штатно завершил команду
  (~319ms probe). Это initialize evidence, не end-to-end symbols/diagnostics gate;
  зависимости установлены только в approved temp, project lockfile не менялся.

- P0 full-stage minimum repetitions: CLI позволял маркировать `--stage full`
  при `--repeats 1..4`, вопреки пяти повторам плана. Четыре RED→GREEN cases;
  live full теперь требует 5 repeats до запуска sessions, pilot остаётся 1..5.
  74 comparison/runtime tests, typecheck/lint проходят. Это preflight gate,
  не доказательство фактического выполнения 130-session series/holdout.

- P0 projection HTML audit: прежний fix session count покрывал Markdown,
  но автономный HTML сохранял literal «120 СЕССИЙ». Расширенный regression
  воспроизвёл ошибку; HTML теперь использует declared positive safe-integer
  `analysis.fullProjection.sessions` (иначе «—»), не вставляя произвольный input
  в script/markup. 65 comparison/runtime tests, typecheck/lint и offline check
  проходят. Исторические paid reports не переписаны.

- P1 installer lifecycle проверен для compact tuple: upgrade pinned registration
  и dedup сохраняют `{toolProfile:"compact", ...}`; uninstall удаляет Patchline,
  сохраняя соседний plugin. Production installer менять не потребовалось, это
  characterization test существующего пути, не RED→GREEN behavior fix.
  P3 regression дополнительно проверяет восстановление после failed install:
  следующий preparation получает configured commands для трёх roots, но не
  выставляет verified без handshake. Full suite 571 passed/1 skipped; после
  исправления названий installer test options — 20 targeted tests, typecheck,
  lint, build, compact host smoke (8 required tools), offline comparison check,
  doctor и dependency audit проходят. Package smoke прошёл через npm script
  (прямой node запуск требует отсутствовавший npm_execpath). Capable LSP gate
  по-прежнему открыт: doctor не нашёл TypeScript server/native LSP flag.

- P3 scoped negative installation cache: failed managed npm install раньше
  повторялся для каждого project root одного recipe. Regression на три TS roots
  воспроизвёл три attempts вместо одного; preparation теперь сохраняет promise
  установки (success/failure) только внутри одного вызова. Следующий вызов retries,
  initialize verification остаётся per root. 88 targeted tests, typecheck/lint
  проходят. Persistent toolchain-fingerprint cache и capable end-to-end LSP gates
  остаются открытыми; live latency выигрыш не измерен.

- P0 manifest pair coverage: одиночный stock/patchline manifest раньше мог быть
  complete=true при полном совпадении объявленных и измеренных sessions. Два RED→GREEN
  tests; теперь каждый task/repeat требует обе modes, `integrity.unpaired` сообщает
  отсутствующие пары и блокирует complete. 65 comparison/runtime tests, full suite
  569 passed/1 skipped, typecheck/lint проходят. Это не заменяет full sample size gate.

- P0 manifest identity integrity: self-consistent invalid taskId/repeat/mode
  раньше мог дать complete=true. Четыре RED→GREEN regressions; validator теперь
  требует nonempty task ID, nonnegative safe-integer repeat, stock/patchline mode,
  пишет `invalidIdentities` и fail-closed complete. 63 comparison/runtime tests,
  typecheck/lint проходят. Это не доказательство adequate sample size/баланса.

- P3 disabled LSP config fast path: hook раньше скрывал tools, но затем всё равно
  вызывал configureProjectLsp→detectLspProjects. Теперь explicit `lsp:false`
  возвращается до scan/probes/install после очистки reports/tools; generation
  invalidation сохраняется. Regression RED для обоих профилей→GREEN, 76 plugin
  tests; full 563 passed/1 skipped, typecheck/lint/build/compact host smoke и
  offline comparison check проходят. Включённый LSP не объявляется verified без
  прежней preparation; end-to-end capable LSP gate остаётся открытым.

- P0 offline provenance: `check` теперь записывает corpus SHA256 и actual
  source/harness tree fingerprints (включая untracked), как live run.
  Subprocess regression сначала воспроизвёл missing corpus hash, затем GREEN;
  59 comparison/runtime tests, typecheck/lint/offline check проходят. Historical
  report regeneration не получает новые fingerprints задним числом; старые
  artifacts не переатрибутированы. Dist reproducibility остаётся отдельным gate.

- P4 CLI LSP manager также deferred до LSP branch после `--directory` validation.
  RED/GREEN показывает no initialization для config/invalid LSP args и вызов
  prepare для valid check. 10 CLI tests; full 560 passed/1 skipped,
  typecheck/lint/build/doctor/package smoke/offline check проходят. Новый
  exploratory seven-process import: [135,525;133,484;133,432;129,580;132,433;
  131,036;132,488]ms; sequential comparison имеет прежние ограничения и не
  подтверждает end-to-end model speedup.

- P4 CLI deferred imports: installer загружается после валидных install/uninstall
  args (не help), host-upgrade после validation; compatibility/doctor self-test
  только при inspect. Два RED/GREEN regression tests, 9 CLI tests; full suite
  559 passed/1 skipped, typecheck/lint/build/doctor/package smoke прошли.
  Exploratory Windows seven-process import measurements: initial
  [205,441;198,092;208,391;204,521;201,079;210,739;207,577]ms, после обоих lazy
  imports [167,004;155,841;155,170;165,892;153,001;149,622;146,763]ms.
  First in-process 145,108→91,733ms, cached imports ~0,009–0,05ms. Это sequential
  before/after, не balanced baseline replay, не OS-cold/реальная команда/provider
  latency evidence. Installer-only промежуточный замер выигрыша не показал.
  Hardening и scalability smoke также выполнены: 10k files p50 149,425ms,
  p95 178,998ms; guards unchanged, skipped OS gate по-прежнему открыт.

- P2 batch attribution replay добавлен в offline comparison check: одинаковые
  две observed files/edits, first pair отдельно, 20 warm pairs с balanced order,
  exact final bytes проверяются после каждого варианта; setup/read вне timing.
  Raw artifacts `benchmarks/reports/batch-replay-2026-10-17/`. Sequential p50
  10,634ms/p95 11,842ms, batch p50 10,656ms/p95 13,674ms: local latency gain
  не подтверждён, хотя mutation calls 2→1. Это не provider token/model evidence.
  RED отсутствие replay→GREEN; 29 comparison tests/typecheck/lint/offline check
  прошли. Stale/rollback guards не менялись, production batch logic неизменна.

- P2 compact mutation preview: `edit`/`patchline_edit_batch` включают уже
  рассчитанный display diff в model-facing output, только complete ≤2000 chars
  per file и aggregate≤19000. Иначе явное omission без обрезки hunk; при failed
  validation preview также omitted, причина сохраняет приоритет. Никакого
  повторного diff или расширения seenLines: integration test показывает, что
  context preview не даёт права менять непрочитанную строку. RED/GREEN для
  small/oversized preview, coverage truncated/aggregate и actual edit; 71 plugin
  tests/typecheck/lint/build прошли. После aggregate refinement полная suite
  553 passed/1 skipped, offline check и compact host smoke прошли; дополнительные
  characterization extended output/failed validation дают 74 plugin tests,
  typecheck/lint также проходят. Влияние на число reads
  и provider tokens ещё не измерено; прежний paid pilot предшествует изменению.

- P0 acceptance audit 2026-10-17: targeted revision 2 расширяет editable region
  с выражения до исходной строки return (включая indentation/newline), разрешая
  семантически корректный clamp statement перед return. Signature, braces,
  comment, соседняя label и другие файлы по-прежнему защищены. Regression сначала
  воспроизвёл preservation=false при functional=true, затем прошёл вместе с
  отрицательными проверками signature/comment/label. Старый pilot не переоценён;
  новый corpus fingerprint означает иной acceptance contract, см.
  `docs/benchmarks/benchmark-tasks.md`. Полная suite: 548 passed/1 skipped,
  73 files; typecheck/lint/build, offline comparison check, doctor, dependency
  audit, bench, package smoke и compact host smoke прошли. Doctor по-прежнему
  не подтверждает capable LSP. Новые платные серии не запускались.

- P5 повторный compact pilot 2026-10-17 выполнен с явным разрешением пользователя:
  3 tasks × 2 modes × 2 repeats = 12 sessions, steps8/timeout180s, прежняя модель.
  Добавлен проверенный `--repeats 1..5`, defaults pilot1/full5; session cap сохранён.
  Artifacts: `benchmarks/reports/comparison-compact-pilot-2026-10-17/`.
  Integrity complete. Stock 206813,981ms/168111tokens, success4/6; compact
  185592,156ms/124613tokens, success5/6. Aggregate savings time10,261%/tokens25,875%.
  Только both-successful4 pairs: time1,766%/tokens15,297%; CI unavailable.
  Все три FAIL относятся к targeted: behavioral checks pass, но дополнительный
  clamp перед return отклонён preservation editable-region. Это существенное
  ограничение grading; результаты не переоценивались и исходный corpus сохранён
  в provenance пилота. Acceptance revision 2 описана выше. Пилот не
  доказывает full targets/quality, исходный Patchline attribution отсутствует.

- P0 duplicate audit: предположение о double counting опровергнуто текущим
  `pairedSummary`: duplicate stock/patchline session уже throws до analysis.
  Добавлены два characterization tests без production change (27 comparison
  tests проходят). Свежие doctor/dependency audit/bench проходят; doctor явно
  сообщает disabled native LSP и отсутствие TypeScript server, поэтому это не
  capable LSP gate. Local read-edit smoke: success, 1 added/1 deleted,
  все пять repeated-read samples подтвердили index reuse.

- P5 reporting stage: full-series Markdown больше не содержит безусловную
  подпись «Пилот предназначен». Для full сохраняются ограничения по tasks/model/
  conditions и указание учитывать success/dispersion/CI; incomplete warning
  независим от стадии. RED/GREEN regression; 53 comparison/runtime tests и
  typecheck/lint проходят. Full experiment этим не выполнен.

- P0 manifest/report follow-up: missing/nonfinite/negative duration теперь
  делает серию incomplete с `invalidDurations`; четыре RED cases раньше
  считались complete. Markdown projection больше не подписывает 130-session
  forecast константой «120»: использует declared sessions. Оба дефекта
  воспроизведены regression tests до fix.

- P0 numeric integrity: statistical summary отклоняет NaN/Infinity/negative
  duration и tokens до pairing/CI/projection; unavailable tokens остаются null.
  RED: шесть invalid-input cases раньше принимались; GREEN: 21 comparison
  tests, typecheck/lint. Это input integrity, не подтверждение полноты серии.

- P4 stats-only diff: `diffStats` использует тот же bounded `diffLines`, но
  больше не строит ненужный seen-line mapping. `analyzeDiff` safety path не
  менялся. Characterization до refactor: newline/Unicode pairs, 100k локальная
  правка, edit-length budget; после refactor 13 targeted tests/typecheck/lint.
  Alternating replay (first + 20 warm pairs): 10k p50 4,308→3,453ms,
  p95 6,308→5,668; 100k p50 61,241→57,799ms, p95 77,932→75,650.
  100k p99 ухудшился 79,779→83,490ms: это локальные шумные данные без
  доказательства общего выигрыша или отсутствия tail regression. Raw pairs
  печатает `benchmarks/hardening.ts`; provider/IO/model сюда не входят.

- P2 routing policy: оба профиля теперь явно предлагают `read.anchor + limit`
  для известного уникального literal target, запрещают совместный offset и
  требуют разрешить ambiguity. Native patch выбирается по scope/representation/
  supported operations, а не только размеру файла. RED воспроизвёл старую
  policy в extended/compact; выигрыш модельных ходов требует live comparison.

- P4 measurement correction: local runner больше не записывает reuse индекса
  константой. `repeatedRead.samples` сохраняет реальные duration/reuse каждого
  чтения, aggregate выводится из samples. RED/GREEN subprocess regression
  проверяет отчёт настоящего runner; benchmark tests/typecheck/lint проходят.
  Это достоверность local smoke, не provider savings evidence.

- P3 disabled bridge: прямой `runOpenCodeLspBridge` теперь отклоняет `lsp:false`
  до executable discovery/path resolution/process spawn. RED получал ENOENT
  вместо disabled capability; GREEN: search+plugin 95 tests, typecheck/lint/build.
  Plugin-level guard сохранён; дополнительных диагностических процессов нет.

- P1/P3 project-scoped capability: compact `documentSymbol` проверяет canonical
  target относительно существующего canonical root с verified capability.
  Подтверждённый sibling project больше не разрешает CLI probe для чужого файла.
  RED воспроизвёл лишний bridge fallback; GREEN: 64 plugin tests, включая
  sibling-prefix rejection и разрешённый in-project маршрут, typecheck.
  Это initialize evidence, не end-to-end host/indexing gate.

- P3 actionable failure reason: post-edit validation теперь сохраняет command,
  exit code/timeout и explicit `(no output)` для молча упавших команд. RED
  воспроизвёл пустую причину во всех шести mutation paths; GREEN — 61 plugin
  tests, typecheck/lint. Это информативность результата, не suppression проверок.

- P2 bounded-output follow-up: batch/classic-create/Hashline summaries также
  помещают validation failure перед per-file output. RED с 25k summary
  воспроизвёл потерю причины при 20k truncation; GREEN подтверждает сохранение
  причины и truncation marker внутри лимита. 61 plugin tests, typecheck и
  lint проходят; это targeted evidence, не полный P2 completion.

- P2 failure visibility: adaptive exact/Hashline mutation outputs теперь
  включают причину post-edit validation failure перед per-file summary,
  чтобы output truncation не спрятал ошибку. RED воспроизвёл applied result
  с failed metadata, но без причины в model-facing text; GREEN проверяет
  write/classic/Hashline/batch/adaptive exact/adaptive Hashline paths.

- P1 compact exact-only edit: убрана `hashlinePatch` schema и упоминание
  второго протокола из description; прямой скрытый аргумент отклоняется до
  permissions/filesystem. Extended сохраняет Hashline. RED/GREEN и 58 plugin
  tests подтверждают schema/runtime gates. Plugin-only lsp:false JSON bytes:
  compact schemas 2990 (до этого 3054), extended 4838; policy 1867/2255.
  Это bytes, не provider tokens и не полный host tool footprint.

- P4 line index optimization включена: native `indexOf` вместо посимвольного
  JS-сканирования. До refactor добавлен characterization gate для 343
  комбинаций Unicode/newline/CRLF, точных UTF-16 offsets и line slicing;
  существующее поведение сохранено (это refactor, не новый public behavior).
  Paired harness сохраняет исходный character-loop baseline отдельно от
  production: 20 alternating warm pairs, complete index equality на каждом.
  Свежий Windows Node 22.22.2 replay: 10k p50 1,875→0,395 ms,
  p95 2,777→0,875 ms; 100k p50 24,076→3,053 ms, p95 28,865→5,164 ms.
  Это stage-local выигрыш, не −20% tokens/−10% live wall time; OS-cold/CLI
  overhead не измерен. 73 test files, 519 passed / 1 skipped,
  typecheck/lint/build проходят после production изменения.

- P4 component profiler расширен в `benchmarks/hardening.ts`: raw samples,
  process-local first/warm для decode/SHA256/line-index/safety diff/display
  diff на 10k/100k строках; каждый проход проверяет корректность результатов.
  Профиль выполнен на Windows Node 22.22.2; полный JSON печатается harness.
  Это fixed-order microprofile без disk/CLI/model и не release evidence.
  Отдельный alternating replay (20 warm pairs, полный equality gate плюс
  empty/newline/CRLF/Unicode cases) сравнил текущий line index с candidate
  на `indexOf`; raw pairs и p50/p95/p99 печатаются без удаления outliers.
  Исторический candidate replay предшествовал включению оптимизации выше;
  текущий harness сравнивает явный original baseline и production optimized.
  Данные указывают также на существенный повторный display diff; следующий
  шаг — независимая проверка безопасного reuse, без удаления safety analysis.

- P1/P3 config invalidation race: RED воспроизвёл восстановление compact LSP
  старой async preparation после нового `lsp:false`; generation guard теперь
  игнорирует устаревшие reports и schema updates. На время актуальной
  подготовки compact definition удаляется, чтобы registry не получил
  неподтверждённый набор операций. 57 plugin tests/typecheck/lint проходят.

- P1 operation-specific compact schemas: enum содержит только подтверждённые
  document/workspace symbol operations. LSP diagnostics не предлагается без
  evidence host diagnostic capability. Ранее сохранённая definition проверяет
  актуальные reports до paths/permissions/SDK/CLI: повторный config callback,
  потеря capability или смена поддерживаемой операции не обходят gate.
  RED воспроизвёл переход к path discovery после потери capability и лишние
  enum operations; GREEN покрывает удаление, восстановление и смену operation.

- P1 partial capability gate: compact после config callback предлагает LSP
  только при verified server report с document/workspace-symbol capability.
  На каждом callback старые reports очищаются; missing, false capabilities,
  preparation failure и lspAutoSetup:false скрывают tool; успешная повторная
  подготовка восстанавливает его. Extended сохраняет совместимость. Это не
  доказывает operation-specific bridge support/diagnostics и не закрывает
  invalidation при смене toolchain без config callback.
  Проверка: 56 plugin tests; full suite с `--maxWorkers=2` — 73 файла,
  517 passed / 1 skipped; typecheck/lint/build/compact host smoke проходят.
  Default-parallel full run дал два 5-second timeout в heavy filesystem
  fixtures (anchor replay и directory budget); targeted и ограниченный full
  повтор проходят без изменения timeout/guards. Причина contention остаётся
  гипотезой, default-parallel стабильность этим не доказана.

- P2 anchor ambiguity: ошибки возвращают не более восьми номеров строк и
  explicit truncation после девятого совпадения, без выдачи snapshot/seen lines.
  RED/GREEN проверяет bounded candidates и полный список для двух совпадений;
  дополнительные проверки покрывают overlap/same-line, ровно восемь/девять,
  отсутствие snapshot и отказ edit непрочитанных строк после ошибки anchor.
  Текущая проверка: 73 файла, 516 passed / 1 skipped; typecheck, lint, build и
  diff check проходят. Skip по-прежнему не засчитывается как safety evidence.

- P4 preliminary smoke (2026-10-17): существующий scalability harness на
  10 000 файлах, пять проходов: p50 144,86 ms, p95 189,51 ms, peak RSS
  131 342 336 bytes. Hardening smoke: hidden-whitespace tag для 20k/40k/80k
  пробелов p50 0,514/0,344/0,608 ms; queued cancellation p95 0,441 ms.
  Прогоны выполнялись параллельно с тестами: это только проверка harness и
  bounded поведения под нагрузкой, не изолированный performance baseline,
  не cold/warm attribution и не подтверждение P4 или live-экономии.

- P1 host gate: `npm run smoke:plugin -- --compact` проверяет настоящий
  OpenCode server registry с compact/lsp:false: семь plugin tools и native
  apply_patch присутствуют, скрытые routers/status/summary и LSP отсутствуют.
  Прогон на установленном OpenCode 1.19.0 прошёл; это registry gate без
  оплаченного model request, не доказательство provider schema savings.

- Контроль текущего дерева после anchor/diagnostics/measurement изменений:
  73 test files, 514 passed / 1 skipped; typecheck, lint, build, doctor,
  benchmark smoke, package smoke (isolated tarball install), plugin smoke и
  dependency audit выполнены успешно. Doctor явно сообщает unverified LSP
  (нет TypeScript server/experimental flag); это не capable LSP gate.
  Windows-only проверки и эти smoke не закрывают Linux/capability/live-quality
  gates и не являются заявлением о релизной готовности или экономии.

- P3: diagnostic runner возвращает explicit `timedOut` и краткую причину с
  deadline даже при усечённых логах; plugin metadata/заголовок различают timeout
  и обычный exit failure. RED/GREEN проверяет штатный результат и timeout
  с descendant pipe; abort по-прежнему rejects после process-tree cleanup.

- P0 5.5: relay сохраняет `messageSections` с disjoint UTF-8 JSON bytes
  system/developer, history user/assistant, tool results и unknown roles;
  содержимое сообщений не сохраняется. RED/GREEN loopback проверяет Unicode
  bytes и отсутствие текста/credentials в артефакте. Это bytes, не tokens;
  разделители массива учитываются только в полном `requestSections.messages`.

- P0 5.5: `events.toolTiming` сохраняет сумму длительностей, объединение
  интервалов без двойного счёта overlap и полный span с gaps. Отсутствующие/
  некорректные timestamps дают `null` и explicit completeness, не прежний ноль.
  RED/GREEN проверяет overlap, reversed interval и valid zero. Это не
  dependency critical path; внутренние операции/critical path ещё открыты.

- Фаза A: replay чтения усилен 20 парными warm измерениями с чередованием
  порядка (10 anchor-first и 10 grep-first), сохранением сырых пар и проверкой
  полного равенства output обеих страниц. Регрессия проверяет баланс и наличие
  equality gate. Новый артефакт `benchmarks/reports/anchor-paired-2026-10-16/`
  сохраняется отдельно от предыдущего последовательного replay.

- Фаза A/P2: offline `localChecks` теперь сохраняет `anchor-read-replay`:
  одинаковый пятистрочный диапазон в файле 10 000 строк, первый вызов и 20 warm
  повторов для grep→read и anchor. Артефакт
  `benchmarks/reports/anchor-replay-2026-10-16/results.json`: warm p50
  7,55 против 4,26 мс, два локальных вызова против одного, 623 против 419
  возвращённых символов. Это один последовательный локальный replay, без
  randomization/OS-cold контроля; не доказательство модельного качества или
  provider token savings. Схемы после anchor: extended 4838, compact 3054 bytes.

- P3: CLI LSP больше не превращает пустой diagnostics stdout с exit code 0
  в ложное `[]`. RED/GREEN регрессия требует `DIAGNOSTICS_UNAVAILABLE` и
  `validation: "unverified"`; явные пустые JSON `[]`/`{}` принимаются как прежде.
  Capability cache и остальная маршрутизация проверок остаются открытыми.

- P1: явный OpenCode `lsp: false` исключает `patchline_lsp` и
  `patchline_lsp_status` из tool map до регистрации. Проверен фактический порядок
  config hook → plugin.list → registry в установленном host 1.19.0; регрессия
  проверяет исключение и восстановление при повторном config callback.
  Дополнительная регрессия воспроизвела вызов SDK через ранее сохранённое
  определение после отключения LSP; runtime guard теперь отклоняет такие вызовы
  и status до permission/discovery/SDK/CLI, без повторной проверки capability.
  Полный capability-aware компактный профиль ещё не реализован.
- P1: добавлен opt-in `toolProfile: "compact"` с восемью plugin tools
  (семью при `lsp: false`), единственным точечным `edit` и пакетным
  `patchline_edit_batch`; дублирующие маршрутизаторы и служебные status/summary
  скрыты, policy согласована. `extended` сохраняет прежний default.
  Capability verification, host-интеграция, измерение schema bytes и live-качество
  остаются открытыми; число plugin tools не равно полному числу tools host.
- P1/P5: стенд принимает `--tool-profile extended|compact`, передаёт профиль
  плагину и фиксирует его в JSON отчёта; stock остаётся без плагина.
  Исправлен CLI bound: полная серия 130 сессий больше не отклоняется лимитом 120.
- P1: офлайн-отчёт сохраняет `toolProfiles`: для `lsp:false` extended имеет
  11 plugin tools / 4797 schema bytes / 2255 policy bytes, compact —
  7 / 3013 / 1867. Это локальные JSON/UTF-8 bytes, не токены провайдера и не
  полный набор host tools; фактическая экономия пока не доказана.

- P2: policy явно направляет известный точный путь сразу в узкое чтение без discovery;
  `read.anchor` теперь выбирает строку единственного буквального совпадения
  в LF-нормализованном тексте и возвращает обычный ограниченный snapshot-page.
  RED/GREEN проверяет отсутствие/неоднозначность/пустой якорь, конфликт offset,
  запрет directory и правки вне показанного диапазона; CRLF сохраняется при edit.
  Это текстовый якорь; symbol-aware и batch-read пока не реализованы.
  поиск предлагается только для неизвестного пути/цели, LSP — при доступности.
  Это изменение инструкции; фактическое сокращение вызовов ещё требует live-измерения.

- P0: исходные fixture-файлы отслеживаются Git; конфигурация Git изолирована.
- P0: измерения и отдельный артефакт попытки сохраняются до grading;
  исключение оценщика сохраняется как явная ошибка.
- P0: добавлены manifest и проверка полноты, отпечатки корпуса, lockfile,
  изменения отслеживаемых исходников и секций запросов.
- P0: добавлены ограничения чтения и процессов, проверка UTF-8, файлов после
  grading и защищённых областей; допустима альтернативная реализация внутри
  разрешённых областей без совпадения с эталоном.
- P0: модули корпуса загружаются через ограниченный VM-контекст отдельно от
  assertions; прямое вмешательство в `node:assert` воспроизведено и отклоняется.
- P0: перед live-запросами копия текущих исходников пересобирается во временном
  каталоге установленным toolchain; все имена и байты результата должны совпасть
  с измеряемым `dist`. Устаревшая сборка и лишние outputs отклоняются без изменения
  рабочего дерева. Реальная локальная пересборка дала совпадающие отпечатки.
- P0: в live-корпус добавлена задача грязного worktree: пользовательские изменения
  в целевом и постороннем файлах появляются после подготовки Git baseline;
  регрессия подтверждает реальный dirty diff и отклонение потери пользовательских байтов.
- P0: live runner сравнивает staged paths/modes/object IDs и flags до/после сессии;
  изменение или потеря Git index проваливает попытку независимо от функциональности.
  Обновление stat cache обычным Git status не считается изменением пользовательского index.
- P0 остаётся открытым: независимая изоляция исполнения и наблюдение эффектов,
  полная проверка всех критериев принятия. VM не является границей
  безопасности; воспроизводимость сборки не доказывает независимое доверие toolchain.
- P0: hidden checker запускается с Node `--permission`: чтение только собственного
  checker, без записи, child processes, workers и addons. CheckJs вынесен в отдельный
  read-only процесс с доступом к fixture и TypeScript. Регрессии подтверждают запрет
  записи внутри и за пределами workspace. Это дополнительный барьер, не OS sandbox;
  сеть Node 22 permission model не блокирует. Для оценщика нужен Node 22.13+.
- P0: после расширения корпуса прогноз полной серии вычисляется из текущего числа
  задач: 13 × 2 × 5 = 130 сессий. Устаревшая константа 120 удалена; регрессия
  подтверждает пересчёт времени/токенов и отсутствие прогноза без заданного размера.

Добавлены побайтовые отпечатки деревьев `src`, `dist`, стенда и версии
установленных зависимостей; регрессия грязного fixture проверяет действенность
`git diff --check` и сохранение предшествующих изменений.

Последняя целевая проверка: 38 тестов стенда, typecheck и lint прошли
после ограничения прав hidden checker. Офлайн-проверка 13 эталонов также прошла.
Платные сравнительные серии после начала оптимизаций не запускались.

## 1. Цель и правила принятия результата

Снизить относительно обычного OpenCode:

- полное время решения;
- общий расход токенов, включая кеш и reasoning;
- число обращений к модели;
- объём повторно передаваемого контекста;
- число лишних поисков, чтений и проверок;
- число ошибочных вызовов инструментов.

Сохранить или улучшить:

- функциональную корректность;
- сохранность постороннего кода и форматирования;
- защиту от устаревших снимков, подмены путей и потери внешних изменений;
- согласованность многофайловых изменений;
- достоверность диагностики.

### Ограничение цели «все показатели должны быть меньше»

Строгое уменьшение каждого показателя на каждой задаче невозможно гарантировать.
Например, у обычного OpenCode в пилоте ноль ошибок инструментов — получить меньше
нуля невозможно. Корректность и успешность должны оставаться высокими: правило
«меньше — лучше» относится к затратам и нарушениям, а не к показателям качества.

Критерий принятия:

1. Для показателей затрат с положительным исходным значением добиться измеримого
   снижения на заранее определённой представительной выборке.
2. Для нулевых ошибок и нарушений сохранности сохранить ноль.
3. Для качества исключить выявленную регрессию.
4. Отдельно показывать задачи, на которых выигрыш отсутствует.
5. Не принимать уменьшение затрат за счёт пропущенных обязательных проверок,
   неполного решения или ослабления защит.
6. Не менять baseline, корпус или критерии после получения результатов ради
   достижения желаемых чисел.

## 2. Исходные результаты

Источник: `benchmarks/reports/comparison-pilot-2026-10-16/results.json`.
Этот локальный артефакт исключён из Git правилами для генерируемых отчётов;
для передачи результатов сохранять весь каталог эксперимента отдельно.

Модель: `omniroute/vilao/gpt-6.1-sol`.

Сравнение: OpenCode `1.19.0` и полная интеграция Patchline `1.4.0`.
Вмешательство включает host tool selection и plugin precision, поэтому пилот
не изолирует эффект одного лишь серверного плагина.

| Показатель | OpenCode | Patchline | Разница |
|---|---:|---:|---:|
| Суммарное время | 139,27 с | 195,09 с | +40,1% |
| Все токены | 74 797 | 132 942 | +77,7% |
| Обращения к модели | 16 | 18 | +12,5% |
| Вызовы инструментов | 17 | 21 | +23,5% |
| Ошибки инструментов | 0 | 1 | +1 |
| Успешные задачи по текущему оценщику | 3/3 | 3/3 | одинаково |

Чтобы только достичь уровня OpenCode, текущему Patchline требуется уменьшить:

- время приблизительно на 28,6%;
- расход токенов приблизительно на 43,7%.

Это величины относительно текущего результата Patchline, а не прогноз эффекта.

### Ограничения исходных данных

Пилот содержит три задачи с одним повтором. Это диагностические данные, а не
доказательство общей эффективности или отсутствия регрессий качества.

Установлены недостатки стенда, которые необходимо устранить до использования
результатов как критерия выпуска. Токены провайдера совпали с событиями OpenCode,
но это не является независимым подтверждением корректности тарификации или
маршрутизации на стороне провайдера.

## 3. Подтверждённые причины накладных расходов

### 3.1. Избыточная поверхность инструментов

В пилоте модель получала 7 инструментов без Patchline и 19 с Patchline.
Одновременно доступны несколько способов изменения кода:

- `edit`;
- `patchline_execute`;
- `patchline_edit_batch`;
- `patchline_apply_patch`;
- обычный `apply_patch`.

Дополнительно постоянно предлагаются маршрутизация поиска, LSP, статус LSP,
отдельная диагностика и сводка.

Последствия: схемы передаются при каждом обращении, растёт пространство выбора,
модель должна разбираться в нескольких протоколах. Увеличение числа инструментов
подтверждено; точный причинный вклад каждой схемы ещё предстоит измерить.

Источники: `src/plugin.ts`, `providerCalls[].tools` в результатах пилота.

### 3.2. Политика провоцирует лишнее обнаружение файлов

Политика начинается с требования искать код перед чтением. Она не делает
достаточно ясного исключения для известного пути и точного идентификатора.

На большой задаче Patchline выполнил:

`glob → read первых 80 строк → grep → read нужного участка → edit → проверка → read`.

Первое чтение дало 4 228 байт контекста, не содержавшего нужную строку.
Наличие лишней работы подтверждено; связь с конкретной формулировкой политики
необходимо подтвердить отдельным экспериментом.

Источники: `src/plugin.ts` (`POLICY`),
`docs/rules/model-facing-policy.md`, прогон `large-file`.

### 3.3. Доступна неработающая в окружении LSP-операция

В тестовом окружении LSP отключён, но `patchline_lsp` присутствует среди
инструментов, а политика рекомендует LSP.

Модель вызвала диагностику и получила `CAPABILITY_UNAVAILABLE` с журналом запуска
OpenCode. Это создаёт бесполезный запуск процесса, ошибку и дополнительный контекст.

Источники: `src/plugin.ts`, `src/search/lsp.ts`,
`benchmarks/comparison/config.ts`, прогон `targeted`.

### 3.4. Результат правки недостаточно помогает завершить работу

Результат изменения сообщает снимок и счётчики строк. Подробный diff находится
преимущественно в metadata. Модель иногда повторно читает изменённый участок,
чтобы убедиться в результате.

Возможный резерв: компактное подтверждение фактически записанного изменения
с достаточной информацией для следующего действия. Нельзя считать подтверждение
записи заменой проверки поведения программы.

Источники: `src/edit-service.ts` (`commit`), `src/plugin.ts` (`editTool`),
прогон `large-file`.

### 3.5. Пакетные возможности не превращаются в меньшее число шагов

В задаче на три файла оба режима использовали семь инструментов. Наличие batch
само по себе не обеспечило более короткий путь. Нужны понятный основной маршрут
и удобное получение исходных наблюдений.

### 3.6. Локальные операции не являются главным резервом

Зафиксированное время инструментов составляет секунды, а полное время — десятки
секунд на задачу. Поэтому сначала оптимизировать модельные обращения и контекст.

Учёт длительности неудачных инструментов неполный, а параллельные интервалы нельзя
просто складывать как critical path. Точную долю уточнить инструментированием.
Нет оснований удалять файловые проверки ради миллисекунд.

## 4. Что пока является гипотезой

Отдельных измерений требуют:

- вклад каждой схемы инструмента и системной политики в расход;
- влияние компактных ответов на число повторных чтений;
- влияние холодной загрузки плагина;
- влияние LSP-сканирования в обычных проектах;
- накладные расходы повторного diff;
- влияние маршрутизации, токенизации и кеширования провайдера.

Запросы Patchline размером около 27,5 КБ получили существенно различающийся учёт
входных токенов. Без раздельных размеров секций, отпечатков запросов и сведений
провайдера нельзя объяснить это только плагином. Байты — диагностический показатель,
не точная замена токенам. Нельзя вычитать предполагаемые токены провайдера из
фактического расхода, чтобы искусственно улучшить результат.

## 5. P0 — сделать измерения пригодными для принятия решений

Приоритет: блокирующий. Основные файлы: `benchmarks/comparison/runner.ts`,
`evaluate.ts`, `metrics.ts`, `relay.ts`, `analysis.ts`, `config.ts`,
`tests/comparison.test.ts`, `tests/comparison-runtime.test.ts`.

### 5.1. Исправить Git-baseline задач

Сейчас выполняется `git init`, но исходные файлы остаются untracked.
Обычный `git diff` не отражает их изменения.

- Создать отслеживаемое исходное состояние в disposable-репозитории.
- Изолировать Git-конфигурацию; не менять пользовательскую.
- Не наследовать случайные hooks, фильтры и параметры преобразования строк.
- Отдельно добавить сценарии с намеренно грязным рабочим деревом.
- Проверить, что `git diff --check` действительно проверяет выполненную правку.

### 5.2. Укрепить проверку качества

Изменённый модуль и assertions выполняются в одном процессе, код завершения 0
считается успехом. Например, преждевременный `process.exit(0)` может завершить
checker до assertions. Это установленный по коду дефект оценивания; эксплойт
в пилоте не наблюдался.

Добавить отрицательные сценарии:

- преждевременный выход;
- незавершённые assertions;
- вмешательство в проверочную инфраструктуру;
- изменение файлов во время импорта;
- постороннее поведение внутри разрешённого для изменения файла;
- повреждение BOM и окончаний строк вне специальных задач.

Родительский процесс должен проверять ожидаемую полноту результатов и состояние
файлов после grading. Checker должен иметь контролируемое окружение. Один маркер
в stdout сам по себе не является защитой от исполняемого проверяемого кода:
для недоверенных результатов предусмотреть ограниченное окружение выполнения
и независимую проверку эффектов.

Для сохранности использовать byte-aware проверку вне разрешённой области,
проверки API и поведения. Не требовать совпадения всего решения с единственным
эталоном, если корректная альтернативная реализация допустима.

### 5.3. Не терять затраты при ошибке оценщика

- Сначала сохранять время, usage, статус процесса и артефакты попытки.
- Затем выполнять grading и дополнять запись.
- Ошибку оценщика сохранять отдельно от ошибки решения.
- Не исключать из расхода оплаченный прогон при падении grading или cleanup.

### 5.4. Добавить полноту эксперимента и provenance

Сохранять ожидаемую матрицу задач, режимов и повторов, завершённость элементов,
отпечаток корпуса, версии зависимостей, состояние исходников и сборки,
отпечаток build-артефакта, ошибки разбора событий и порядок режимов.

Хранить сырые результаты неизменяемо; изменение оценщика оформлять отдельным
производным отчётом с его версией. Не перезаписывать исходный baseline.
Неполный эксперимент не проходит итоговый gate.

### 5.5. Расширить измерения

Разделять:

- запуск процесса и подготовку зависимостей;
- время провайдера, первый байт и модельные ходы;
- время инструментов, включая ошибки, и critical path;
- tool calls и фактические внутренние операции;
- размеры system, schemas, history и результатов инструментов;
- uncached input, cached input, output, reasoning;
- ошибочные вызовы и корректные защитные отказы.

Добавить ограниченные по памяти/байтам обходы оценщика, лимиты глубины,
контроль symlink/специальных файлов и проверку защищённых sentinels. Ограничение
числа файлов проверять до потенциально большого чтения.

Готовность P0: отрицательные тесты оценщика проваливаются; затраты не теряются;
Git-baseline работает; неполные данные не выглядят как экономия.

## 6. P1 — компактный основной интерфейс

Ожидаемый эффект: высокий по токенам и выбору действий; величина не доказана.

Файлы: `src/plugin.ts`, `src/config.ts`, `src/installer.ts`,
`docs/rules/model-facing-policy.md`, тесты plugin и host adapter.

1. Ввести компактный профиль инструментов.
2. Оставить один предпочтительный путь точечной правки и один пакетной.
3. Убрать из постоянного контекста дублирующие маршрутизаторы.
4. Предлагать LSP/диагностику только при подтверждённой capability.
5. Служебные статусы возвращать в результатах операций.
6. Сохранить совместимый расширенный профиль и документировать переход.
7. По возможности фиксировать набор схем на сессию для стабильности кеширования;
   изменения capability при этом должны корректно инвалидировать состояние.

Предварительная цель: 8–10 предлагаемых инструментов вместо 19 в пилотной
конфигурации. Окончательный состав выбирать по измерениям: одна огромная schema
может быть хуже нескольких маленьких.

### Ограничение API

Установленный SDK поддерживает `tool.definition`, но это не доказывает наличие
произвольного безопасного удаления инструментов на каждом ходе. Проверять
фактические SDK и registry для каждой поддерживаемой версии OpenCode.
Не строить адаптер по документации другой версии.

Host-изменения требуют preflight, контрактных тестов, сохранения восстановления
установки и поведения обычных инструментов. Не менять разрешения пользователя
скрыто ради уменьшения списка инструментов.

Критерии: меньший измеренный schema/policy footprint; недоступные операции
не предлагаются; защиты сохранены; совместимость проверена.

## 7. P2 — сократить лишние ходы

Ожидаемый эффект: высокий по времени и суммарным токенам.

### 7.1. Переписать маршрутизацию действий

- Известен точный путь: не требовать обязательного `glob`.
- Известен текстовый идентификатор: искать в конкретном файле.
- Неизвестен файл: выполнять discovery.
- Нужны отношения символов: доступный LSP.
- Нужна структура: AST.
- Несколько независимых чтений: ограниченный параллелизм.
- Согласованное изменение нескольких файлов: пакет с полной preflight.

Убрать правило, связывающее выбор native patch только с размером файла:
решение зависит от масштаба изменения, представления и поддерживаемой операции.

### 7.2. Объединить поиск участка и получение наблюдения

Добавить ограниченное чтение по текстовому якорю либо эквивалентный основной
маршрут в `src/read-service.ts` и `src/plugin.ts`.

Операция должна читать текущие байты, показывать нужный диапазон, выдавать снимок
и учитывать только действительно показанные строки. Неоднозначный якорь
возвращает кандидаты; усечение не даёт права редактировать скрытые строки.

Не превращать обычный `grep` в неявное разрешение изменения. Снимок и вывод
должны относиться к одной проверенной версии файла.

Цель: заменить `grep → read` одним модельным обращением без ослабления provenance.

### 7.3. Возвращать компактный результат изменения

Сообщать файл, новый снимок, применённый диапазон, краткий фактический diff,
состояние проверки и необходимое следующее действие.

Подтверждение строить из реально применённого результата. Соблюдать бюджет
вывода; подробности оставить в UI metadata. Не скрывать неполную валидацию
и не объявлять `clean` при отсутствии диагностики.

Повторное чтение не требуется только для получения уже подтверждённых данных;
проверка поведения и свежесть последующих операций остаются обязательными.

### 7.4. Упростить batch

Сделать пакетный маршрут понятным из основного edit-интерфейса. Сохранить
проверку всех файлов до записи, path locks, stale guards и guarded rollback.
Не выполнять автоматически частичную замену после отклонения batch.

Критерий P2: меньше модельных ходов и общий расход ниже baseline; сокращение
tool calls не подменяется скрытым ростом внутренних операций или меньшим качеством.

## 8. P3 — диагностика без лишних запусков и шума

Файлы: `src/search/lsp.ts`, `src/lsp/manager.ts`, `src/lsp/projects.ts`,
`src/validation/diagnostics.ts`, `src/plugin.ts`.

- Проверять capability до предложения операции.
- При `lsp: false` не запускать CLI-мост.
- Использовать активный SDK-клиент только для реально поддержанных операций.
- Не объявлять SDK заменой всех диагностических операций без проверки API.
- Возвращать модели краткую причину и одно действие восстановления.
- Полные журналы сохранять в локальных деталях с ограничениями размера.
- Не повторять заведомо неуспешный probe на каждом ходе.
- Инвалидировать capability cache при изменении конфигурации/toolchain.
- Выполнять пропорциональную проверку доступным toolchain.
- Не дедуплицировать проверки по имени команды без учёта ревизии файлов,
  области действия, конфигурации и окружения.

Критерии: ноль заведомо бесполезных LSP-вызовов, отсутствие ложного `clean`,
сохранение требуемой проверки и таймаутов/отмены.

## 9. P4 — runtime после профилирования

Допустимые направления:

- отложенная загрузка Hashline, AST и LSP;
- отложенное сканирование проектов;
- повторное использование безопасных вычислений над теми же байтами;
- устранение дублирующего display-diff;
- ограниченное кеширование с корректной инвалидизацией;
- независимые чтения с ограниченным параллелизмом.

Профилировать отдельно cold CLI и warm session. Бенчмарки больших файлов,
многих файлов и adversarial-входов не заменять только маленьким happy path.

Запрещено ради скорости:

- заменять digest-проверку одним `mtime/size`;
- пропускать identity/path-проверки;
- обходить stale rejection или observed-line guards;
- применять fuzzy-правку после конфликта;
- пропускать preflight batch;
- перезаписывать внешние изменения;
- объявлять диагностику успешной при её отсутствии.

Различать safety-diff и display-diff: оптимизация отображения не должна менять
решение о допустимости записи. Повторное использование вычислений допустимо
только при сохранении проверок актуальности в commit-boundary.

## 10. Регрессионные и качественные gates

Для каждой оптимизации сначала добавить падающий регрессионный тест.

Обязательная матрица:

- внешняя запись между чтением и изменением;
- подмена файла с теми же байтами;
- изменение с сохранёнными размером и временем;
- подмена родительского пути;
- symlink и другие поддерживаемые alias-сценарии;
- конфликт второго файла без частичной записи первого;
- отмена, очистка и освобождение блокировок;
- границы видимых строк и усечённый вывод;
- BOM, CRLF, mixed endings, Unicode и невалидный UTF-8;
- бюджеты, квоты и ограниченность adversarial-входов;
- изоляция session/worktree и Hashline-регистров;
- native patch и последующие Patchline-правки;
- сохранение пользовательского dirty worktree;
- ложный успех оценщика, неполные эксперименты и потеря usage.

Основные существующие наборы: `tests/stale.test.ts`, `tests/paths.test.ts`,
`tests/preservation.test.ts`, `tests/deep-review.test.ts`,
`tests/hashline-transaction.test.ts`, тесты concurrency, cancellation и installer.

Необходимы capable Windows/Linux-прогоны: отсутствие возможности проверки
должно отображаться явно, а не превращаться в незаметный пропуск safety-gate.

## 11. Экспериментальная программа

### Фаза A — локальные и контролируемые эксперименты

Измерять по отдельности:

1. компактные schemas;
2. сокращённую политику;
3. capability-aware LSP;
4. чтение по якорю;
5. результат правки;
6. batch;
7. отложенную инициализацию.

Не смешивать все изменения в один эксперимент. Сохранять baseline и предыдущие
результаты; контролируемый replay измеряет локальные затраты, но не доказывает
изменение качества решений модели.

### Фаза B — повторный пилот

На исправленном стенде сравнить обычный OpenCode, исходный Patchline
и оптимизированный Patchline. Исходный Patchline нужен для attribution;
не смешивать его результаты с основным двухрежимным сравнением.

Использовать сбалансированный порядок, несколько повторов, одинаковую модель
и настройки, отдельные cold/warm условия. Проверить стабильность провайдера;
при неизвестной маршрутизации явно ограничить выводы.

Сохранять все неудачи и расходы. Новые платные серии запускать только после
согласования количества сессий, времени и доступного лимита расходов.

### Фаза C — полная серия

Текущий корпус: 13 задач × 2 режима × 5 повторов = 130 сессий. Размер вычисляется
из manifest/corpus, а не фиксируется старой оценкой 120. Запуск после оценки исправленного
пилота и согласования бюджета. Предыдущая оценка 4,15 млн токенов и 112 минут
является грубой экстраполяцией исходного пилота и не гарантирует новую стоимость.

### Фаза D — независимый holdout

Заранее отделить неиспользованные для настройки задачи и проекты:

- реальные dirty worktrees;
- ошибки типов и граничного поведения;
- большие файлы и неоднозначные совпадения;
- несколько последовательных изменений;
- внешние конфликты;
- многофайловые операции;
- проекты с работающим LSP.

Повторы одной задачи не считать независимыми задачами. Наличие нуля новых
ошибок на маленькой выборке не доказывает отсутствие регрессии.

Протокол holdout до запуска:

- Назначить независимого владельца набора: задачи, проекты и ожидаемые
  результаты не должны использоваться для настройки optimized-варианта.
- Зафиксировать manifest с идентификаторами задач, commit/digest проектов,
  начальными dirty/index-состояниями, проверками поведения/сохранности,
  категориями выше, порядком режимов, моделью и лимитами до первого запуска.
- Считать единицей независимости задачу/проект; коррелированные варианты и
  повторы не увеличивают эффективное число независимых наблюдений.
- Любой baseline-success/optimized-failure означает quality veto; расход и
  время не компенсируют этот исход. Пропущенные/неоценённые исходы не успех.
- Сохранить все попытки, usage, сырые артефакты и парные исходы. Не заменять
  провалившуюся задачу новой; изменения после просмотра результатов требуют
  нового нетронутого holdout.

Статистическое ограничение согласованной нулевой потери: при нуле регрессий
на `n` независимых испытаниях односторонняя точная 95%-верхняя граница частоты
равна `1 - 0.05^(1/n)` (биномиальная модель; независимость и репрезентативность
являются предпосылками, а не свойствами, доказанными числом повторов).
Для n=13/30/59/100/299 границы составляют примерно
20.58%/9.50%/4.95%/2.95%/1.00%. Для 95%-вероятности обнаружить хотя бы одну
регрессию при истинной частоте 5% нужно 59 независимых испытаний, при 1% — 299.
Это ориентиры мощности обнаружения, не согласованный допуск качества и не
доказательство нулевой потери. Конечная выборка не доказывает строго нулевую
частоту; при таком требовании статистический вывод остаётся «не доказано».
Размер/владелец/состав holdout пока не утверждены; перечисленные ориентиры
не разрешают live-запуск и не превращают текущие 13 разработочных задач в holdout.

## 12. Целевые показатели и принятие

Предлагаемые инженерные цели для представительной выборки:

| Показатель | Цель |
|---|---|
| Общие токены | минимум на 20% ниже OpenCode |
| Суммарное время | минимум на 10% ниже |
| Обращения к модели | ниже baseline |
| Ошибочные вызовы | не выше baseline; ноль при нулевом baseline |
| Функциональное качество | без выявленной регрессии |
| Критические нарушения сохранности | 0 |
| Потеря внешних изменений | 0 |
| Ложный успешный результат | 0 |

Цели не являются прогнозом. Эффекты отдельных изменений нельзя складывать
арифметически. Не оптимизировать отдельно кеширование в ущерб общим токенам
или меньший tool-call count в ущерб более дорогому модельному ходу.

Для принятия результата нужны:

- полная заранее определённая матрица;
- абсолютные значения, медианы, хвосты и парные различия;
- доверительные интервалы затрат с группировкой по задачам;
- положительная нижняя граница интервала экономии для подтверждённого выигрыша;
- отсутствие значимой регрессии хвостовых задержек, без сокрытия выбросов;
- разбор случаев, где успешен только один режим;
- заранее заданный критерий non-inferiority качества и объём выборки;
- отдельный veto на любое критическое нарушение сохранности.

На разработочной выборке не допускать новых провалов ранее успешных задач.
Пользователь подтвердил критерий итогового acceptance: нулевая потеря качества.
Любой новый функциональный провал относительно успешного baseline не допускается;
нулевое наблюдаемое число регрессий не заменяет статистическое доказательство.
При недостаточной мощности вывод остаётся «не доказано». Это решение не
разрешает новые live-сессии и не устанавливает размер независимого holdout.
Для расширенной выборки заранее согласовать допустимую границу качества;
при требовании нулевой потери недостаточная статистическая мощность означает
«не доказано», а не автоматическое принятие. Увеличивать число независимых
задач, а не только повторы. Diff precision остаётся вспомогательной метрикой,
не заменяющей функциональную оценку.

## 13. Порядок выполнения и зависимости

| Приоритет | Работа | Условие перехода |
|---|---|---|
| P0 | Стенд, grading и измерения | данные полны и достоверны |
| P1 | Компактный набор инструментов | контекст сокращён без потери защит |
| P2 | Короткий путь чтение → изменение → проверка | меньше модельных ходов |
| P3 | Capability-aware диагностика | нет бессмысленных вызовов и ложных статусов |
| P4 | Runtime-профилирование | локальные улучшения доказаны |
| P5 | Полная серия и holdout | затраты ниже, качество не ухудшилось |

Первая реализационная очередь:

1. Исправить Git-baseline, полноту grading и сохранение затрат.
2. Исключить предложение заведомо недоступной LSP-диагностики.
3. Сократить основной набор инструментов.
4. Уточнить политику для известного пути.
5. Добавить наблюдаемое чтение по якорю.
6. Возвращать компактное подтверждение правки.
7. Повторить пилот и проверить attribution отдельных изменений.
8. Оптимизировать runtime только по профилю.
9. Провести согласованную полную серию и независимый holdout.

Изменения держать узкими и обратимыми. При регрессии возвращать конкретную
оптимизацию к предыдущему поведению, сохраняя результаты эксперимента и чужие
изменения рабочего дерева. Не использовать reset/stash/discard пользовательской
работы как способ отката.

## 14. Проверка перед завершением

Перед заявлением об улучшении выполнить:

```sh
npm run typecheck
npm test
npm run lint
npm run build
npm run doctor
npm run bench
npm run benchmark:compare:check
npm run smoke:plugin
npm run smoke:package
npm run audit:dependencies
```

Дополнить актуальными host/native/installer-проверками при изменении адаптеров.
Обновить контракты инструментов, правила поведения модели, методологию
измерений и совместимость host-адаптеров. Результаты платных сравнений прилагать
отдельно: локальные проверки не заменяют измерение работы модели.

Итоговый принцип: Patchline должен экономить за счёт меньшего количества
ненужной работы, сохраняя проверки, которые защищают пользовательский код.
