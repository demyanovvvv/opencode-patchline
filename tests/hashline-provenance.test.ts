import { expect, it, vi } from "vitest"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { temporaryWorkspace } from "./helpers/workspace.js"
import { EditService } from "../src/edit-service.js"
import { ReadService, isFileReadResult } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"

vi.mock("../src/editing/hashline-adapter.js", () => ({
  async applyHashlineInMemory() { return { text: "b\nb\n", warnings: [] } },
}))

it("requires rereading when an adapter cannot prove resulting line provenance", async () => {
  const w = await temporaryWorkspace()
  try {
    await writeFile(path.join(w.path, "file.ts"), "a\nb\n")
    const store = new ScopedSnapshotStore()
    const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
    const r = await new ReadService(store).read({ ...scope, limit: 1 })
    if (!isFileReadResult(r)) throw new Error("file expected")
    const p = await new EditService(store).prepare({ ...scope, snapshot: r.snapshot, hashlinePatch: "structural patch" })
    expect([...p.seenLinesAfter]).toEqual([])
  } finally { await w.cleanup() }
})
