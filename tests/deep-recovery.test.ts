import { writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { EditService } from "../src/edit-service.js"
import { ReadService, isFileReadResult } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { parseConfig } from "../src/config.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

const race = vi.hoisted(() => ({ file: "" }))
vi.mock("../src/editing/hashline-adapter.js", () => ({
  async parseHashlinePatch() { return [{ path: "file.ts", tag: "TAG", patch: "patch" }] },
  async applyHashlineBatchInMemory(snapshots: Array<{ text: string }>) {
    await writeFile(race.file, "external after recovery\n")
    return { results: snapshots.map((snapshot) => ({ op: "update", text: snapshot.text.replace("before", "after"), warnings: ["recovered drift"] })), publish() {} }
  },
  async applyHashlineInMemory(snapshot: { text: string }) {
    await writeFile(race.file, "external after recovery\n")
    return { text: snapshot.text.replace("before", "after"), warnings: ["recovered drift"] }
  },
}))

it("rejects a batch recovery result calculated before a live change", async () => {
  const w = await temporaryWorkspace()
  try {
    race.file = path.join(w.path, "file.ts")
    await writeFile(race.file, "before\n")
    const store = new ScopedSnapshotStore()
    const scope = { sessionId: "s", worktree: w.path }
    await new ReadService(store).read({ ...scope, filePath: "file.ts" })
    const get = store.get.bind(store)
    vi.spyOn(store, "get").mockImplementation((s, file) => get(s, file, "F27C"))
    await expect(new EditService(store, parseConfig({ hashlineRecovery: true })).applyHashline(scope, "patch")).rejects.toMatchObject({ code: "STALE_SNAPSHOT" })
  } finally { await w.cleanup() }
})

it("binds recovery to the live bytes used to calculate it", async () => {
  const w = await temporaryWorkspace()
  try {
    race.file = path.join(w.path, "file.ts")
    await writeFile(race.file, "before\n")
    const store = new ScopedSnapshotStore()
    const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
    const r = await new ReadService(store).read(scope)
    if (!isFileReadResult(r)) throw new Error("file expected")
    await writeFile(race.file, "before\nexternal\n")
    await expect(new EditService(store, parseConfig({ hashlineRecovery: true })).prepare({ ...scope, snapshot: r.snapshot, hashlinePatch: "patch" })).rejects.toMatchObject({ code: "STALE_SNAPSHOT" })
  } finally { await w.cleanup() }
})
