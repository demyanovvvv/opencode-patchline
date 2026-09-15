import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { EditService } from "../src/edit-service.js"
import { PatchlineError } from "../src/errors.js"
import { isFileReadResult, ReadService } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("stale-state protection", () => {
  it("rejects an oversized edit batch before snapshot or path preflight", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(new EditService(new ScopedSnapshotStore()).editBatch(Array.from({ length: 501 }, (_, index) => ({
        sessionId: "s",
        worktree: workspace.path,
        filePath: `missing-${index}.ts`,
        snapshot: "missing",
        exact: { oldString: "1", newString: "2" },
      })))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not overwrite an external change inside the target", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "timeout.ts")
      await writeFile(file, "const timeout = 5000\n")
      const snapshots = new ScopedSnapshotStore()
      const read = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "timeout.ts" })
      if (!isFileReadResult(read)) throw new Error("Expected file read")
      await writeFile(file, "const timeout = getTimeout()\n")

      await expect(new EditService(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "timeout.ts",
        snapshot: read.snapshot,
        exact: { oldString: "5000", newString: "10000" },
      })).rejects.toMatchObject({ code: "STALE_SNAPSHOT", writes: 0 })
      expect(await readFile(file, "utf8")).toBe("const timeout = getTimeout()\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects a replacement file even when its bytes match the snapshot", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const target = path.join(workspace.path, "target.ts")
      const original = path.join(workspace.path, "original.ts")
      const replacement = path.join(workspace.path, "replacement.ts")
      await writeFile(target, "value = 1\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "target.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")
      await writeFile(replacement, "value = 1\n")
      await rename(target, original)
      await rename(replacement, target)

      await expect(new EditService(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "target.ts",
        snapshot: observed.snapshot,
        exact: { oldString: "1", newString: "2" },
      })).rejects.toMatchObject({ code: "STALE_SNAPSHOT", writes: 0 })
      expect(await readFile(target, "utf8")).toBe("value = 1\n")
      expect(await readFile(original, "utf8")).toBe("value = 1\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not trust a same-byte replacement made before the next snapshot is recorded", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const target = path.join(workspace.path, "target.ts")
      const landed = path.join(workspace.path, "target.patchline.ts")
      await writeFile(target, "value = 1\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "target.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")

      class ReplacingEditor extends EditService {
        override async writePreparedFile(prepared: Parameters<EditService["writePreparedFile"]>[0]) {
          const result = await super.writePreparedFile(prepared)
          await rename(target, landed)
          await writeFile(target, "value = 2\n")
          return result
        }
      }

      const edited = await new ReplacingEditor(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "target.ts",
        snapshot: observed.snapshot,
        exact: { oldString: "1", newString: "2" },
      })

      await expect(new EditService(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "target.ts",
        snapshot: edited.snapshot,
        exact: { oldString: "2", newString: "3" },
      })).rejects.toMatchObject({ code: "STALE_SNAPSHOT", writes: 0 })
      expect(await readFile(target, "utf8")).toBe("value = 2\n")
      expect(await readFile(landed, "utf8")).toBe("value = 2\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not write any file when a later batch preflight is stale", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const first = path.join(workspace.path, "first.ts")
      const second = path.join(workspace.path, "second.ts")
      await writeFile(first, "first = 1\n")
      await writeFile(second, "second = 1\n")
      const snapshots = new ScopedSnapshotStore()
      const reader = new ReadService(snapshots)
      const firstRead = await reader.read({ sessionId: "s", worktree: workspace.path, filePath: "first.ts" })
      const secondRead = await reader.read({ sessionId: "s", worktree: workspace.path, filePath: "second.ts" })
      if (!isFileReadResult(firstRead) || !isFileReadResult(secondRead)) throw new Error("Expected file reads")
      await writeFile(second, "second = external\n")
      const editor = new EditService(snapshots)
      await expect(editor.editBatch([
        { sessionId: "s", worktree: workspace.path, filePath: "first.ts", snapshot: firstRead.snapshot, exact: { oldString: "1", newString: "2" } },
        { sessionId: "s", worktree: workspace.path, filePath: "second.ts", snapshot: secondRead.snapshot, exact: { oldString: "1", newString: "2" } },
      ])).rejects.toMatchObject({ code: "STALE_SNAPSHOT" })
      expect(await readFile(first, "utf8")).toBe("first = 1\n")
      expect(await readFile(second, "utf8")).toBe("second = external\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not roll back over an external change made after an earlier commit", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const first = path.join(workspace.path, "first.ts")
      const second = path.join(workspace.path, "second.ts")
      await writeFile(first, "first = 1\n")
      await writeFile(second, "second = 1\n")
      const snapshots = new ScopedSnapshotStore()
      const reader = new ReadService(snapshots)
      const firstRead = await reader.read({ sessionId: "s", worktree: workspace.path, filePath: "first.ts" })
      const secondRead = await reader.read({ sessionId: "s", worktree: workspace.path, filePath: "second.ts" })
      if (!isFileReadResult(firstRead) || !isFileReadResult(secondRead)) throw new Error("Expected file reads")

      class FailingBatchEditor extends EditService {
        private commits = 0

        override async commit(prepared: Parameters<EditService["commit"]>[0]) {
          this.commits++
          if (this.commits === 2) {
            await writeFile(first, "first = external\n")
            throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "forced batch failure")
          }
          return super.commit(prepared)
        }
      }

      await expect(new FailingBatchEditor(snapshots).editBatch([
        { sessionId: "s", worktree: workspace.path, filePath: "first.ts", snapshot: firstRead.snapshot, exact: { oldString: "1", newString: "2" } },
        { sessionId: "s", worktree: workspace.path, filePath: "second.ts", snapshot: secondRead.snapshot, exact: { oldString: "1", newString: "2" } },
      ])).rejects.toMatchObject({ code: "TRANSACTION_FAILED", details: { conflicts: ["first.ts"] } })

      expect(await readFile(first, "utf8")).toBe("first = external\n")
      expect(await readFile(second, "utf8")).toBe("second = 1\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not roll back over a same-byte replacement made before restore", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const first = path.join(workspace.path, "first.ts")
      const second = path.join(workspace.path, "second.ts")
      await writeFile(first, "first = 1\n")
      await writeFile(second, "second = 1\n")
      const snapshots = new ScopedSnapshotStore()
      const reader = new ReadService(snapshots)
      const firstRead = await reader.read({ sessionId: "s", worktree: workspace.path, filePath: "first.ts" })
      const secondRead = await reader.read({ sessionId: "s", worktree: workspace.path, filePath: "second.ts" })
      if (!isFileReadResult(firstRead) || !isFileReadResult(secondRead)) throw new Error("Expected file reads")

      class FailingBatchEditor extends EditService {
        private commits = 0

        override async commit(prepared: Parameters<EditService["commit"]>[0]) {
          this.commits++
          if (this.commits === 2) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "forced batch failure")
          return super.commit(prepared)
        }

        override async restorePreparedFile(prepared: Parameters<EditService["restorePreparedFile"]>[0]) {
          await rename(first, `${first}.replacement`)
          await writeFile(first, "first = 2\n")
          return super.restorePreparedFile(prepared)
        }
      }

      await expect(new FailingBatchEditor(snapshots).editBatch([
        { sessionId: "s", worktree: workspace.path, filePath: "first.ts", snapshot: firstRead.snapshot, exact: { oldString: "1", newString: "2" } },
        { sessionId: "s", worktree: workspace.path, filePath: "second.ts", snapshot: secondRead.snapshot, exact: { oldString: "1", newString: "2" } },
      ])).rejects.toMatchObject({ code: "TRANSACTION_FAILED", details: { conflicts: ["first.ts"] } })

      expect(await readFile(first, "utf8")).toBe("first = 2\n")
      expect(await readFile(`${first}.replacement`, "utf8")).toBe("first = 2\n")
      expect(await readFile(second, "utf8")).toBe("second = 1\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects a symlink target swap between preflight and commit", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const target = path.join(workspace.path, "target.ts")
      const replacement = path.join(workspace.path, "replacement.ts")
      const outsideFile = path.join(outside.path, "outside.ts")
      await writeFile(target, "value = 1\n")
      await writeFile(outsideFile, "outside = true\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "target.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")

      class SwappingEditor extends EditService {
        override async commit(prepared: Parameters<EditService["commit"]>[0]) {
          await rename(target, replacement)
          try {
            await symlink(outsideFile, target, "file")
          } catch {
            await rename(replacement, target)
            throw new PatchlineError("CAPABILITY_UNAVAILABLE", "File symlink creation is unavailable")
          }
          return super.commit(prepared)
        }
      }

      await expect(new SwappingEditor(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "target.ts",
        snapshot: observed.snapshot,
        exact: { oldString: "1", newString: "3" },
      })).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" })
      expect(await readFile(outsideFile, "utf8")).toBe("outside = true\n")
    } finally {
      await workspace.cleanup()
      await outside.cleanup()
    }
  })

  it("rejects a target symlink swapped inside atomic replacement", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const target = path.join(workspace.path, "target.ts")
      const replacement = path.join(workspace.path, "replacement.ts")
      const outsideFile = path.join(outside.path, "outside.ts")
      await writeFile(target, "value = 1\n")
      await writeFile(outsideFile, "outside = true\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "target.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")

      class SwappingWriter extends EditService {
        override async writePreparedFile(prepared: Parameters<EditService["writePreparedFile"]>[0]) {
          await rename(target, replacement)
          try {
            await symlink(outsideFile, target, "file")
          } catch {
            await rename(replacement, target)
            throw new PatchlineError("CAPABILITY_UNAVAILABLE", "File symlink creation is unavailable")
          }
          return super.writePreparedFile(prepared)
        }
      }

      await expect(new SwappingWriter(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "target.ts",
        snapshot: observed.snapshot,
        exact: { oldString: "1", newString: "3" },
      })).rejects.toMatchObject({ code: "STALE_SNAPSHOT", writes: 0 })
      expect(await readFile(outsideFile, "utf8")).toBe("outside = true\n")
      expect(await readFile(replacement, "utf8")).toBe("value = 1\n")
      expect(await readFile(target, "utf8")).toBe("outside = true\n")
    } finally {
      await workspace.cleanup()
      await outside.cleanup()
    }
  })

  it("rejects a parent directory swap before atomic replacement", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const parent = path.join(workspace.path, "src")
      const movedParent = path.join(workspace.path, "src-original")
      const outsideParent = path.join(outside.path, "src")
      const target = path.join(parent, "target.ts")
      await mkdir(parent)
      await mkdir(outsideParent)
      await writeFile(target, "value = 1\n")
      const snapshots = new ScopedSnapshotStore()
      const observed = await new ReadService(snapshots).read({ sessionId: "s", worktree: workspace.path, filePath: "src/target.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file read")

      class SwappingWriter extends EditService {
        override async writePreparedFile(prepared: Parameters<EditService["writePreparedFile"]>[0]) {
          await rename(parent, movedParent)
          try {
            await symlink(outsideParent, parent, "junction")
          } catch {
            await rename(movedParent, parent)
            throw new PatchlineError("CAPABILITY_UNAVAILABLE", "Directory junction creation is unavailable")
          }
          return super.writePreparedFile(prepared)
        }
      }

      await expect(new SwappingWriter(snapshots).edit({
        sessionId: "s",
        worktree: workspace.path,
        filePath: "src/target.ts",
        snapshot: observed.snapshot,
        exact: { oldString: "1", newString: "2" },
      })).rejects.toMatchObject({ code: "STALE_SNAPSHOT", writes: 0 })
      expect(await readFile(path.join(movedParent, "target.ts"), "utf8")).toBe("value = 1\n")
      await expect(readFile(path.join(outsideParent, "target.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
      await outside.cleanup()
    }
  })
})
