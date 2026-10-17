import { PatchlineError } from "../errors.js"

export type DiffStats = {
  added: number
  deleted: number
}

export function analyzeDiff(before: string, after: string, seenBefore: ReadonlySet<number>): { stats: DiffStats; seenLinesAfter: Set<number> } {
  if (!before || !after) {
    const added = chunkLineCount(after)
    return { stats: { added, deleted: chunkLineCount(before) }, seenLinesAfter: new Set(Array.from({ length: added }, (_, index) => index + 1)) }
  }
  let added = 0
  let deleted = 0
  const seenAfter = new Set<number>()
  let beforeLine = 1
  let afterLine = 1
  const changes = diffLines(before, after, { timeout: 100, maxEditLength: 2_000 })
  if (!changes) throw new PatchlineError("STANDARD_TOOL_REQUIRED", "Diff analysis exceeded its budget; use the standard tool for this large change.")
  for (const change of changes) {
    const count = chunkLineCount(change.value)
    if (change.added) {
      added += count
      for (let index = 0; index < count; index++) seenAfter.add(afterLine + index)
      afterLine += count
    } else if (change.removed) {
      deleted += count
      beforeLine += count
    } else {
      for (let index = 0; index < count; index++) {
        if (seenBefore.has(beforeLine + index)) seenAfter.add(afterLine + index)
      }
      beforeLine += count
      afterLine += count
    }
  }
  return { stats: { added, deleted }, seenLinesAfter: seenAfter }
}

export function diffStats(before: string, after: string): DiffStats {
  if (!before || !after) return { added: chunkLineCount(after), deleted: chunkLineCount(before) }
  const changes = diffLines(before, after, { timeout: 100, maxEditLength: 2_000 })
  if (!changes) throw new PatchlineError("STANDARD_TOOL_REQUIRED", "Diff analysis exceeded its budget; use the standard tool for this large change.")
  let added = 0
  let deleted = 0
  for (const change of changes) {
    if (change.added) added += chunkLineCount(change.value)
    else if (change.removed) deleted += chunkLineCount(change.value)
  }
  return { added, deleted }
}

export function lineRangeForSubstring(text: string, start: number, length: number): { start: number; end: number } {
  let startLine = 1
  for (let index = 0; index < start; index++) {
    if (text.charCodeAt(index) === 10) startLine++
  }
  let end = startLine
  const matchEnd = Math.min(text.length, start + length)
  for (let index = start; index < matchEnd - 1; index++) {
    if (text.charCodeAt(index) === 10) end++
  }
  return { start: startLine, end }
}

function chunkLineCount(value: string): number {
  if (!value) return 0
  const rows = value.split("\n").length
  return rows - (value.endsWith("\n") ? 1 : 0)
}

export function mapSeenLines(before: string, after: string, seenBefore: ReadonlySet<number>): Set<number> {
  return analyzeDiff(before, after, seenBefore).seenLinesAfter
}
import { diffLines } from "diff"
