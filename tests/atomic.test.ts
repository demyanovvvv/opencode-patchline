import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { atomicReplace, readFileIdentity } from "../src/writing/atomic.js"
import { temporaryWorkspace } from "./helpers/workspace.js"
import { digestBytes } from "../src/snapshot/store.js"
import { commitConfigurations, readSnapshot } from "../src/installation/files.js"

const fault = vi.hoisted(() => ({ enabled: false, target: "" }))

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...original,
    writeFile: async (...args: Parameters<typeof original.writeFile>) => {
      const result = await original.writeFile(...args)
      if (fault.target && String(args[0]).includes(".patchline-tmp-")) await original.writeFile(fault.target, "external\n")
      return result
    },
    rm: async (...args: Parameters<typeof original.rm>) => {
      if (fault.enabled && String(args[0]).includes(".patchline-tmp-")) throw new Error("forced cleanup failure")
      return original.rm(...args)
    },
  }
})

afterEach(() => {
  fault.enabled = false
  fault.target = ""
  vi.restoreAllMocks()
})

describe("atomic replacement", () => {
  it("preserves configuration changes made during temporary preparation", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const target = path.join(workspace.path, "opencode.json")
      await writeFile(target, "before\n")
      const snapshot = await readSnapshot(target)
      if (!snapshot) throw new Error("snapshot expected")
      fault.target = target
      await expect(commitConfigurations([{ ...snapshot, text: "after\n" }], () => {})).rejects.toThrow()
      expect(await readFile(target, "utf8")).toBe("external\n")
    } finally { fault.target = ""; await workspace.cleanup() }
  })
  it("preserves in-place changes during temporary preparation", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const target = path.join(workspace.path, "source.ts")
      await writeFile(target, "before\n")
      const expectedParent = await readFileIdentity(workspace.path)
      const expectedTarget = await readFileIdentity(target)
      fault.target = target
      await expect(atomicReplace(target, Buffer.from("after\n"), { expectedParent, expectedTarget, expectedDigest: digestBytes(Buffer.from("before\n")) })).rejects.toMatchObject({ code: "STALE_SNAPSHOT" })
      expect(await readFile(target, "utf8")).toBe("external\n")
    } finally { fault.target = ""; await workspace.cleanup() }
  })
  it("returns after rename when temporary cleanup fails", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const target = path.join(workspace.path, "source.ts")
      await writeFile(target, "before\n")
      const expectedParent = await readFileIdentity(workspace.path)
      const expectedTarget = await readFileIdentity(target)
      fault.enabled = true

      await expect(atomicReplace(target, Buffer.from("after\n"), { expectedParent, expectedTarget })).resolves.toBeDefined()
      expect(await readFile(target, "utf8")).toBe("after\n")
    } finally {
      await workspace.cleanup()
    }
  })
})
