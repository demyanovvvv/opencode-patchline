import { applyPatch, parsePatch } from "diff"
import { describe, expect, it } from "vitest"
import { diffPreview } from "../src/visualization/diff-preview.js"

describe("bounded display diff", () => {
  it("preserves a complete small diff including absent final newline", () => {
    const preview = diffPreview("a.ts", "a.ts", "old", "new")
    expect(preview.truncated).toBe(false)
    expect(applyPatch("old", preview.patch)).toBe("new")
  })

  it("keeps only complete hunks within the character budget", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}\n`).join("")
    const after = before.replace("line 0", "new 0").replace("line 29", "x".repeat(25_000))
    const preview = diffPreview("a.ts", "a.ts", before, after)
    expect(preview.truncated).toBe(true)
    expect(preview.patch.length).toBeLessThanOrEqual(20_000)
    const patches = parsePatch(preview.patch)
    expect(patches[0]?.hunks).toHaveLength(1)
    expect(applyPatch(before, preview.patch)).toBe(before.replace("line 0", "new 0"))
  })

  it("omits an oversized hunk rather than emitting a broken patch", () => {
    expect(diffPreview("a.ts", "a.ts", "old\n", `${"x".repeat(25_000)}\n`)).toEqual({ patch: "", truncated: true })
  })
})