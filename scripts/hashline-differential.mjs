import assert from "node:assert/strict"
import { InMemoryFilesystem, InMemorySnapshotStore, Patch, Patcher } from "@oh-my-pi/hashline"
import { blockRangeAt } from "@oh-my-pi/pi-natives"
import { applyHashlineBatchInMemory } from "../dist/editing/hashline-adapter.js"
import { decodeUtf8 } from "../dist/preservation/text.js"
import { ScopedSnapshotStore } from "../dist/snapshot/store.js"

const corpus = [
  { name: "range", before: [["a.ts", "one\ntwo\nthree\n"]], patch: "[a.ts#TAG]\nPUT 2.=2:\n+changed" },
  { name: "head-tail", before: [["a.ts", "one\ntwo\n"]], patch: "[a.ts#TAG]\nPUT <1:\n+head\nPUT >$:\n+tail" },
  { name: "blank-lines", before: [["a.ts", "one\n\nthree\n"]], patch: "[a.ts#TAG]\nPUT 2.=2:\n+\n+" },
  { name: "same-path", before: [["a.ts", "one\ntwo\nthree\n"]], patch: "[a.ts#TAG]\nPUT 1.=1:\n+first\n[a.ts#TAG]\nPUT 3.=3:\n+last" },
  { name: "anonymous-clipboard", before: [["a.ts", "one\ntwo\nthree\n"]], patch: "[a.ts#TAG]\nCUT 1.=1\nPUT >$" },
  { name: "cross-file", before: [["a.ts", "export const a = 1\nexport const b = 2\n"], ["b.ts", "export const c = 3\n"]], patch: "[a.ts#TAG]\nCUT 1.=1 @move\n[b.ts#TAG]\nPUT >$ @move" },
  { name: "block", before: [["a.ts", "function f() {\n  return 1\n}\nconst tail = 2\n"]], patch: "[a.ts#TAG]\nPUT 1*:\n+function g() {\n+  return 2\n+}" },
  { name: "remove", before: [["a.ts", "one\n"]], patch: "[a.ts#TAG]\nREM" },
  { name: "move", before: [["a.ts", "one\n"]], patch: "[a.ts#TAG]\nMV moved.ts" },
  { name: "bad-anchor", before: [["a.ts", "one\n"]], patch: "[a.ts#TAG]\nCUT 9.=9", rejects: true },
  { name: "empty-register", before: [["a.ts", "one\n"]], patch: "[a.ts#TAG]\nPUT >$ @missing" },
  { name: "unseen", before: [["a.ts", "one\ntwo\n"]], seen: [1], patch: "[a.ts#TAG]\nCUT 2.=2", rejects: true },
]

for (const entry of corpus) {
  const store = new ScopedSnapshotStore()
  const observed = entry.before.map(([filePath, text]) => store.record({ sessionId: "differential", worktree: process.cwd() }, filePath, filePath, decodeUtf8(Buffer.from(text)), entry.seen ?? text.trimEnd().split("\n").map((_, index) => index + 1)))
  const patchText = entry.patch.replace(/\[([^#]+)#TAG\]/g, (_, filePath) => `[${filePath}#${observed.find((snapshot) => snapshot.relativePath === filePath).tag}]`)
  const fs = new InMemoryFilesystem(entry.before)
  const snapshots = new InMemorySnapshotStore()
  for (const snapshot of observed) snapshots.record(snapshot.relativePath, snapshot.text, snapshot.seenLines)
  const patcher = new Patcher({ fs, snapshots, enforceSeenLines: true, blockResolver: ({ path, text, line }) => {
    const span = blockRangeAt({ code: text, path, line })
    return span ? { start: span.startLine, end: span.endLine } : null
  } })
  if (entry.rejects) {
    await assert.rejects(patcher.apply(Patch.parse(patchText)), undefined, entry.name)
    await assert.rejects(applyHashlineBatchInMemory(observed, patchText), undefined, entry.name)
  } else {
    const reference = await patcher.apply(Patch.parse(patchText))
    const actual = await applyHashlineBatchInMemory(observed, patchText)
    assert.deepEqual(actual.results.map(({ path, op, text, warnings, moveDest }) => ({ path, op, text, warnings, moveDest })), reference.sections.map(({ path, op, after, warnings, moveDest }) => ({ path, op, text: after, warnings, moveDest })), entry.name)
  }
}
console.log(`Hashline differential corpus passed (${corpus.length} cases against installed upstream)`)