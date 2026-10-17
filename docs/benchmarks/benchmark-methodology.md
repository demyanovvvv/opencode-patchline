# Benchmark Methodology

Compare stock OpenCode, ordinary edit/apply_patch, and Patchline from identical
repository states with the same task, model, provider, and settings. Reset only
dedicated benchmark fixtures; never reset a user's working tree.

## Reproducible comparison

`npm run benchmark:compare:check` runs offline safety checks and all thirteen golden
solutions, then writes an autonomous Russian HTML report plus JSON, CSV and
Markdown under `benchmarks/reports/comparison/`. It makes no model requests.

Build the plugin first. A live pilot is **six sessions**, not six provider calls:

```sh
npm run build
npm run benchmark:compare -- run --stage pilot --max-sessions 6 --model provider/model --provider-config /path/to/opencode.json --stock-bin /path/to/upstream/opencode --patchline-bin /path/to/integrated/opencode --out benchmarks/reports/comparison-pilot
```

`--provider-config` is read as JSON/JSONC. Only the selected provider and selected
model are passed to isolated children. Currently the runner supports
`@ai-sdk/openai-compatible` with an explicit `options.baseURL` and `options.apiKey`.
Credentials are used in memory by the local relay and are not included in the
report. A local ephemeral relay requests `stream_options.include_usage` and records
actual streaming usage, response latency, request/response bytes and offered tool
names. It does not record provider messages or authentication headers. The relay
is bound to loopback; requests are forwarded to the configured provider.

Both binaries must have exactly the same upstream version; the stock binary must
not contain Patchline build metadata. Version strings and SHA-256 digests of both
binaries and the plugin are recorded. The intervention is **the complete installed
integration** (host tool selection plus plugin precision), not the plugin isolated
from its host changes. Same-model temperature 0 is requested; `--variant` can fix
the provider reasoning variant. Provider nondeterminism still applies.

Every session gets fresh fixture files, HOME/XDG locations and no inherited
`OPENCODE_*` flags. Project config, user plugins, MCP, instructions, title/summary
agents, LSP auto-install and formatting are disabled. A common prompt suffix and
permissions prevent subagents and unsolicited documentation. Hidden behavioral
checks execute after model completion outside its workspace. Timing includes CLI
startup and inference, excludes grading. Fresh dependency caches make startup part
of the measurement; provider caches cannot be flushed. Mode order alternates per
task/repeat. Each mode sees byte-identical starting files.

Defaults: 180 seconds/session, 16 agent steps and at most 19 provider requests via
the relay, including any retries. `--timeout` and `--steps` can change these bounds.
`--max-sessions` is mandatory for live runs. Full evaluation requires `--stage full
--max-sessions 130` (13 tasks × 2 modes × 5 repetitions). It is a separate explicit
invocation after reviewing pilot costs. No automatic expansion or paid retries.
If a session fails/times out, its consumed resources remain in the result.
Reports checkpoint after each session; existing source worktrees are never reset.
Use a new `--out` directory per experiment to preserve history.

```sh
npm run benchmark:compare:report -- --input benchmarks/reports/comparison-pilot/results.json --out benchmarks/reports/comparison-pilot
```

Use `--temp-root` to select an existing parent for disposable fixtures. Reports
contain fixture diffs and model/tool output; these are explicitly benchmark
artifacts, distinct from the content-free plugin telemetry contract.

Pilot results are descriptive only. The full series adds paired task-cluster
bootstrap intervals, not universal model-quality or release-performance claims.
There is no LLM judge or subjective style score. Inspect behavioral checks,
preservation and raw diffs together. No monetary savings are claimed without a
verified tariff; OpenCode cost zero can mean an unconfigured tariff.

Hidden checks require an explicit per-check completion marker in addition to a
successful process exit. An imported solution calling `process.exit(0)` before
assertions finish fails grading. The evaluator also compares workspace contents
before and after all checks; changes made during grading fail both functionality
and preservation. Unexpected additions in an intended file fail preservation,
even if behavioral assertions pass. These checks are integrity backstops, not an
OS sandbox: isolation of untrusted code and independent behavior observation
remain required before acceptance-quality comparisons.

Fixture contents are staged in a dedicated Git index before each session (with
automatic CRLF conversion disabled), so ordinary `git diff` sees modifications
and deletions against the initial bytes. No user repository is staged or reset.
Each paid run is persisted with `gradingStatus: pending` before hidden grading;
grader exceptions retain measurements and become explicit failed runs. A declared
task/repeat/mode manifest is saved before model requests. `integrity.complete`
requires every declared run exactly once, completed grading, and measured usage;
missing manifests, partial runs and duplicates cannot establish completeness.
File reads also verify lossless UTF-8 round trips; invalid bytes cannot masquerade
as preserved replacement characters after decoding, before or after grading.
Evaluation walks count directories and files before reading (500 entries,
32 levels), enforce 2 MB per file and 8 MB total, and reject non-regular entries.
Only the workspace's root `.git` metadata is excluded; nested `.git` names are
evaluated. Hidden-check children receive an allowlisted OS environment with
scratch HOME/TEMP, no inherited credentials or Node preload options, and bounded
execution through the process-tree timeout runner. This is still not an OS
sandbox or independent external assertion process.
Corpus behavior imports now use `vm.SourceTextModule` in a separate context,
with string/Wasm code generation disabled, no injected Node globals, and only
fixture-relative module linking. Assertions remain outside that context; tested
code cannot import and replace the checker's `node:assert`. This restricts direct
access but VM contexts are not a security boundary; an independently isolated
observation process remains required for acceptance of adversarial results.
HTML and Markdown explicitly mark missing/incomplete manifests as
`НЕПОЛНАЯ СЕРИЯ`, including reports whose requested stage is `full`.
Fixture Git removes inherited `GIT_*` overrides, disables global/system config and
attributes, uses an empty template, and persists `core.autocrlf=false` locally.
Provider measurements include a SHA-256 of the forwarded request and JSON byte
sizes per top-level section, without persisting request contents or credentials.
Diff precision now preserves CRLF/LF distinctions rather than normalizing them;
newline-only collateral changes therefore affect preservation on every task.
Preservation is evaluated separately from golden diff precision: task construction
declares editable regions from the requested replacements. All prefix, suffix
and intervening protected text must survive exactly and in order. Alternative
implementations inside those regions can pass behavioral checks without matching
the golden expression. Exact-byte tasks still require the unique requested bytes.
Before grading, each live attempt also writes a unique, exclusively created JSON
artifact containing redacted stdout/stderr and original measurements; its filename
and SHA-256 are linked from the run. Live provenance records corpus and lockfile
hashes plus the tracked source diff hash and dirty flag alongside binary/plugin
hashes. Before live model requests, the runner also copies current build inputs
into a temporary workspace, uses the installed toolchain to run `scripts/build.mjs`,
and compares every output path and byte against the measured `dist`. Missing,
extra or stale outputs fail the preflight. The measured source and distribution
are checked again after the rebuild; the measured tree is never rebuilt in place.
The matching source/distribution/rebuilt hashes are recorded as
`environment.reproducibleBuild`. This proves local reproducibility with the
installed toolchain, not independent trust in that toolchain.
Live provenance additionally fingerprints every file name and byte content under
`src`, `dist`, and the comparison harness, including untracked files, and records
installed TypeScript, OpenCode SDK/plugin, diff and Zod versions. Non-regular
source entries fail fingerprinting. A dirty-fixture regression verifies that
`git diff --check` detects introduced whitespace while pre-existing user edits and
the staged baseline remain intact.

Offline `check` records the same corpus SHA-256 and source/harness tree
fingerprints as live runs, including untracked source files. This associates
offline grading and replay evidence with the actual acceptance contract and
implementation used. Historical reports without these fields remain historical
evidence with unknown fingerprints; report regeneration must not attach current
fingerprints to their past executions. Offline checks do not claim a verified
distribution build unless separately measured.

Manifest integrity also rejects invalid session identities even when the same
invalid entry appears in both manifest and measured runs: task IDs must be
nonempty strings, repeats nonnegative safe integers, and modes `stock` or
`patchline`. Rejections are listed in `integrity.invalidIdentities` and prevent
`integrity.complete`. Identity validity does not by itself prove a balanced or
adequately powered experiment. Each declared task/repeat must include both modes;
missing counterparts are listed by task/repeat in `integrity.unpaired` and prevent
completeness even if every declared session was measured and graded. This checks
pair coverage, not the required task count or repetitions for a full experiment.

The live corpus now also includes `dirty-worktree`: its Git index is initialized
from a separate clean baseline before materializing pre-existing user edits.
Both modes see the same dirty target and unrelated notes file, and preservation
grading rejects loss of either user's content. This expands the full corpus to
13 tasks; older 12-task pilot projections do not describe the updated full run.
The full-series cost/time projection derives its session count from the current
corpus (task count × two modes × five repetitions), rather than a fixed 120.
Summary callers without an explicit projection size receive no projection.
Live CLI accepts the current full-series bound of 130 sessions and supports
`--tool-profile extended|compact` (default `extended`). The chosen profile is
passed only to Patchline plugin options and persisted as `report.toolProfile`;
stock remains plugin-free. Use a separate output directory for each profile.
Selecting a profile does not authorize or start a paid series by itself.

Offline `check` also records `batch-edit-replay`: the same two files and exact
edits are executed sequentially and as one atomic batch. Setup and snapshot
reads are excluded from timed mutation intervals. The first process-local pair
is separate from 20 warm pairs with alternating balanced order; each execution
must produce the exact expected bytes in both files. Reports retain raw pairs,
latency summaries and local mutation call counts (two versus one). These timings
include each service's safety work and do not imply provider token savings,
fewer model decisions, OS-cold behavior or superior failure recovery. Existing
stale/rollback tests remain independent safety evidence.

`report.toolProfiles` records deterministic per-tool JSON-schema byte sizes and
system-policy UTF-8 bytes for both plugin profiles with `lsp:false`. This is a
plugin-only local comparison: host-native tools, provider schema transformations,
tokenization and repeated request/caching costs are not included. Actual request
section byte counts continue to come from the relay during live runs.
The live runner fingerprints staged paths, modes, object IDs and `ls-files -v`
flags before and after each session. Missing/unreadable index state or changes
to that fingerprint fail the attempt even if functional grading passes. This
uses semantic staged state rather than raw index bytes, since ordinary Git
status refreshes can rewrite its stat cache. The before/after proof is stored
as `run.gitIndex` before grading.

Hidden behavioral checkers now run with Node's `--permission` model, allowing
filesystem reads only for the generated checker itself and granting no writes,
child processes, workers or addons. Fixture module bytes are embedded and still
loaded in the restricted VM context. The trusted `checkJs` action runs as a
separate permission-limited process, with read access only to the fixture and
installed TypeScript, and no child-process grant. Regression checks verify that
both in-fixture and out-of-fixture writes are denied without changing bytes.
The comparison evaluator therefore requires Node 22.13+ for stable `--permission`.
These restrictions are defense in depth: Node permissions and VM are not an OS
sandbox, and Node 22 permissions do not deny network access. Independent OS-level
effect isolation/observation remains an open P0 acceptance item.
