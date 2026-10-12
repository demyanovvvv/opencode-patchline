import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { temporaryWorkspace } from "./helpers/workspace.js"

const state = vi.hoisted(() => ({ locked: false }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return { ...fs, async rm(...args: Parameters<typeof fs.rm>) {
    if (state.locked && String(args[0]).endsWith("-previous")) throw Object.assign(new Error("running image"), { code: "EPERM" })
    return fs.rm(...args)
  } }
})
import { installHostBinary } from "../src/installation/files.js"

it("retains a locked retired backup without rolling back a verified new host", async () => {
  const w = await temporaryWorkspace()
  try {
    const source = path.join(w.path, "new")
    const target = path.join(w.path, "host")
    await writeFile(source, "new")
    await writeFile(target, "old")
    await writeFile(`${target}.patchline-previous`, "older")
    state.locked = true
    await expect(installHostBinary(source, target)).resolves.toBe(`${target}.patchline-previous`)
    expect(await readFile(target, "utf8")).toBe("new")
    expect(await readFile(`${target}.patchline-previous`, "utf8")).toBe("old")
  } finally { state.locked = false; await w.cleanup() }
})
