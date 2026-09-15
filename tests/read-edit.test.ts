import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { EditService } from "../src/edit-service.js"
import { encodeUtf8 } from "../src/preservation/text.js"
import { isFileReadResult, ReadService } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("read and exact edit", () => {
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

  it("rejects a file page whose rendered output exceeds the read output budget", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "wide-page.ts"), `${Array.from({ length: 120 }, (_, index) => `${String(index).padStart(3, "0")}:${"x".repeat(200)}`).join("\n")}\n`)
      const snapshots = new ScopedSnapshotStore()

      await expect(new ReadService(snapshots).read({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "wide-page.ts",
      })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        path: "wide-page.ts",
      })
      expect(snapshots.size).toBe(0)
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

      await expect(new ReadService(snapshots).read({
        sessionId: "s",
        worktree: workspace.path,
        filePath,
      })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      expect(snapshots.size).toBe(0)
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

  it("caps explicit file read limits at the configured initial range", async () => {
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
      expect(result.endLine).toBe(2)
      expect(result.output).toContain("More content is available after line 2.")
      expect(result.output).not.toContain("3:three")
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
