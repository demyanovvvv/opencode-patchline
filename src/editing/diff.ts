export type DiffStats = {
  added: number
  deleted: number
}

export function diffStats(before: string, after: string): DiffStats {
  const left = before.split("\n")
  const right = after.split("\n")
  const rows = left.length + 1
  const columns = right.length + 1
  const lengths = new Uint32Array(rows * columns)
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      const index = i * columns + j
      lengths[index] = left[i - 1] === right[j - 1]
        ? lengths[(i - 1) * columns + j - 1]! + 1
        : Math.max(lengths[(i - 1) * columns + j]!, lengths[i * columns + j - 1]!)
    }
  }
  const common = lengths[(rows - 1) * columns + columns - 1]!
  return { added: right.length - common, deleted: left.length - common }
}

export function lineRangeForSubstring(text: string, start: number, length: number): { start: number; end: number } {
  const prefix = text.slice(0, start)
  const startLine = prefix.split("\n").length
  const matched = text.slice(start, start + length)
  return { start: startLine, end: startLine + (matched.match(/\n/g) ?? []).length }
}

function chunkLineCount(value: string): number {
  if (!value) return 0
  const rows = value.split("\n").length
  return rows - (value.endsWith("\n") ? 1 : 0)
}

export function mapSeenLines(before: string, after: string, seenBefore: ReadonlySet<number>): Set<number> {
  const seenAfter = new Set<number>()
  let beforeLine = 1
  let afterLine = 1
  for (const change of diffLines(before, after)) {
    const count = chunkLineCount(change.value)
    if (change.added) {
      for (let index = 0; index < count; index++) seenAfter.add(afterLine + index)
      afterLine += count
      continue
    }
    if (change.removed) {
      beforeLine += count
      continue
    }
    for (let index = 0; index < count; index++) {
      if (seenBefore.has(beforeLine + index)) seenAfter.add(afterLine + index)
    }
    beforeLine += count
    afterLine += count
  }
  return seenAfter
}
import { diffLines } from "diff"
