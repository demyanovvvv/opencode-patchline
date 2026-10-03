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
Grep reports should include worker concurrency. Estimated tokens must be labeled
estimates.
