import { describe, expect, it } from "vitest"
import { analyzeDiff, diffStats, mapSeenLines } from "../src/editing/diff.js"

describe("large file diff", () => {
  it("matches safety analysis statistics across newline and Unicode boundaries", () => {
    const fragments = ["", "a", "\n", "\r\n", "😀", "a\nb\n", "a\r\nb"]
    for (const before of fragments) {
      for (const after of fragments) expect(diffStats(before, after)).toEqual(analyzeDiff(before, after, new Set([1])).stats)
    }
  })

  it("keeps the safety diff edit-length budget for statistics-only calls", () => {
    const before = Array.from({ length: 2_100 }, (_, index) => `old-${index}\n`).join("")
    const after = Array.from({ length: 2_100 }, (_, index) => `new-${index}\n`).join("")
    expect(() => diffStats(before, after)).toThrow(/Diff analysis exceeded its budget/)
    expect(() => analyzeDiff(before, after, new Set())).toThrow(/Diff analysis exceeded its budget/)
  })
  it("counts a localized edit in a 100,000-line file without quadratic allocation", () => {
    const lines = Array.from({ length: 100_000 }, (_, index) => `// ${index}`)
    const before = `${lines.join("\n")}\n`
    lines[49_999] = "// changed"
    const after = `${lines.join("\n")}\n`
    expect(diffStats(before, after)).toEqual({ added: 1, deleted: 1 })
    const seen = mapSeenLines(before, after, new Set([49_999, 50_000, 50_001]))
    expect([...seen].sort((a, b) => a - b)).toEqual([49_999, 50_000, 50_001])
  })
})
