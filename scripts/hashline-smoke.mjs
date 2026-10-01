import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PatchlinePlugin } from "../dist/plugin.js"

const worktree = await mkdtemp(path.join(os.tmpdir(), "patchline-hashline-smoke-"))
try {
  const hooks = await PatchlinePlugin({ directory: worktree, worktree }, { hashlineRecovery: true })
  const context = { sessionID: "hashline", messageID: "m", agent: "build", directory: worktree, worktree, abort: new AbortController().signal, metadata() {}, async ask() {} }
  const observe = async (filePath, content) => {
    await writeFile(path.join(worktree, filePath), content)
    const result = await hooks.tool.read.execute({ filePath }, context)
    return result.metadata.tag
  }
  const source = await observe("source.ts", "export const moved = 1\nexport const kept = 2\n")
  const target = await observe("target.ts", "export const target = 3\n")
  await hooks.tool.apply_patch.execute({ patchText: `[source.ts#${source}]\nCUT 1.=1 @move\n[target.ts#${target}]\nPUT >$ @move` }, context)
  assert.equal(await readFile(path.join(worktree, "source.ts"), "utf8"), "export const kept = 2\n")
  assert.equal(await readFile(path.join(worktree, "target.ts"), "utf8"), "export const target = 3\nexport const moved = 1\n")
  const next = await hooks.tool.read.execute({ filePath: "target.ts" }, context)
  await hooks.tool.apply_patch.execute({ patchText: `[target.ts#${next.metadata.tag}]\nPUT >$ @move` }, context)
  assert.equal(await readFile(path.join(worktree, "target.ts"), "utf8"), "export const target = 3\nexport const moved = 1\nexport const moved = 1\n")
  const block = await observe("block.ts", "function old() {\n  return 1\n}\nexport const tail = 2\n")
  await hooks.tool.apply_patch.execute({ patchText: `[block.ts#${block}]\nPUT 1*:\n+function changed() {\n+  return 10\n+}` }, context)
  assert.equal(await readFile(path.join(worktree, "block.ts"), "utf8"), "function changed() {\n  return 10\n}\nexport const tail = 2\n")
  const merged = await observe("merged.ts", "one\ntwo\nthree\n")
  await hooks.tool.apply_patch.execute({ patchText: `[merged.ts#${merged}]\nPUT 1.=1:\n+first\n[merged.ts#${merged}]\nPUT 3.=3:\n+last` }, context)
  assert.equal(await readFile(path.join(worktree, "merged.ts"), "utf8"), "first\ntwo\nlast\n")
  const move = await observe("rename.ts", "\uFEFFconst original = 1\r\n")
  await hooks.tool.apply_patch.execute({ patchText: `[rename.ts#${move}]\nPUT 1.=1:\n+const renamed = 2\nMV renamed.ts` }, context)
  await assert.rejects(readFile(path.join(worktree, "rename.ts")), { code: "ENOENT" })
  assert.equal(await readFile(path.join(worktree, "renamed.ts"), "utf8"), "\uFEFFconst renamed = 2\r\n")
  const remove = await hooks.tool.read.execute({ filePath: "renamed.ts" }, context)
  await hooks.tool.apply_patch.execute({ patchText: `[renamed.ts#${remove.metadata.tag}]\nREM` }, context)
  await assert.rejects(readFile(path.join(worktree, "renamed.ts")), { code: "ENOENT" })
  const recovery = await observe("recovery.ts", "const outside = 1\nconst target = 2\nconst tail = 3\n")
  await writeFile(path.join(worktree, "recovery.ts"), "const outside = 10\nconst target = 2\nconst tail = 3\n")
  await hooks.tool.apply_patch.execute({ patchText: `[recovery.ts#${recovery}]\nPUT 2.=2:\n+const target = 20` }, context)
  assert.equal(await readFile(path.join(worktree, "recovery.ts"), "utf8"), "const outside = 10\nconst target = 20\nconst tail = 3\n")
  const stale = await observe("stale.ts", "original\n")
  await writeFile(path.join(worktree, "stale.ts"), "external\n")
  await assert.rejects(hooks.tool.apply_patch.execute({ patchText: `[stale.ts#${stale}]\nREM` }, context), { code: "STALE_SNAPSHOT", writes: 0 })
  assert.equal(await readFile(path.join(worktree, "stale.ts"), "utf8"), "external\n")
  const unseen = await observe("unseen.ts", "first\nsecond\nthird\n")
  const otherContext = { ...context, sessionID: "partial" }
  const partial = await hooks.tool.read.execute({ filePath: "unseen.ts", limit: 1 }, otherContext)
  await assert.rejects(hooks.tool.apply_patch.execute({ patchText: `[unseen.ts#${partial.metadata.tag}]\nREM` }, otherContext), { writes: 0 })
  await assert.rejects(hooks.tool.apply_patch.execute({ patchText: `[unseen.ts#${unseen}]\nMV ../escape.ts` }, context), { code: "PATH_OUTSIDE_WORKSPACE", writes: 0 })
  const bad = await observe("bad.ts", "one\n")
  const register = await observe("register.ts", "saved\n")
  await assert.rejects(hooks.tool.apply_patch.execute({ patchText: `[register.ts#${register}]\nCUT 1.=1 @poison\n[bad.ts#${bad}]\nPUT 99.=99:\n+invalid` }, context), { writes: 0 })
  await assert.rejects(hooks.tool.apply_patch.execute({ patchText: `[bad.ts#${bad}]\nPUT >$ @poison` }, context), { writes: 0 })
  assert.equal(await readFile(path.join(worktree, "register.ts"), "utf8"), "saved\n")
  await assert.rejects(hooks.tool.apply_patch.execute({ patchText: `[bad.ts#${bad}]\nPUT >$ @move` }, { ...context, sessionID: "other" }), { writes: 0 })
  console.log("Hashline Bun smoke passed (clipboard, blocks, merging, MV/REM, stale/unseen/path guards and failed-register isolation)")
} finally {
  await rm(worktree, { recursive: true, force: true })
}