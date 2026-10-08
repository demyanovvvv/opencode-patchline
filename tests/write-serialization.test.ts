import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { WriteService } from "../src/write-service.js"
import { parseConfig } from "../src/config.js"
import { withPathLocks } from "../src/writing/path-lock.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

it("serializes allowed replacement writes with edit path locks", async () => {
  const w = await temporaryWorkspace()
  try {
    const file = path.join(w.path, "file.ts")
    await writeFile(file, "before")
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered = false
    class Service extends WriteService {
      protected override async replaceExistingFile(...args: Parameters<WriteService["replaceExistingFile"]>) {
        entered = true
        return super.replaceExistingFile(...args)
      }
    }
    const held = withPathLocks([file], () => gate)
    const pending = new Service(parseConfig({ allowedFullReplacements: ["file.ts"] })).write({ worktree: w.path, filePath: "file.ts", content: "after" })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(entered).toBe(false)
    release()
    await Promise.all([held, pending])
    expect(entered).toBe(true)
  } finally { await w.cleanup() }
})

it("preserves external content changes during an allowed replacement", async () => {
  const w = await temporaryWorkspace()
  try {
    const file = path.join(w.path, "file.ts")
    await writeFile(file, "before")
    class Service extends WriteService {
      protected override async replaceExistingFile(...args: Parameters<WriteService["replaceExistingFile"]>) {
        await writeFile(file, "external")
        return super.replaceExistingFile(...args)
      }
    }
    await expect(new Service(parseConfig({ allowedFullReplacements: ["file.ts"] })).write({ worktree: w.path, filePath: "file.ts", content: "after" })).rejects.toMatchObject({ code: "STALE_SNAPSHOT" })
    expect(await readFile(file, "utf8")).toBe("external")
  } finally { await w.cleanup() }
})
