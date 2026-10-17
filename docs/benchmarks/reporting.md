# Benchmark Reporting

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

The separate attribution design uses `stock`, `original`, and `optimized`
treatment identities. Do not collapse the latter two into the two-mode runner's
`patchline` identity or feed these runs to its paired completeness analysis.
The proposed pilot has three tasks (`targeted`, `large-file`, `three-files`),
two repetitions, and 18 sessions. Task and treatment orders reverse on repeat 2.

Preparation manifests have `executionAuthorized: false`; creating one does not
authorize provider requests. They pin model, temperature, limits, corpus hash,
the schedule, canonical artifact paths, byte counts, entry SHA-256 hashes and
plugin-directory tree fingerprints. Both plugin treatments share one integrated
host. Distinct plugin paths with identical entry bytes are rejected.
Snapshots are rechecked before exclusive manifest creation; existing files are
never overwritten. Manifest output must be outside both measured distributions.
External dependency contents are not covered by distribution fingerprints.

Attribution completeness requires exactly the declared 18 identities, complete
grading, positive finite token totals and positive finite durations. Descriptive
totals include failed-session costs. Savings are withheld for incomplete series;
even complete pilot summaries say `not-established-pilot` and cannot establish
quality non-inferiority or performance acceptance. Provider cache is uncontrolled.
The preparation helpers are not yet an executable three-treatment experiment;
dependency provenance, dispatch-time revalidation and approved spending limits
remain prerequisites for connecting paid execution.

The runner exposes a preparation-only command: `prepare-attribution --stock-bin
<stock> --patchline-bin <integrated> --original-plugin <baseline-dist/plugin.js>
--optimized-plugin <current-dist/plugin.js> --out <existing-or-new-output-dir>`.
It creates `attribution-manifest.json` exclusively and does not load provider
credentials or dispatch model requests. Model/limits in this preparation design
are fixed by the manifest helper; execution remains unauthorized.
Preparation rejects explicit model, steps, timeout, session-cap, repeats, variant,
tool-profile and stage overrides instead of silently ignoring them.
Conversely, original/optimized plugin flags are rejected by the primary runner,
which cannot select those artifacts; only `prepare-attribution` accepts them.
`verifyAttributionManifest` rechecks the fixed preparation design, corpus,
schedule and current host/plugin/distribution fingerprints. It rejects stale or
altered preparation data and does not convert preparation into execution approval.
