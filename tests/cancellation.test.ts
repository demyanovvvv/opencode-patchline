import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "../src/config.js"
import { EditService } from "../src/edit-service.js"
import { isFileReadResult, ReadService } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { WriteService } from "../src/write-service.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("mutation cancellation", () => {
  it("rejects pre-aborted edits and creations without changing files", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      await writeFile(path.join(workspace.path, "a.ts"), "before\n")
      const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath: "a.ts" })
      if (!isFileReadResult(observed)) throw new Error("Expected file")
      const signal = AbortSignal.abort()
      await expect(new EditService(store).edit({ sessionId: "s", worktree: workspace.path, filePath: "a.ts", snapshot: observed.snapshot, exact: { oldString: "before", newString: "after" } }, undefined, signal)).rejects.toMatchObject({ name: "AbortError" })
      await expect(new WriteService(DEFAULT_CONFIG).write({ worktree: workspace.path, filePath: "new.ts", content: "new\n" }, signal)).rejects.toMatchObject({ name: "AbortError" })
      expect(await readFile(path.join(workspace.path, "a.ts"), "utf8")).toBe("before\n")
      await expect(readFile(path.join(workspace.path, "new.ts"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await workspace.cleanup() }
  })

  it("rolls back a landed edit when cancelled before the next commit", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      const controller = new AbortController()
      const requests = []
      for (const filePath of ["a.ts", "b.ts"]) {
        await writeFile(path.join(workspace.path, filePath), "before\n")
        const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath })
        if (!isFileReadResult(observed)) throw new Error("Expected file")
        requests.push({ sessionId: "s", worktree: workspace.path, filePath, snapshot: observed.snapshot, exact: { oldString: "before", newString: "after" } })
      }
      class CancellingEditor extends EditService {
        override async commit(prepared: Parameters<EditService["commit"]>[0]) {
          const result = await super.commit(prepared)
          controller.abort()
          return result
        }
      }
      await expect(new CancellingEditor(store).editBatch(requests, undefined, controller.signal)).rejects.toMatchObject({ code: "TRANSACTION_FAILED", writes: 1, details: { cancelled: true, restored: ["a.ts"], conflicts: [] } })
      for (const file of ["a.ts", "b.ts"]) expect(await readFile(path.join(workspace.path, file), "utf8")).toBe("before\n")
    } finally { await workspace.cleanup() }
  })

  it("stops a create batch cancelled at the commit stage", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const controller = new AbortController()
      await expect(new WriteService(DEFAULT_CONFIG).createBatch([{ worktree: workspace.path, filePath: "new.ts", content: "new\n" }], () => controller.abort(), controller.signal)).rejects.toMatchObject({ code: "TRANSACTION_FAILED", writes: 0, details: { cancelled: true, restored: [], conflicts: [] } })
      await expect(readFile(path.join(workspace.path, "new.ts"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await workspace.cleanup() }
  })
})