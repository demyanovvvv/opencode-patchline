import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { atomicReplace, readFileIdentity } from "../src/writing/atomic.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

const fault = vi.hoisted(() => ({ enabled: false }))

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...original,
    rm: async (...args: Parameters<typeof original.rm>) => {
      if (fault.enabled && String(args[0]).includes(".patchline-tmp-")) throw new Error("forced cleanup failure")
      return original.rm(...args)
    },
  }
})

afterEach(() => {
  fault.enabled = false
  vi.restoreAllMocks()
})

describe("atomic replacement", () => {
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