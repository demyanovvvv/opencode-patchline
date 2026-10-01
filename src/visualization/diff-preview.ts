import { formatPatch, structuredPatch } from "diff"

export const DIFF_PREVIEW_BUDGET = 20_000

/** Display-only: never emit part of a hunk or spend unbounded time diffing. */
export function diffPreview(oldPath: string, newPath: string, before: string, after: string, budget = DIFF_PREVIEW_BUDGET): { patch: string; truncated: boolean } {
  try {
    const patch = structuredPatch(oldPath, newPath, before, after, undefined, undefined, { context: 3, timeout: 100, maxEditLength: 2_000 })
    if (!patch) return { patch: "", truncated: true }
    let output = ""
    const selected = { ...patch, hunks: [] as typeof patch.hunks }
    for (const hunk of patch.hunks) {
      if (hunk.lines.reduce((size, line) => size + line.length + 1, 0) > budget - output.length) break
      const next = formatPatch({ ...selected, hunks: [...selected.hunks, hunk] })
      if (next.length > budget) break
      selected.hunks.push(hunk)
      output = next
    }
    return { patch: output, truncated: selected.hunks.length < patch.hunks.length }
  } catch {
    // A presentation failure must not change the mutation's outcome.
    return { patch: "", truncated: true }
  }
}