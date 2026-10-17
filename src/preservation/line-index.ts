export type LineIndex = {
  readonly starts: readonly number[]
  readonly totalLines: number
  readonly endsWithNewline: boolean
}

export function buildLineIndex(text: string): LineIndex {
  const starts: number[] = text.length === 0 ? [] : [0]
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    if (index + 1 < text.length) starts.push(index + 1)
  }
  return {
    starts,
    totalLines: starts.length,
    endsWithNewline: text.endsWith("\n"),
  }
}

export function sliceIndexedLines(text: string, index: LineIndex, offset: number, limit: number): string[] {
  if (index.totalLines === 0 || limit <= 0) return []
  const startLine = Math.max(1, offset)
  const endLine = Math.min(index.totalLines, startLine + limit - 1)
  const selected: string[] = []
  for (let line = startLine; line <= endLine; line++) {
    const start = index.starts[line - 1]!
    const nextStart = index.starts[line]
    const end = nextStart === undefined ? (index.endsWithNewline ? text.length - 1 : text.length) : nextStart - 1
    selected.push(text.slice(start, end))
  }
  return selected
}
