import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { temporaryWorkspace } from "./helpers/workspace.js"

const race = vi.hoisted(() => ({ source: "", target: "", failRead: false, landed: false }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return { ...fs, async readFile(...args: Parameters<typeof fs.readFile>) {
    if (race.failRead && race.landed && args[0] === race.target) { race.failRead = false; throw new Error("forced post-rename read failure") }
    return fs.readFile(...args)
  }, async rename(...args: Parameters<typeof fs.rename>) {
    await fs.rename(...args)
    if (args[1] === race.target && String(args[0]).includes(".patchline-host-")) {
      race.landed = true
      if (!race.failRead) await fs.writeFile(race.source, "source changed")
    }
  } }
})

it("restores the host after a late verification read error", async () => {
  const w = await temporaryWorkspace()
  try {
    race.source = path.join(w.path, "source.exe")
    race.target = path.join(w.path, "target.exe")
    race.landed = false
    race.failRead = true
    await writeFile(race.source, "new")
    await writeFile(race.target, "original")
    await expect(installHostBinary(race.source, race.target)).rejects.toThrow(/read failure/)
    expect(await readFile(race.target, "utf8")).toBe("original")
  } finally { race.target = ""; race.failRead = false; race.landed = false; await w.cleanup() }
})
import { installHostBinary } from "../src/installation/files.js"

it("restores the original host when post-rename verification fails", async () => {
  const w = await temporaryWorkspace()
  try {
    race.source = path.join(w.path, "source.exe")
    race.target = path.join(w.path, "target.exe")
    await writeFile(race.source, "new")
    await writeFile(race.target, "original")
    await expect(installHostBinary(race.source, race.target)).rejects.toThrow(/match/)
    expect(await readFile(race.target, "utf8")).toBe("original")
  } finally { race.target = ""; await w.cleanup() }
})
