import { describe, expect, it } from "vitest"
import { diffStats, mapSeenLines } from "../src/editing/diff.js"

describe("large file diff", () => {
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
