import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { applyHostSourceChanges } from "../src/installer.js"
import { readSnapshot } from "../src/installation/files.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

it("returns an ownership-checked rollback for the host source patch set", async () => {
  const w = await temporaryWorkspace()
  try {
    const file = path.join(w.path, "source.ts")
    await writeFile(file, "before\n")
    const snapshot = await readSnapshot(file)
    if (!snapshot) throw new Error("snapshot expected")
    const restore = await applyHostSourceChanges([{ ...snapshot, text: "after\n" }], () => {})
    await restore()
    expect(await readFile(file, "utf8")).toBe("before\n")
    const current = await readSnapshot(file)
    if (!current) throw new Error("snapshot expected")
    const conflictingRestore = await applyHostSourceChanges([{ ...current, text: "after\n" }], () => {})
    await writeFile(file, "external\n")
    await expect(conflictingRestore()).rejects.toThrow(/changed|conflict/i)
    expect(await readFile(file, "utf8")).toBe("external\n")
  } finally { await w.cleanup() }
})
