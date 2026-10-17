# Performance and compatibility budgets

- Literal search returns actual absolute file paths, including subdirectory and
  authorized external-directory searches. Results retain deterministic path order.
- Search scans ordered batches of at most eight files and stops consuming batches
  after one match beyond `maxResults`. Each file retains at most `maxResults + 1`
  matches. Skipped counts describe the consumed prefix, not the entire workspace.
  Enumeration and sorting still cover the selected tree. Cancellation is checked
  before traversal, during enumeration, between batches and during line scanning;
  an in-flight bounded file read may complete before cancellation is observed.
- Mutation diff analysis uses a 100 ms diff-algorithm deadline and a 2,000-edit
  limit. Exceeding either rejects preflight with `STANDARD_TOOL_REQUIRED`, before
  writes. These limits do not weaken stale or observed-line checks. Tokenization
  and line mapping remain bounded by the existing file size limit.
- Snapshot byte accounting includes pooled source buffers/text, an estimate of
  eight bytes per line-index entry and 32 bytes per observed-line set entry.
  The quota is an accounting estimate, not a hard process-RSS limit. Shared
  documents/indexes are charged once; observed sets are charged per snapshot.
  A prepared read carries its digest into recording without hashing twice.
- Host version generation and doctor accept stable OpenCode `>=1.18.0 <2`, with
  integration build metadata accepted by doctor. This range is a compatibility
  policy, not proof that every upstream version has been integration-tested.
  UI patching validates all replacement anchors before writing the renderer.
- Doctor version probes have a 10-second deadline and a 16,384-character combined
  output cap. Exceeding either terminates the probe and reports it unavailable.
- CLI installer code is imported only after a valid install/uninstall request
  passes argument parsing (help does not initialize it), or after host-upgrade
  arguments pass validation. Capability inspection is loaded when an inspection
  command needs it, preserving injected inspection hooks. This defers startup
  work; it neither removes installation guards nor skips doctor self-tests.
- CLI LSP project preparation is imported only within the LSP command branch,
  after validating `--directory`. Configuration and explanatory commands do not
  initialize LSP discovery; LSP command behavior and verification remain intact.
- AST search loads the native parser only after argument, path, language and
  bounded UTF-8 file checks pass. Plugin/module import and rejected requests do
  not load the native binding. Cancellation is checked before and after loading;
  the first valid AST request pays initialization, later requests reuse the module.

Further implemented budgets and limitations are specified in
`deep-review-hardening.md`: linear tag normalization, 32 MiB prepared edit data,
4 MiB aggregate live Hashline data, clipboard quotas, search/AST traversal caps,
SDK deadline and bounded process cleanup. RSS remains an estimate rather than a
hard allocation ceiling. Hidden-whitespace measurements are reproducible with
`npx tsx benchmarks/hardening.ts`.
