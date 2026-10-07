import { expect, it } from "vitest"
import { applyHashlineInMemory } from "../src/editing/hashline-adapter.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { decodeUtf8 } from "../src/preservation/text.js"
import { parseHashlinePatch } from "../src/editing/hashline-adapter.js"

it.each([">1junk", "<1junk", ">9007199254740993"])("rejects malformed insertion %s", async (target) => {
  const snapshot = new ScopedSnapshotStore().record({ sessionId: "s", worktree: process.cwd() }, "sample.ts", "sample.ts", decodeUtf8(Buffer.from("one\ntwo\n")), [1, 2])
  await expect(applyHashlineInMemory(snapshot, `[sample.ts#${snapshot.tag}]\nPUT ${target}:\n+inserted`)).rejects.toMatchObject({ code: "PATCH_PREFLIGHT_FAILED" })
})

it("accepts full snapshot IDs for collision recovery", async () => {
  const snapshot = new ScopedSnapshotStore().record({ sessionId: "s", worktree: process.cwd() }, "sample.ts", "sample.ts", decodeUtf8(Buffer.from("one\n")), [1])
  const sections = await parseHashlinePatch(`[sample.ts#${snapshot.id}]\nPUT 1.=1:\n+after`)
  expect(sections[0]?.tag).toBe(snapshot.id)
})

it("rejects conflicting full IDs for repeated source sections", async () => {
  await expect(parseHashlinePatch("[sample.ts#ABCD-111111111111]\nPUT 1.=1:\n+a\n[sample.ts#ABCD-222222222222]\nPUT 2.=2:\n+b")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
})
