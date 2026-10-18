import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { EditService } from "../src/edit-service.js"
import { encodeUtf8 } from "../src/preservation/text.js"
import { isFileReadResult, ReadService } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { parseConfig } from "../src/config.js"
import { buildLineIndex, sliceIndexedLines } from "../src/preservation/line-index.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("read and exact edit", () => {
  it("explains how to recover from conflicting read selectors without creating a snapshot", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "pricing.mjs"), "header\ndiscountedPrice\ntail\n")
      const snapshots = new ScopedSnapshotStore()
      const reads = new ReadService(snapshots)
      const scope = { sessionId: "s", worktree: workspace.path, filePath: "pricing.mjs" }
      await expect(reads.read({ ...scope, anchor: "discountedPrice", offset: 1, limit: 1 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT", writes: 0,
        message: expect.stringContaining("omit offset entirely"),
      })
      expect(snapshots.size).toBe(0)
      const recovered = await reads.read({ ...scope, anchor: "discountedPrice", limit: 1 })
      expect(recovered.offset).toBe(2)
      expect(recovered.output).toContain("2:discountedPrice")
      expect(recovered.output).not.toContain("tail")
      expect(await readFile(path.join(workspace.path, "pricing.mjs"), "utf8")).toBe("header\ndiscountedPrice\ntail\n")
    } finally { await workspace.cleanup() }
  })
  it("returns bounded line candidates for ambiguous anchors without authorizing edits", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "candidates.ts"), Array.from({ length: 100 }, () => "needle").join("\n"))
      const snapshots = new ScopedSnapshotStore()
      const reads = new ReadService(snapshots)
      const scope = { sessionId: "s", worktree: workspace.path, filePath: "candidates.ts" }
      await expect(reads.read({ ...scope, anchor: "needle" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT", writes: 0,
        details: { candidates: [1, 2, 3, 4, 5, 6, 7, 8], truncated: true },
        message: expect.stringContaining("1, 2, 3, 4, 5, 6, 7, 8"),
      })
      expect(snapshots.size).toBe(0)
      await writeFile(path.join(workspace.path, "candidates.ts"), "needle\nother\nneedle\n")
      await expect(reads.read({ ...scope, anchor: "needle" })).rejects.toMatchObject({ details: { candidates: [1, 3], truncated: false } })
      expect(snapshots.size).toBe(0)
      const read = await reads.read({ ...scope, offset: 2, limit: 1 })
      if (!isFileReadResult(read)) throw new Error("Expected file")
      await expect(reads.read({ ...scope, anchor: "needle" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(new EditService(snapshots).edit({ ...scope, snapshot: read.snapshot, exact: { oldString: "needle", newString: "changed", replaceAll: true } })).rejects.toMatchObject({ code: "INVALID_ANCHOR", writes: 0 })
      expect(await readFile(path.join(workspace.path, "candidates.ts"), "utf8")).toBe("needle\nother\nneedle\n")
    } finally { await workspace.cleanup() }
  })
  it("counts overlapping and same-line anchor occurrences independently at the candidate cap", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "candidates.ts")
      const snapshots = new ScopedSnapshotStore()
      const reads = new ReadService(snapshots)
      const scope = { sessionId: "s", worktree: workspace.path, filePath: "candidates.ts" }
      for (const count of [2, 8, 9]) {
        await writeFile(file, "a".repeat(count + 1))
        await expect(reads.read({ ...scope, anchor: "aa" })).rejects.toMatchObject({ details: { candidates: Array(Math.min(count, 8)).fill(1), truncated: count > 8 } })
      }
      await expect(reads.read({ ...scope, anchor: "absent" })).rejects.toMatchObject({ details: { candidates: [], truncated: false } })
      expect(snapshots.size).toBe(0)
    } finally { await workspace.cleanup() }
  })
  it("reads from a unique literal anchor and authorizes only the returned range", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "anchor.ts"), "const hidden = 1\r\n// needle.*\r\nconst shown = 2\r\nconst tail = 3\r\n")
      const snapshots = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: workspace.path, filePath: "anchor.ts" }
      const result = await new ReadService(snapshots).read({ ...scope, anchor: "needle.*", limit: 2 })
      if (result.kind !== "file") throw new Error("Expected file")
      expect(result.offset).toBe(2)
      expect(result.endLine).toBe(3)
      expect(result.output).toContain("2:// needle.*\n3:const shown = 2")
      expect(result.output).not.toContain("const hidden")
      const edits = new EditService(snapshots)
      await expect(edits.edit({ ...scope, snapshot: result.snapshot, exact: { oldString: "const hidden = 1", newString: "const hidden = 9" } })).rejects.toMatchObject({ code: "INVALID_ANCHOR" })
      await edits.edit({ ...scope, snapshot: result.snapshot, exact: { oldString: "const shown = 2", newString: "const shown = 4" } })
      expect(await readFile(path.join(workspace.path, "anchor.ts"), "utf8")).toBe("const hidden = 1\r\n// needle.*\r\nconst shown = 4\r\nconst tail = 3\r\n")
    } finally { await workspace.cleanup() }
  })

  it("rejects missing, ambiguous, empty, conflicting, and directory anchors", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "anchor.ts"), "repeat repeat\nlast\n")
      const reads = new ReadService(new ScopedSnapshotStore())
      const scope = { sessionId: "s", worktree: workspace.path, filePath: "anchor.ts" }
      for (const request of [{ anchor: "absent" }, { anchor: "repeat" }, { anchor: "" }, { anchor: "last", offset: 1 }]) {
        await expect(reads.read({ ...scope, ...request })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      }
      await expect(reads.read({ ...scope, filePath: ".", anchor: "last" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally { await workspace.cleanup() }
  })

  it("indexes normalized lines without materializing the whole line array", () => {
    const text = "first\nsecond\nthird"
    const index = buildLineIndex(text)

    expect(index.totalLines).toBe(3)
    expect(index.endsWithNewline).toBe(false)
    expect(sliceIndexedLines(text, index, 2, 2)).toEqual(["second", "third"])
  })

  it("handles a trailing newline without creating an empty source line", () => {
    const text = "first\nsecond\n"
    const index = buildLineIndex(text)

    expect(index.totalLines).toBe(2)
    expect(index.endsWithNewline).toBe(true)
    expect(sliceIndexedLines(text, index, 1, 2)).toEqual(["first", "second"])
  })
  it("applies the current oh-my-pi PUT format through the snapshot contract", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "hashline.ts")
      await writeFile(file, "const first = 1\nconst second = 2\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "hashline.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")

      const result = await new EditService(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "hashline.ts",
        snapshot: observed.snapshot,
        hashlinePatch: `[hashline.ts#${observed.tag}]\nPUT 2.=2:\n+const second = 20`,
      })

      expect(result.path).toBe("hashline.ts")
      expect(await readFile(file, "utf8")).toBe("const first = 1\nconst second = 20\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("preserves every UTF-16 source-line offset across newline and Unicode combinations", () => {
    const fragments = ["", "a", "\n", "\r", "😀", "\n\n", "x\r\n"]
    for (const first of fragments) for (const second of fragments) for (const third of fragments) {
      const text = first + second + third
      const starts = text.length ? [0] : []
      for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) === 10 && at + 1 < text.length) starts.push(at + 1)
      const index = buildLineIndex(text)
      expect(index).toEqual({ starts, totalLines: starts.length, endsWithNewline: text.endsWith("\n") })
      const expected = text === "" ? [] : text.split("\n")
      if (text.endsWith("\n")) expected.pop()
      expect(sliceIndexedLines(text, index, 1, index.totalLines)).toEqual(expected)
    }
  })

  it("rejects changed live content when the upstream Hashline runtime is unavailable", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "recovery.ts")
      await writeFile(file, "const outside = 1\nconst target = 2\nconst tail = 3\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "recovery.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")
      await writeFile(file, "const outside = 10\nconst target = 2\nconst tail = 3\n")

      await expect(new EditService(snapshots, parseConfig({ hashlineRecovery: true })).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "recovery.ts",
        snapshot: observed.snapshot,
        hashlinePatch: `[recovery.ts#${observed.tag}]\nPUT 2.=2:\n+const target = 20`,
      })).rejects.toMatchObject({ code: "STALE_SNAPSHOT", writes: 0 })
      expect(await readFile(file, "utf8")).toBe("const outside = 10\nconst target = 2\nconst tail = 3\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("preserves absent final newline when inserting after a Hashline anchor", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "no-newline.ts")
      await writeFile(file, "first\nsecond")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "no-newline.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")
      await new EditService(snapshots).edit({ sessionId: "s", worktree: workspace.path, filePath: "no-newline.ts", snapshot: observed.snapshot,
        hashlinePatch: `[no-newline.ts#${observed.tag}]\nPUT >$:\n+third` })
      expect(await readFile(file, "utf8")).toBe("first\nsecond\nthird")
    } finally {
      await workspace.cleanup()
    }
  })

  it("inserts into an empty file without an extra newline", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "empty-hashline.ts")
      await writeFile(file, "")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "empty-hashline.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")
      await new EditService(snapshots).edit({ sessionId: "s", worktree: workspace.path, filePath: "empty-hashline.ts", snapshot: observed.snapshot,
        hashlinePatch: `[empty-hashline.ts#${observed.tag}]\nPUT >$:\n+first` })
      expect(await readFile(file, "utf8")).toBe("first")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects overlapping Hashline ranges before writing", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "overlap.ts")
      await writeFile(file, "first\nsecond\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "overlap.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")
      await expect(new EditService(snapshots).edit({ sessionId: "s", worktree: workspace.path, filePath: "overlap.ts", snapshot: observed.snapshot,
        hashlinePatch: `[overlap.ts#${observed.tag}]\nPUT 1.=2:\n+changed\nPUT 2.=2:\n+other` })).rejects.toMatchObject({ code: "PATCH_PREFLIGHT_FAILED", writes: 0 })
      expect(await readFile(file, "utf8")).toBe("first\nsecond\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects malformed and unseen Hashline anchors before writing", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "anchors.ts")
      await writeFile(file, "one\ntwo\nthree\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "anchors.ts", limit: 1 })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")
      const edit = (patch: string) => new EditService(snapshots).edit({ sessionId: "s", worktree: workspace.path, filePath: "anchors.ts", snapshot: observed.snapshot, hashlinePatch: `[anchors.ts#${observed.tag}]\n${patch}` })
      await expect(edit("PUT 2.=2:\n+changed")).rejects.toMatchObject({ code: "INVALID_ANCHOR", writes: 0 })
      await expect(edit("PUT 1.=1:\n+changed\n[other.ts#ABCD]\nCUT 1.=1")).rejects.toMatchObject({ code: "PATCH_PREFLIGHT_FAILED", writes: 0 })
      await expect(edit("CUT 1.=1:\n+unexpected")).rejects.toMatchObject({ code: "PATCH_PREFLIGHT_FAILED", writes: 0 })
      expect(await readFile(file, "utf8")).toBe("one\ntwo\nthree\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects malformed CUT bodies and empty or repeated Hashline sections", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "strict.ts")
      await writeFile(file, "one\ntwo\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "strict.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")
      const edit = (patch: string) => new EditService(snapshots).edit({ sessionId: "s", worktree: workspace.path, filePath: "strict.ts", snapshot: observed.snapshot, hashlinePatch: `[strict.ts#${observed.tag}]\n${patch}` })
      for (const patch of ["CUT 1.=1:\n+injected", "PUT 1.=1:", "PUT 1.=1:\n+first\n[strict.ts#0000]\nCUT 2.=2", "", "PUT 1.=1:\n+first\nPUT 1.=1:\n+again"]) {
        await expect(edit(patch)).rejects.toMatchObject({ code: "PATCH_PREFLIGHT_FAILED", writes: 0 })
      }
      expect(await readFile(file, "utf8")).toBe("one\ntwo\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects oversized files before recording a snapshot", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "oversized.ts"), `const value = 1\n${" ".repeat(10 * 1024 * 1024)}`)
      const snapshots = new ScopedSnapshotStore()

      await expect(new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "oversized.ts" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        path: "oversized.ts",
      })
      expect(snapshots.size).toBe(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects a selected source line that exceeds the read output budget", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "long-line.ts"), `const value = "${"x".repeat(25_000)}"\n`)
      const snapshots = new ScopedSnapshotStore()

      await expect(new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "long-line.ts" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        path: "long-line.ts",
      })
      expect(snapshots.size).toBe(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects directories that exceed the enumeration budget", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await mkdir(path.join(workspace.path, "large-directory"))
      await Promise.all(Array.from({ length: 4_097 }, (_, index) => writeFile(path.join(workspace.path, "large-directory", `file-${index}.ts`), "")))

      await expect(new ReadService(new ScopedSnapshotStore()).read({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "large-directory",
      })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        path: "large-directory",
      })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects a directory page that exceeds the read output budget", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await mkdir(path.join(workspace.path, "long-directory"))
      await Promise.all(Array.from({ length: 120 }, (_, index) => writeFile(path.join(workspace.path, "long-directory", `${String(index).padStart(3, "0")}-${"x".repeat(240)}.ts`), "")))

      await expect(new ReadService(new ScopedSnapshotStore()).read({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "long-directory",
      })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        path: "long-directory",
      })
    } finally {
      await workspace.cleanup()
    }
  })

  it("returns a bounded page and marks only displayed lines as observed", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "wide-page.ts"), `${Array.from({ length: 120 }, (_, index) => `${String(index).padStart(3, "0")}:${"x".repeat(200)}`).join("\n")}\n`)
      const snapshots = new ScopedSnapshotStore()

      const result = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "wide-page.ts" })
      if (!isFileReadResult(result)) throw new Error("Expected file read")
      expect(result.output.length).toBeLessThanOrEqual(20_000)
      expect(result.endLine).toBeLessThan(120)
      expect(result.nextOffset).toBe(result.endLine + 1)
      const snapshot = snapshots.get({ sessionId: "s", worktree: workspace.path }, path.join(workspace.path, "wide-page.ts"), result.snapshot)!
      expect(snapshot.seenLines.has(result.endLine)).toBe(true)
      expect(snapshot.seenLines.has(result.endLine + 1)).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it("counts the actual path and metadata when bounding file read output", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const directory = "d".repeat(180)
      const filePath = `${directory}/file.ts`
      await mkdir(path.join(workspace.path, directory))
      await writeFile(path.join(workspace.path, filePath), `${Array.from({ length: 120 }, (_, index) => `${String(index).padStart(3, "0")}:${"x".repeat(180)}`).join("\n")}\n`)
      const snapshots = new ScopedSnapshotStore()

      const result = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath })
      if (!isFileReadResult(result)) throw new Error("Expected file read")
      expect(result.output.length).toBeLessThanOrEqual(20_000)
      expect(result.endLine).toBeLessThan(120)
      expect(snapshots.size).toBe(1)
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects an oversized exact edit before preparing replacement bytes", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "edit.ts"), "const value = 1\n")
      const snapshots = new ScopedSnapshotStore()
      const read = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "edit.ts" })
      if (!isFileReadResult(read)) throw new Error("expected file result")

      await expect(new EditService(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "edit.ts",
        snapshot: read.snapshot,
        exact: { oldString: "1", newString: "x".repeat(8 * 1024 * 1024 + 1) },
      })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      expect(await readFile(path.join(workspace.path, "edit.ts"), "utf8")).toBe("const value = 1\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("preserves the built-in read contract for directories without creating a snapshot", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await mkdir(path.join(workspace.path, "src"))
      await mkdir(path.join(workspace.path, "src", "nested"))
      await writeFile(path.join(workspace.path, "src", "a.ts"), "export {}\n")
      const snapshots = new ScopedSnapshotStore()
      const result = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "src" })

      expect(result.kind).toBe("directory")
      expect(result.output).toContain("a.ts")
      expect(result.output).toContain("nested/")
      expect(result).not.toHaveProperty("snapshot")
      expect(snapshots.size).toBe(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it("reports an empty file with zero source lines", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "empty.ts"), "")
      const snapshots = new ScopedSnapshotStore()
      const result = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "empty.ts" })

      expect(result.kind).toBe("file")
      if (!isFileReadResult(result)) throw new Error("Expected file read")
      expect(result.totalLines).toBe(0)
      expect(result.output).toContain("Range: 1-0 of 0")
    } finally {
      await workspace.cleanup()
    }
  })

  it("honors explicit file read limits independently of the initial range", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "bounded.ts"), "one\ntwo\nthree\nfour\n")
      const result = await new ReadService(new ScopedSnapshotStore(), 2).read({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "bounded.ts",
        limit: 100,
      })

      if (!isFileReadResult(result)) throw new Error("Expected file read")
      expect(result.endLine).toBe(4)
      expect(result.output).toContain("3:three")
    } finally {
      await workspace.cleanup()
    }
  })

  it("caps explicit directory read limits at the configured initial range", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "a\n")
      await writeFile(path.join(workspace.path, "b.ts"), "b\n")
      await writeFile(path.join(workspace.path, "c.ts"), "c\n")
      const result = await new ReadService(new ScopedSnapshotStore(), 2).read({
        sessionId: "s",
        worktree: workspace.path,
        filePath: ".",
        limit: 100,
      })

      if (result.kind !== "directory") throw new Error("Expected directory read")
      expect(result.endEntry).toBe(2)
      expect(result.totalEntries).toBe(3)
      expect(result.truncated).toBe(true)
      expect(result.output).toContain("Use offset=3 to continue.")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects an out-of-range offset for an empty directory", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(new ReadService(new ScopedSnapshotStore()).read({
        sessionId: "s",
        worktree: workspace.path,
        filePath: ".",
        offset: 2,
      })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects invalid direct read bounds instead of silently clamping them", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "bounds.ts"), "one\ntwo\n")
      const reader = new ReadService(new ScopedSnapshotStore())

      await expect(reader.read({ sessionId: "s", worktree: workspace.path, filePath: "bounds.ts", offset: 0 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(reader.read({ sessionId: "s", worktree: workspace.path, filePath: "bounds.ts", offset: 1.5 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(reader.read({ sessionId: "s", worktree: workspace.path, filePath: "bounds.ts", limit: 0 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(reader.read({ sessionId: "s", worktree: workspace.path, filePath: "bounds.ts", limit: 2.5 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("changes exactly one line in a large file", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "large.ts")
      const lines = Array.from({ length: 3_000 }, (_, index) => index === 1499 ? "const timeout = 5000" : `// line ${index + 1}`)
      await writeFile(file, `${lines.join("\n")}\n`)
      const snapshots = new ScopedSnapshotStore()
      const read = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "large.ts", offset: 1490, limit: 30 })
      if (!isFileReadResult(read)) throw new Error("Expected file read")
      const result = await new EditService(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "large.ts",
        snapshot: read.snapshot,
        exact: { oldString: "const timeout = 5000", newString: "const timeout = 10000" },
      })
      expect(result).toMatchObject({ added: 1, deleted: 1 })
      const changed = await readFile(file, "utf8")
      expect(changed.split("\n").filter((line) => line.includes("timeout"))).toEqual(["const timeout = 10000"])
      expect(changed.replace("10000", "5000")).toBe(`${lines.join("\n")}\n`)

      const next = await new EditService(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "large.ts",
        snapshot: result.snapshot,
        exact: { oldString: "const timeout = 10000", newString: "const timeout = 15000" },
      })
      expect(next.snapshot).not.toBe(result.snapshot)
      expect(await readFile(file, "utf8")).toContain("const timeout = 15000")
    } finally {
      await workspace.cleanup()
    }
  })

  it("preserves CRLF and BOM during edit", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "bom.ts")
      await writeFile(file, encodeUtf8("const timeout = 5000\r\nexport {}\r\n", true))
      const snapshots = new ScopedSnapshotStore()
      const read = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "bom.ts" })
      if (!isFileReadResult(read)) throw new Error("Expected file read")
      await new EditService(snapshots).edit({ sessionId: "s", worktree: workspace.path, filePath: "bom.ts", snapshot: read.snapshot, exact: { oldString: "5000", newString: "10000" } })
      const bytes = await readFile(file)
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      expect(bytes.toString("utf8")).toBe("﻿const timeout = 10000\r\nexport {}\r\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects editing lines that were not observed", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "a.ts")
      await writeFile(file, "one\ntwo\nthree\n")
      const snapshots = new ScopedSnapshotStore()
      const read = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "a.ts", offset: 1, limit: 1 })
      if (!isFileReadResult(read)) throw new Error("Expected file read")
      await expect(new EditService(snapshots).edit({ sessionId: "s", worktree: workspace.path, filePath: "a.ts", snapshot: read.snapshot, exact: { oldString: "three", newString: "changed" } })).rejects.toMatchObject({ code: "INVALID_ANCHOR" })
      expect(await readFile(file, "utf8")).toBe("one\ntwo\nthree\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not mark unrelated lines observed after an edit", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "scope.ts")
      await writeFile(file, "one\ntwo\nthree\n")
      const snapshots = new ScopedSnapshotStore()
      const reader = new ReadService(snapshots)
      const observed = await reader.read({ sessionId: "s", worktree: workspace.path, filePath: "scope.ts", offset: 1, limit: 1 })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")
      const editor = new EditService(snapshots)
      const first = await editor.edit({ sessionId: "s", worktree: workspace.path, filePath: "scope.ts", snapshot: observed.snapshot, exact: { oldString: "one", newString: "changed" } })
      await expect(editor.edit({ sessionId: "s", worktree: workspace.path, filePath: "scope.ts", snapshot: first.snapshot, exact: { oldString: "three", newString: "hidden" } })).rejects.toMatchObject({ code: "INVALID_ANCHOR" })
      expect(await readFile(file, "utf8")).toBe("changed\ntwo\nthree\n")
    } finally {
      await workspace.cleanup()
    }
  })
})
