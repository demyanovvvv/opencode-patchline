export type DiffStats = {
  added: number
  deleted: number
}

export function analyzeDiff(before: string, after: string, seenBefore: ReadonlySet<number>): { stats: DiffStats; seenLinesAfter: Set<number> } {
  let added = 0
  let deleted = 0
  const seenAfter = new Set<number>()
  let beforeLine = 1
  let afterLine = 1
  for (const change of diffLines(before, after)) {
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
  return analyzeDiff(before, after, new Set()).stats
}

export function lineRangeForSubstring(text: string, start: number, length: number): { start: number; end: number } {
  let startLine = 1
  for (let index = 0; index < start; index++) {
    if (text.charCodeAt(index) === 10) startLine++
  }
  let end = startLine
  const matchEnd = Math.min(text.length, start + length)
  for (let index = start; index < matchEnd; index++) {
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
