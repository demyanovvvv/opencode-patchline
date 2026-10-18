# Benchmark Reporting

Generated Markdown and HTML evaluate provider tokens, time and outcomes, without
monetary pricing commentary. Token usage remains provider-reported; missing
usage is not estimated from text length.

Streaming response tool-call summaries include content-free fragment counters:
`argumentFragments` counts string-valued argument fragments,
`emptyArgumentFragments` counts its empty-string subset,
`nonStringArgumentFragments` counts present non-string argument values, and
`missingArgumentFragments` counts call deltas without an argument property.
These counters supplement byte counts and hashes without retaining argument
contents. Initialization-only deltas may legitimately omit arguments; a final
zero-byte argument is not proof that a tool received valid empty JSON.

Primary paired analysis includes `quality`: any stock-success/Patchline-failure
pair produces `status: "veto"` with task/repeat identifiers. Otherwise status is
`not-established`, including empty datasets: zero observed regressions do not
establish non-inferiority. Task-ID counts describe grouping, not proven project
independence. Performance improvements cannot override the quality veto.

Attribution execution reserves sequential `attribution-dispatch-NN.json` records
with exclusive creation and fsync before dispatch. An interrupted slot remains
consumed. Reservation rejects skipped or repeated slots; exclusive creation
allows only one winner when multiple callers race for the same slot.
Resume in the same output directory requires an unchanged preparation manifest,
an explicit contiguous ledger, unique completed measurements belonging to
dispatched slots, verified raw artifact bytes/fields, and matching execution
settings fingerprints (model, provider metadata, step limit, and timeout).
Historical reports missing the settings fingerprint cannot be resumed by
inventing a past settings identity. A missing historical
ledger is not reconstructed automatically. The preparation fingerprints the
harness as well as treatment artifacts: changing resume code invalidates an
older preparation. Preserve interrupted evidence rather than rewriting its
manifest. These checks do not constitute authentication against malicious
artifact rewriting or prove end-to-end concurrent runner isolation.

`profile-diagnostic` reports are separate from primary A/B and attribution.
Their JSON and offline HTML include fixed-schedule completeness, duplicate and
unexpected session checks, completed grading, boolean outcomes, and finite
positive token/time totals. Missing usage or nonfinite contrasts withhold savings.
`integrity.complete` means the diagnostic dataset is complete, not that quality
or performance acceptance passed; acceptance remains `not-established-diagnostic`.
The HTML is a descriptive summary; CSV and statistical acceptance are not emitted.

Profile execution reserves each dispatch in an exclusive, fsynced
`profile-dispatch-NN.json` before starting the host. A dispatched attempt consumes
authorization even if no completed measurement survives. Resume uses
`run-profiles --max-sessions 12 --input <out>/results.json --out <out>` with the
original provider/host arguments. It validates the fixed schedule, source/dist/
host/lock identity, contiguous dispatch records and completed result membership.
New profile identities also include a SHA-256 fingerprint of model, steps,
timeout and provider configuration; raw credentials are not written into identity.
Historical executions without this fingerprint fail closed on resume and must
not be upgraded by inventing a historical settings identity.
Resume results must be an array of unique dispatched Patchline-mode entries with completed
grading, boolean success and a measurement-artifact reference containing a local
`attempt-*.json` filename and a SHA-256 digest; the
runner verifies the referenced raw bytes against the digest and checks task,
repeat, profile and mode identity before accepting prior results. Shared raw
measurement fields (including usage and duration) must also match; grading fields
and raw-only process output are excluded from that comparison. This does not
allow removing or replacing raw execution errors: they must remain an unchanged
prefix of the result's errors, with later grading errors allowed to append. This does not
authenticate the grading outcome or establish external provenance.
Resume skips every dispatched entry, including interrupted ones, rather than retrying.
Legacy ledgers must be explicitly reconstructed from evidence and labelled as
such; a missing ledger is rejected. This does not replenish authorization.
Artifact identity is checked before dispatch and after raw measurement persistence,
before grading; changed artifacts stop the run without deleting raw evidence.

`run-attribution` requires `--input <manifest.json>`, `--max-sessions 18`,
`--provider-config`, and all four artifact paths used for preparation. It executes
the manifest's fixed three-treatment order with fresh workspaces and homes, pins
model/steps/timeout to preparation, and revalidates preparation before and after
each session. Raw measurements are persisted before grading and partial reports
survive a later failure. Attribution reports remain separate from primary A/B
analysis; a pilot cannot establish acceptance. Usage accounting uses tokens.

Provider SSE tool-call telemetry stores argument byte counts and SHA-256 hashes,
JSON validity, and read-path/anchor-offset validity flags, never argument contents.
Reassembly is bounded to 2 MB of stream text and 128 calls. Malformed, interrupted,
or budget-exhausted streams are marked incomplete; non-SSE responses have no
tool-call telemetry. These diagnostics do not reconstruct historical payloads.

Reports contain raw JSON plus a concise Markdown summary. Precision ratios are
supplementary; they do not replace correctness, stale safety, or raw counts.

The A/B runner adds an autonomous Russian `index.html` with responsive charts,
token composition, filters, hidden-check results and expandable source diffs.
`results.json` is the authoritative portable artifact; `results.csv` and
`summary.md` are supplementary. The browser report makes no network requests.
Embedded JSON escapes HTML delimiters and model/file output renders as inert text.
Unknown usage and tariffs remain explicitly unknown. Pilot status, experiment
limits, mode order, version digests and methodological caveats are visible.
Statistical summaries reject non-finite or negative durations and token counts
before pairing, confidence intervals, or projections. Missing tokens remain
`null`; invalid numeric values are not silently filtered or converted to zero.
Manifest completeness also requires a finite, nonnegative duration for every
session; failures appear in `integrity.invalidDurations`. Projection labels use
the declared `fullProjection.sessions`, never a hard-coded corpus size.
Markdown interpretation follows the declared stage: full-series results retain
task/model/condition limitations and uncertainty guidance instead of being
mislabelled as a pilot. Incomplete-series warnings remain independent of stage.
The comparison runner accepts `--repeats 1..5` (pilot default 1). Live full-stage
runs require exactly 5 repetitions; fewer repetitions are rejected before sessions
launch and must use the pilot stage.
The declared manifest and `--max-sessions` cap are checked before paid sessions;
increasing repeats does not bypass the session cap.

## Three-treatment attribution preparation

The `report --input <results.json>` command recognizes `attribution-pilot`
separately and emits authoritative JSON, a descriptive Markdown summary, and
CSV rows keyed by task/treatment/repeat, plus an offline HTML summary with
escaped analysis text. Missing token usage is an empty CSV cell, not zero.
This route does not use the primary two-mode HTML renderer.

`verify-attribution --input <attribution-manifest.json>` with the same four
binary/plugin flags as preparation revalidates the fixed design and fingerprints
without reading provider configuration, launching hosts, or authorizing sessions.

The separate attribution design uses `stock`, `original`, and `optimized`
treatment identities. Do not collapse the latter two into the two-mode runner's
`patchline` identity or feed these runs to its paired completeness analysis.
The proposed pilot has three tasks (`targeted`, `large-file`, `three-files`),
two repetitions, and 18 sessions. Task and treatment orders reverse on repeat 2.

Preparation manifests have `executionAuthorized: false`; creating one does not
authorize provider requests. They pin model, temperature, limits, corpus hash,
the schedule, canonical artifact paths, byte counts, entry SHA-256 hashes and
plugin-directory tree fingerprints. Both plugin treatments share one integrated
host. The manifest also pins the complete comparison-harness tree (including
runner, grader and reporting sources); verification rejects missing or changed
harness fingerprints, so older preparation artifacts must be prepared again.
The current repository source tree and root `package-lock.json` bytes are also
pinned and revalidated. These identify preparation inputs; they do not prove
source-to-dist correspondence or fingerprint installed dependency contents.
Distinct plugin paths with identical entry bytes are rejected.
Snapshots are rechecked before exclusive manifest creation; existing files are
never overwritten. Manifest output must be outside both measured distributions.
It must also be outside measured dependency installations, preventing manifest
creation from contaminating its own dependency snapshot.
The schedule dispatcher revalidates the preparation manifest immediately before
and after each awaited callback. An artifact mutation stops dispatch before the
next session; callbacks run serially in the fixed schedule.
Each callback receives its schedule identity and a detached copy of the matching
verified treatment artifact, including canonical binary/plugin paths and profile.
This binds future process selection to the verified treatment rather than a
separate caller-maintained mode mapping.
The helper does not grant execution authorization or implement provider execution
by itself.
On success it returns all callback results in schedule order, including failed
session results and unknown usage. A result is appended only after its post-run
manifest verification succeeds; dispatch errors propagate to the caller.
An optional awaited checkpoint receives a copied, readonly cumulative result
array after each verified result, allowing partial-series persistence before a
later session fails. Checkpoint errors stop subsequent dispatch as well.
An optional abort signal is checked before verification, before dispatch and
after checkpointing. Cancellation prevents later sessions; an already running
callback remains responsible for its own process cancellation and cleanup.
Each plugin additionally fingerprints the complete sibling installation
`../node_modules` tree, including a canonical path, when present; absence is
recorded as null and later appearance invalidates preparation. This captures
that installation's bytes, not proof of the host's conditional module resolution
or dependencies resolved from other ancestor directories.

Attribution completeness requires exactly the declared 18 identities, complete
grading, positive finite token totals and positive finite durations. Attribution
summary completeness additionally requires a boolean success outcome for every
session; invalid outcomes are listed in `integrity.invalidOutcomes` and suppress
all savings contrasts. Only literal `true` counts as successful.
Descriptive totals include failed-session costs. Savings are withheld for incomplete series;
the three descriptive contrasts are `originalVsStock`, `optimizedVsOriginal`,
and `optimizedVsStock`, each using its own baseline denominator for tokens
and duration. Original-versus-stock does not use optimized-treatment costs.
Even complete pilot summaries say `not-established-pilot` and cannot establish
quality non-inferiority or performance acceptance. Provider cache is uncontrolled.
The preparation helpers are not yet an executable three-treatment experiment;
host dependency-resolution evidence and approved execution limits remain
prerequisites for connecting provider execution; the dispatcher supplies the
manifest revalidation boundary.

The runner exposes a preparation-only command: `prepare-attribution --stock-bin
<stock> --patchline-bin <integrated> --original-plugin <baseline-dist/plugin.js>
--optimized-plugin <current-dist/plugin.js> --out <existing-or-new-output-dir>`.
It creates `attribution-manifest.json` exclusively and does not load provider
credentials or dispatch model requests. Model/limits in this preparation design
are fixed by the manifest helper; execution remains unauthorized.
Preparation rejects explicit model, steps, timeout, session-cap, repeats, variant,
tool-profile and stage overrides instead of silently ignoring them.
Conversely, original/optimized plugin flags are rejected by the primary runner,
which cannot select those artifacts; preparation and verification accept them.
`verifyAttributionManifest` rechecks the fixed preparation design, corpus,
schedule and current host/plugin/distribution fingerprints. It rejects stale or
altered preparation data and does not convert preparation into execution approval.
