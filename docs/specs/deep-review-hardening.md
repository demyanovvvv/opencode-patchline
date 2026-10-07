# Deep review hardening

## Implemented contracts

- Every path resolution with an authorization callback authorizes the canonical
  target. The OpenCode adapter uses worktree-relative operation permission
  patterns internally and requests external-directory permission externally.
- Generated-file protection applies at common edit preflight, not only write or
  whole-patch entry points.
- Exact replacement text is literal, including dollar sequences. Candidate CRLF
  text is normalized before diff analysis. Final newline anchors do not require
  a nonexistent next line. Exact operations map observation provenance from the
  actual replacement rather than an ambiguous line diff.
- Mixed-newline reconstruction preserves unchanged line chunks; changed chunks
  use the dominant ending. Its matching budget is 100 ms / 2,000 edits.
- Hashline tag normalization scans each line linearly. Full Patchline snapshot
  IDs may be used in whole-patch headers to resolve short-tag collisions; the
  upstream runtime receives the corresponding short tag after scoped lookup.
- Pure additions/deletions use direct statistics. Node insertion anchors require
  complete decimal tokens and safe integer values.
- Oversized snapshots fail explicitly instead of returning an already-evicted
  ID. Budget-only failure after an edit preserves the applied change and reports
  no next snapshot plus a warning. Unexpected bookkeeping failures still invoke
  guarded rollback; callers must inspect landed/restored/conflict details.
- Mutation reads are bounded to 8 MiB. Prepared edit batches have a 32 MiB
  accounting budget. Hashline live reads are sequential and check cancellation.
- Recovery results are bound to the baseline used for calculation; warning text
  is not a safety proof. Changed baselines reject before commit.
- Existing-file edits serialize commit/rollback across overlapping canonical
  paths process-wide. Atomic replacement rechecks an expected content digest
  after temporary preparation. External writes in the final check/rename window
  remain outside a portable compare-and-swap guarantee.
- Move rollback invalidates source and destination snapshots.
- Registration failure invokes the host rollback callback; project preflight
  runs before host provisioning. Already-installed host configuration changes
  also return a rollback callback. Both host caches validate their upstream tag.
- Doctor timeout attempts Windows process-tree termination. SDK LSP rejects error
  envelopes and forwards cancellation; its output is bounded. AST checks
  cancellation before parsing and during traversal. Native synchronous parsing
  cannot be interrupted by an event-loop abort callback.
- Literal search scans lines by offsets instead of allocating a split array and
  uses normalized line numbering, including bare CR.
- Hashline live input is limited to 4 MiB aggregate before upstream preparation.
  Clipboard limits are 256 registers / 8 MiB per scope, 512 scopes, one-hour idle
  expiry and a 64 MiB global accounting eviction budget checked on scope access.
- Linear Hashline operations preserve observation provenance in Node and, where
  the independently calculated result matches upstream, Bun. Full-ID repeated
  sections with conflicting identities reject before parsing.
- Allowed existing-file replacement writes share canonical path locks with edits.
  Queued lock acquisition supports cancellation without allowing later callers
  to overtake an active holder.
- Host binary verification failure attempts ownership-checked restoration. All
  four host source adapters preflight before the patch set is committed; build
  failures restore owned source changes. Installer version checks share doctor's
  stable-version policy.
- SDK LSP has a 15-second deadline. AST traversal has a 100,000-node visited/pending
  budget. Search enumerates at most 100,000 files / 10,000 directories and sorts
  files once. These are hard refusal budgets, not partial-result truncation.
- Windows process-tree cleanup has its own two-second fallback deadline. Host
  source inspection rejects tracked modifications outside the four adapter files
  and Bun lockfiles; allowed adapter modifications still require deeper ownership
  inspection. Host smoke separates plugin tools from the native host apply_patch.

## Remaining work before full-plan completion

- Native patch context recovery is implemented in policy/activity/TUI with
  regressions and mounted smoke; see `native-patch-recovery.md`. Real-session
  native multi-file matching, retry telemetry and recovery evaluation remain
  integration gates; no host mutation behavior was weakened.
- Native event telemetry has local malformed-event, deduplication and 1,000-entry
  bound tests, including missing identity rejection. Real host event delivery still
  requires a configured model session.
- Direct upstream native `apply_patch` tests in the old partial checkout were
  blocked by missing host dependencies (`@babel/core`, then `effect`). CI now has a
  clean-checkout native-host job with frozen Bun install and the exact upstream
  suite on Windows, Linux and macOS; results remain pending until CI runs.

- Structural Hashline and recovery clear next-snapshot observations when exact
  provenance cannot be proved, requiring a fresh read instead of guessing from
  ambiguous diff alignment. Exact and linear operations retain proven mapping.
- Allowed existing-file replacement writes now carry a baseline content digest
  into atomic replacement, matching edit commit protection for in-place external
  changes.
- Allowed dirty adapters are checked against pristine HEAD plus the precise
  integration transformation; extra modifications reject. Late binary read
  failure now attempts ownership-checked restoration. Changed Bun lockfiles and
  untracked build inputs reject; dependency installation uses frozen upstream
  lockfiles. Moves retain successful
  changes on budget-only next snapshot failure with an explicit warning.
- Patch UI dependency advisories with compatible Solid/Babel versions and lockfile
  updates. The attempted npm installation was rejected by the active shell policy.
  Candidate patch updates are solid-js/babel-preset-solid 1.9.16 and a scoped
  @opentui/solid override to @babel/core 7.29.7; they have not been installed or
  verified and are deliberately absent from the manifest/lockfile.
- `npm run audit:dependencies` now reports exact vulnerable production paths and
  exits nonzero for high/critical advisories. The current lockfile still reports
  three critical paths (`@opentui/solid`, `solid-js`, `seroval`); release remains
  blocked until a compatible npm lockfile update is applied in an environment
  that permits package-manager writes.
- Extend the five-case Node/Bun linear differential corpus and run cross-platform,
  lower-bound/current OpenCode integration matrices. Local Bun Hashline, TUI and
  isolated installer/package and live plugin smoke passed locally. A full isolated
  host build was attempted with a 16-minute command allowance and failed; it is
  not a verified compatibility gate.
- Expand performance reporting to large-repository/batch scenarios. The hidden
  whitespace benchmark reports p50/p95, sampled RSS, process peak RSS and queued
  lock cancellation latency. Those figures do not measure native parser or OS
  process-tree cancellation. Shell guard remains a heuristic.
  `benchmarks/scalability.ts` additionally measures deterministic early-match
  search over 10,000 files, including global enumeration/sort cost and process
  peak RSS. Local observed p95 was 128 ms; it is not a cross-machine threshold.
