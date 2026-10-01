import { readFile, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditService } from "../src/edit-service.js"
import { ReadService, isFileReadResult } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

const restoreRace = vi.hoisted(() => ({ target: "" }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (args[1] === restoreRace.target) await fs.writeFile(restoreRace.target, "external\n")
      return fs.rename(...args)
    },
    link: async (...args: Parameters<typeof fs.link>) => {
      if (args[1] === restoreRace.target) await fs.writeFile(restoreRace.target, "external\n")
      return fs.link(...args)
    },
  }
})
afterEach(() => { restoreRace.target = "" })

vi.mock("../src/editing/hashline-adapter.js", () => ({
  parseHashlinePatch: async (patch: string) => [...patch.matchAll(/\[([^#]+)#([A-F0-9]{4})\]\n(REM|MV ([^\n]+)|PUT)/g)].map((match) => ({
    path: match[1], tag: match[2], patch: match[0],
    ...(match[3] === "REM" ? { fileOp: { kind: "rem" } } : match[4] ? { fileOp: { kind: "move", dest: match[4] } } : {}),
  })),
  applyHashlineBatchInMemory: async (snapshots: Array<{ relativePath: string; text: string }>, patch: string) => ({
    results: snapshots.map((snapshot) => {
      const body = patch.split(`[${snapshot.relativePath}#`)[1]!.split("]\n")[1]!.split("\n[")[0]!
      const moveDest = body.startsWith("MV ") ? body.slice(3) : undefined
      return { path: moveDest ?? snapshot.relativePath, sourcePath: snapshot.relativePath, op: body === "REM" ? "delete" : "update", text: snapshot.text, warnings: [], ...(moveDest ? { moveDest } : {}) }
    }),
    publish() {},
  }),
  applyHashlineInMemory: async () => { throw new Error("Unexpected single-file adapter") },
}))

describe("guarded Hashline file transactions", () => {
  it("preserves a source recreated after rollback preflight", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      const target = path.join(workspace.path, "source.ts")
      await writeFile(target, "source\n")
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "source.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      class FailingService extends EditService {
        override async commit(prepared: Parameters<EditService["commit"]>[0]): ReturnType<EditService["commit"]> {
          await super.commit(prepared)
          throw new Error("forced rollback race")
        }
        override async restorePreparedFile(prepared: Parameters<EditService["restorePreparedFile"]>[0]): ReturnType<EditService["restorePreparedFile"]> {
          restoreRace.target = target
          return super.restorePreparedFile(prepared)
        }
      }
      await expect(new FailingService(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[source.ts#${observed.tag}]\nREM`)).rejects.toMatchObject({ details: { restored: [], conflicts: ["source.ts"] }, writes: 1 })
      expect(await readFile(target, "utf8")).toBe("external\n")
    } finally { await workspace.cleanup() }
  })

  it.each(["REM", "MV moved.ts"])("rejects %s through a source symlink before any mutation", async (operation) => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      await writeFile(path.join(workspace.path, "real.ts"), "source\n")
      await symlink(path.join(workspace.path, "real.ts"), path.join(workspace.path, "alias.ts"))
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "alias.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      await expect(new EditService(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[alias.ts#${observed.tag}]\n${operation}`)).rejects.toMatchObject({ code: "SYMLINK_ESCAPE", writes: 0 })
      expect(await readFile(path.join(workspace.path, "alias.ts"), "utf8")).toBe("source\n")
      expect(await readFile(path.join(workspace.path, "real.ts"), "utf8")).toBe("source\n")
    } finally { await workspace.cleanup() }
  })
  it.each(["REM", "MV moved.ts"])("restores a landed %s when a later commit fails", async (operation) => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      const reads = new ReadService(store)
      const tags = []
      for (const filePath of ["first.ts", "second.ts"]) {
        await writeFile(path.join(workspace.path, filePath), `${filePath}\n`)
        const observed = await reads.read({ sessionId: "s", worktree: workspace.path, filePath })
        if (!isFileReadResult(observed)) throw new Error("Expected file")
        tags.push(observed.tag)
      }
      class FailingService extends EditService {
        override async commit(prepared: Parameters<EditService["commit"]>[0]): ReturnType<EditService["commit"]> {
          if (prepared.snapshot.relativePath === "second.ts") throw new Error("forced later failure")
          return super.commit(prepared)
        }
      }
      await expect(new FailingService(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[first.ts#${tags[0]}]\n${operation}\n[second.ts#${tags[1]}]\nREM`)).rejects.toMatchObject({
        code: "TRANSACTION_FAILED", writes: 1, details: { restored: ["first.ts"], conflicts: [] },
      })
      expect(await readFile(path.join(workspace.path, "first.ts"), "utf8")).toBe("first.ts\n")
      expect(await readFile(path.join(workspace.path, "second.ts"), "utf8")).toBe("second.ts\n")
      await expect(readFile(path.join(workspace.path, "moved.ts"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await workspace.cleanup() }
  })

  it("reports a rollback conflict when a moved destination changes externally", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      await writeFile(path.join(workspace.path, "source.ts"), "source\n")
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "source.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      class FailingService extends EditService {
        override async commit(prepared: Parameters<EditService["commit"]>[0]): ReturnType<EditService["commit"]> {
          await super.commit(prepared)
          if (prepared.destination) await writeFile(prepared.destination.absolute, "external\n")
          throw new Error("forced moved failure")
        }
      }
      await expect(new FailingService(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[source.ts#${observed.tag}]\nMV moved.ts`)).rejects.toMatchObject({ code: "TRANSACTION_FAILED", writes: 1, details: { restored: [], conflicts: ["source.ts"] } })
      expect(await readFile(path.join(workspace.path, "moved.ts"), "utf8")).toBe("external\n")
      await expect(readFile(path.join(workspace.path, "source.ts"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await workspace.cleanup() }
  })

  it("does not delete unrelated files inside a removal backup directory", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      await writeFile(path.join(workspace.path, "source.ts"), "source\n")
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "source.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      let external = ""
      class ExtraBackupFile extends EditService {
        override async commit(prepared: Parameters<EditService["commit"]>[0]): ReturnType<EditService["commit"]> {
          const result = await super.commit(prepared)
          external = path.join(path.dirname(prepared.backupPath!), "external.txt")
          await writeFile(external, "external\n")
          return result
        }
      }
      await new ExtraBackupFile(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[source.ts#${observed.tag}]\nREM`)
      expect(await readFile(external, "utf8")).toBe("external\n")
    } finally { await workspace.cleanup() }
  })

  it("preserves externally changed removal backups after a successful commit", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      await writeFile(path.join(workspace.path, "source.ts"), "source\n")
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "source.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      let backup = ""
      class ChangedBackup extends EditService {
        override async commit(prepared: Parameters<EditService["commit"]>[0]): ReturnType<EditService["commit"]> {
          const result = await super.commit(prepared)
          backup = prepared.backupPath!
          await writeFile(backup, "external\n")
          return result
        }
      }
      const result = await new ChangedBackup(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[source.ts#${observed.tag}]\nREM`)
      expect(await readFile(backup, "utf8")).toBe("external\n")
      expect(result[0]?.warnings).toEqual([expect.stringContaining("backup retained")])
    } finally { await workspace.cleanup() }
  })

  it("keeps applied file operations when temporary backup cleanup fails", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      await writeFile(path.join(workspace.path, "source.ts"), "source\n")
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "source.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      class CleanupFailure extends EditService {
        override async cleanupBackup(): Promise<void> { throw new Error("forced cleanup failure") }
      }
      const result = await new CleanupFailure(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[source.ts#${observed.tag}]\nMV moved.ts`)
      expect(result[0]?.warnings).toEqual([expect.stringContaining("backup retained")])
      expect(await readFile(path.join(workspace.path, "moved.ts"), "utf8")).toBe("source\n")
      await expect(readFile(path.join(workspace.path, "source.ts"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await workspace.cleanup() }
  })

  it("rejects a symlink move destination before removing the source", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      await writeFile(path.join(workspace.path, "source.ts"), "source\n")
      await writeFile(path.join(outside.path, "outside.ts"), "outside\n")
      const destination = path.join(workspace.path, "moved.ts")
      await symlink(path.join(outside.path, "outside.ts"), destination)
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "source.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      await expect(new EditService(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[source.ts#${observed.tag}]\nMV moved.ts`)).rejects.toMatchObject({ code: "SYMLINK_ESCAPE", writes: 0 })
      expect(await readFile(path.join(workspace.path, "source.ts"), "utf8")).toBe("source\n")
      expect(await readFile(path.join(outside.path, "outside.ts"), "utf8")).toBe("outside\n")
    } finally {
      await workspace.cleanup()
      await outside.cleanup()
    }
  })

  it("rejects move destinations that already exist before any source mutation", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      await writeFile(path.join(workspace.path, "source.ts"), "source\n")
      await writeFile(path.join(workspace.path, "target.ts"), "external\n")
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "source.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      await expect(new EditService(store).applyHashline({ sessionId: "s", worktree: workspace.path }, `[source.ts#${observed.tag}]\nMV target.ts`)).rejects.toMatchObject({ writes: 0, code: "WRITE_PROTECTED" })
      expect(await readFile(path.join(workspace.path, "source.ts"), "utf8")).toBe("source\n")
      expect(await readFile(path.join(workspace.path, "target.ts"), "utf8")).toBe("external\n")
    } finally { await workspace.cleanup() }
  })
})