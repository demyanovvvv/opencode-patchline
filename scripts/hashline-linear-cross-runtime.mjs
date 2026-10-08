import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { applyHashlineInMemory } from "../dist/editing/hashline-adapter.js"
import { ScopedSnapshotStore } from "../dist/snapshot/store.js"
import { decodeUtf8 } from "../dist/preservation/text.js"

const cases = [
  { before: "one\ntwo\n", body: "PUT 1.=1:\n+changed" },
  { before: "one\ntwo", body: "PUT >$:\n+tail" },
  { before: "one\ntwo\n", body: "CUT 1.=1" },
  { before: "one\ntwo\n", body: "PUT <1:\n+head" },
  { before: "one\n\nthree\n", body: "PUT 2.=2:\n+\n+" },
]
async function results() {
  const output = []
  for (const entry of cases) {
    const s = new ScopedSnapshotStore().record({ sessionId: "cross-runtime", worktree: process.cwd() }, "sample.ts", "sample.ts", decodeUtf8(Buffer.from(entry.before)), [1, 2, 3])
    output.push((await applyHashlineInMemory(s, `[sample.ts#${s.tag}]\n${entry.body}`)).text)
  }
  return output
}
if (process.argv.includes("--child")) console.log(JSON.stringify(await results()))
else {
  const node = spawnSync(process.execPath, [import.meta.filename, "--child"], { encoding: "utf8" })
  const bun = spawnSync("bun", ["--conditions=browser", import.meta.filename, "--child"], { encoding: "utf8" })
  assert.equal(node.status, 0, node.stderr)
  assert.equal(bun.status, 0, bun.stderr)
  assert.deepEqual(JSON.parse(node.stdout), JSON.parse(bun.stdout))
  console.log(`Node/Bun linear differential passed (${cases.length} cases)`)
}
