# Benchmark Metrics

Record functional success, intended and actual changed lines, unrelated lines,
files touched, formatting churn, whole rewrites, stale overwrites, retries,
context lines, tool bytes, edit bytes, provider token fields when available,
diagnostics latency, route strategy, route confidence, strategy fallbacks,
tool calls saved, and wall time. Search benchmarks should also record files
visited, skipped files, result truncation, and bounded worker concurrency.
Read benchmarks should include file size, requested range, total lines, and
whether a pooled line index was reused. Reports should include warmup count,
measurement count, p50, p95, and p99 latency, plus RSS data where available.
The local runner retains each repeated read's measured duration and returned
`lineIndexReused` flag in `repeatedRead.samples`; its aggregate reuse flag is
derived from those observations rather than assumed from the scenario.
Grep reports should include worker concurrency. Estimated tokens must be labeled
estimates.

The comparison relay records actual provider usage with disjoint input, output,
reasoning, cache-read and cache-write fields. Total is their sum. Missing,
inconsistent or all-zero usage is unavailable, never estimated or called free.
OpenCode step-finish usage is retained separately and deduplicated by part ID;
it is never added again to provider usage. Provider retries count in consumption.
Relay `messageSections` measures each serialized message object's UTF-8 JSON
bytes: system/developer, user/assistant history, tool results, and unknown roles
are disjoint categories. Array brackets/separators are excluded; the complete
messages array size remains in `requestSections.messages`. These are not token
counts. Missing/non-array messages produce `null`, not an invented zero. No
message content is stored in this breakdown.

Comparison `events.toolTiming` separates summed tool duration (`sumMs`), the
union of tool intervals (`activeWallMs`, avoiding overlap double counting), and
the span from the earliest start to latest end (`spanMs`, including gaps).
These are observed timestamp metrics, not a reconstructed dependency critical
path. Nonfinite, negative, reversed or missing timestamps make aggregate timing
unavailable (`null`), with `measured`, `missing` and `complete` retained. Valid
zero-duration intervals remain zero. Error-tool intervals are included.

Success requires behavioral checks, preservation, exit zero and no session error
or timeout. Precision/recall match signed line changes (including position)
against the golden edit. No-op precision is unavailable and recall is zero;
byte-level exactness is recorded separately. All created files are inspected.
Line matching does not imply semantic correctness or style quality.
Preservation also fails when actual deletions include original lines outside the
golden deletion set, even inside a file that was legitimately edited.

Aggregate savings use complete task/repeat pairs and include unsuccessful runs.
If any paired usage is unavailable, aggregate token savings are unavailable.
Cost per successful solution includes expenses of failed attempts. Display median
wall time, per-task values, pass counts, tool errors and raw diffs. At least ten
complete pairs across at least three tasks enable a deterministic 2,000-sample
paired bootstrap, resampling whole task clusters (seed 127019), for 95% savings
intervals. Smaller samples show insufficient data. These intervals condition on
the corpus and do not establish universal model performance. Reports also retain
the subset where both modes succeeded. There is no invented combined quality score.
