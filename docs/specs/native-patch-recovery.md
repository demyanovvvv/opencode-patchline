# Native patch context recovery

## Ownership and classification

Native `apply_patch` remains a host tool. Patchline's renderer presents its errors
without executing, retrying or weakening host verification. On an error result,
the phrases `Failed to find expected lines` / `context does not match` identify a
presentation-only `NATIVE_PATCH_CONTEXT_MISMATCH`. Generic verification failures
are not enough: malformed syntax and permission failures remain distinct.

The renderer shows `Patch rejected · context mismatch`, one concise reason, a
single fresh-read recovery action and expandable native details capped at 2,000
characters. Mutation route reasons
are separate from failure reasons. Patch-header paths are presentation hints, not
permission evidence. Native write counts remain unknown unless supplied by trusted
metadata; no `writes: 0` is inferred from message text.

## Recovery

Read the smallest affected range and rebuild the patch using exact current lines,
including line breaks. Never repeat the unchanged failed patch, reconstruct old
content from a summary, or overwrite a file to bypass rejection. A small unique
replacement can use snapshot-aware exact editing after the read. Successful native
patches require a new read before reusing Patchline snapshots.

## Evidence and remaining integration work

The inspected OpenCode v1.18.34 `src/tool/apply_patch.ts` derives update content for
each hunk inside the preflight loop (including matching failures), then asks edit
permission and enters the file-change write loop. That source-level evidence shows
context matching preceding writes in this version; it does not prove transactional
rollback for I/O failures or the entire supported version range.

Unit regression scenarios cover single-file errors, CRLF multi-file headers,
trusted and absent write metadata, unrelated errors, malformed patch envelopes,
successful states and route/failure separation. The mounted TUI smoke checks the
actual error card and fresh-read guidance.

The installed plugin SDK exposes `event`, and its event union includes
`message.part.updated` with tool part error state. Patchline now observes these
events to count native context mismatches, deduplicated by session/call ID in a
1,000-entry bounded set. It retains neither patch text nor error source context.
The counter is available as `nativePatchContextMismatches` in the local summary.
Counts only reflect events actually received; they do not infer retries or success.
Events without a valid session/call identity are ignored so malformed host payloads
cannot inflate the counter. Deduplication is bounded and cleared on plugin dispose.

- Remaining work: verify event delivery and native multi-file mismatch/fresh-read
  recovery through real host sessions on the CI version matrix; measure repeated
  identical failures and recovery tool-call counts without retaining source text.
  `tool.execute.after` alone is not an error-delivery guarantee.

The repository does not provide a direct host API for invoking an arbitrary tool
without a model session/provider. The real-session smoke therefore remains a CI
integration gate rather than being faked with a direct endpoint. Local tests cover
the event contract, malformed payloads, deduplication and bounded state.

A direct run of the v1.18.34 upstream `test/tool/apply_patch.test.ts` was attempted
in an existing isolated host checkout. It failed before running tests because the
checkout lacked host dependencies; the clean-checkout CI job subsequently passed
the exact suite on Windows, Linux and macOS.
