import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { EditService } from "../src/edit-service.js"
import { isFileReadResult, ReadService } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

const calls = vi.hoisted(() => ({ observed: [] as string[][], enter: () => {}, wait: Promise.resolve() }))
vi.mock("../src/editing/hashline-adapter.js", () => ({
  parseHashlinePatch: async (patch: string) => [{ path: patch.split("#")[0]!.slice(1), tag: patch.split("#")[1]!.slice(0, 4), patch }],
  applyHashlineBatchInMemory: async (snapshots: Array<{ relativePath: string; text: string }>, _patch: string, clipboard: { named?: Map<string, readonly string[]> }) => {
    const named = new Map(clipboard.named)
    calls.observed.push([...named.keys()])
    if (snapshots[0]!.relativePath === "a.ts") { calls.enter(); await calls.wait }
    named.set(snapshots[0]!.relativePath, ["register"])
    return { results: snapshots.map((snapshot) => ({ path: snapshot.relativePath, sourcePath: snapshot.relativePath, op: "update", text: `${snapshot.text}// changed\n`, warnings: [] })), publish() { clipboard.named = named } }
  },
}))

describe("Hashline session serialization", () => {
  it("preserves registers published by overlapping patches in one scope", async () => {
    const workspace = await temporaryWorkspace()
    let release!: () => void
    try {
      const store = new ScopedSnapshotStore()
      const editor = new EditService(store)
      const tags: string[] = []
      for (const filePath of ["a.ts", "b.ts"]) {
        await writeFile(path.join(workspace.path, filePath), "before\n")
        const observed = await new ReadService(store).read({ sessionId: "s", worktree: workspace.path, filePath })
        if (!isFileReadResult(observed)) throw new Error("Expected file")
        tags.push(observed.tag)
      }
      calls.observed = []
      calls.wait = new Promise<void>((resolve) => { release = resolve })
      const entered = new Promise<void>((resolve) => { calls.enter = resolve })
      const scope = { sessionId: "s", worktree: workspace.path }
      const first = editor.applyHashline(scope, `[a.ts#${tags[0]}]\nPUT`)
      await entered
      const second = editor.applyHashline(scope, `[b.ts#${tags[1]}]\nPUT`)
      release()
      await Promise.all([first, second])
      expect(calls.observed).toEqual([[], ["a.ts"]])
      expect(await readFile(path.join(workspace.path, "b.ts"), "utf8")).toContain("// changed")
    } finally { release?.(); await workspace.cleanup() }
  })
})