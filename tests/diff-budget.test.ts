import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { EditService } from "../src/edit-service.js"
import { isFileReadResult, ReadService } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

const preview = vi.hoisted(() => vi.fn(() => ({ patch: "x".repeat(20_000), truncated: false })))
vi.mock("../src/visualization/diff-preview.js", () => ({ DIFF_PREVIEW_BUDGET: 20_000, diffPreview: preview }))

describe("batch presentation budget", () => {
  it("does not compute previews after the aggregate budget is exhausted", async () => {
    const workspace = await temporaryWorkspace()
    try {
      preview.mockClear()
      const store = new ScopedSnapshotStore()
      const requests = []
      for (const filePath of ["a.ts", "b.ts", "c.ts"]) {
        await writeFile(path.join(workspace.path, filePath), "before\n")
        const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath })
        if (!isFileReadResult(observed)) throw new Error("Expected file")
        requests.push({ sessionId: "s", worktree: workspace.path, filePath, snapshot: observed.snapshot, exact: { oldString: "before", newString: "after" } })
      }
      const results = await new EditService(store).editBatch(requests)
      expect(preview).toHaveBeenCalledTimes(1)
      expect(results[1]).toMatchObject({ diff: "", diffTruncated: true, added: 1, deleted: 1 })
    } finally { await workspace.cleanup() }
  })
})