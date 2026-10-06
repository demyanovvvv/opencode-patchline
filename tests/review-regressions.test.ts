import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { grepWorkspace } from "../src/search/grep.js"
import { analyzeDiff } from "../src/editing/diff.js"
import { decodeUtf8 } from "../src/preservation/text.js"
import { digestBytes, ScopedSnapshotStore } from "../src/snapshot/store.js"
import { integratedHostVersion } from "../src/installer.js"
import { temporaryWorkspace } from "./helpers/workspace.js"
import { supportsOpenCodeVersion } from "../src/opencode-version.js"

describe("review regressions", () => {
  it("returns real paths when searching a subdirectory", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await mkdir(path.join(workspace.path, "nested"))
      const file = path.join(workspace.path, "nested", "file.ts")
      await writeFile(file, "needle\n")
      const result = await grepWorkspace({ worktree: workspace.path, path: "nested", pattern: "needle", maxResults: 1 })
      expect(result.matches[0]?.path).toBe(file)
    } finally { await workspace.cleanup() }
  })

  it("stops scanning after the first extra match", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "needle\nneedle\n")
      await writeFile(path.join(workspace.path, "z.ts"), Buffer.from([0xff]))
      const result = await grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 1 })
      expect(result.truncated).toBe(true)
      expect(result.skippedCount).toBe(0)
    } finally { await workspace.cleanup() }
  })

  it("honors search cancellation before traversal", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const controller = new AbortController()
      controller.abort()
      await expect(grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 1, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    } finally { await workspace.cleanup() }
  })

  it("rejects an excessive diff rather than assuming seen lines", () => {
    const before = Array.from({ length: 1100 }, (_, i) => `before ${i}\n`).join("")
    const after = Array.from({ length: 1100 }, (_, i) => `after ${i}\n`).join("")
    expect(() => analyzeDiff(before, after, new Set([1]))).toThrow(/diff.*budget/i)
  })

  it("accounts for line indexes in the snapshot budget", () => {
    const store = new ScopedSnapshotStore({ maxBytes: 1000 })
    const scope = { sessionId: "review", worktree: process.cwd() }
    const file = path.join(scope.worktree, "short-lines.txt")
    const snapshot = store.record(scope, file, "short-lines.txt", decodeUtf8(Buffer.from("\n".repeat(200))), [])
    expect(store.get(scope, file, snapshot.id)).toBeUndefined()
  })

  it("accounts for seen-line sets in the snapshot budget", () => {
    const store = new ScopedSnapshotStore({ maxBytes: 1000 })
    const scope = { sessionId: "review", worktree: process.cwd() }
    const file = path.join(scope.worktree, "seen.txt")
    const snapshot = store.record(scope, file, "seen.txt", decodeUtf8(Buffer.from("x\n".repeat(100))), Array.from({ length: 100 }, (_, i) => i + 1))
    expect(store.get(scope, file, snapshot.id)).toBeUndefined()
  })

  it("rejects host versions outside the supported range", () => {
    expect(() => integratedHostVersion("1.17.99", "1.2.0")).toThrow(/unsupported/i)
    expect(() => integratedHostVersion("2.0.0", "1.2.0")).toThrow(/unsupported/i)
  })

  it("recognizes existing hosts with historical integration suffixes", () => {
    expect(supportsOpenCodeVersion("1.18.34+patchline.1.1.0+target.0.5.0")).toBe(true)
    expect(supportsOpenCodeVersion("1.18.34+patchline.1.2.0")).toBe(true)
    expect(supportsOpenCodeVersion("1.18.34-beta.1")).toBe(false)
  })

  it("returns the digest with the prepared line index", () => {
    const store = new ScopedSnapshotStore()
    const document = decodeUtf8(Buffer.from("line\n"))
    expect(store.getOrBuildLineIndex(document)).toHaveProperty("rawDigest", digestBytes(document.bytes))
  })
})
