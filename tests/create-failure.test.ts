import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "../src/config.js"
import { WriteService } from "../src/write-service.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

const fault = vi.hoisted(() => ({ path: "", stage: "" }))

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args)
      if (args[0] !== fault.path) return handle
      if (fault.stage === "write") {
        const write = handle.write.bind(handle)
        let calls = 0
        vi.spyOn(handle, "writeFile").mockImplementation(async (data) => {
          await write(Buffer.from(data as string), 0, 4, 0)
          throw new Error("forced write failure")
        })
        vi.spyOn(handle, "write").mockImplementation((async (data: Buffer) => {
          if (calls++ > 0) throw new Error("forced write failure")
          return write(data, 0, 4, 0)
        }) as typeof handle.write)
      }
      if (fault.stage === "read") vi.spyOn(handle, "read").mockRejectedValue(new Error("forced verification failure"))
      if (fault.stage === "stat") vi.spyOn(handle, "stat").mockRejectedValue(new Error("forced identity failure"))
      if (fault.stage === "close") {
        const close = handle.close.bind(handle)
        vi.spyOn(handle, "close").mockImplementation(async () => {
          await close()
          throw new Error("forced close failure")
        })
      }
      return handle
    },
  }
})

afterEach(() => {
  fault.path = ""
  fault.stage = ""
  vi.restoreAllMocks()
})

describe("create I/O failures", () => {
  it.each(["write", "read", "close"])("tracks and rolls back a %s failure after exclusive creation", async (stage) => {
    const workspace = await temporaryWorkspace()
    try {
      fault.path = path.join(workspace.path, "second.ts")
      fault.stage = stage
      await expect(new WriteService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "first.ts", content: "first\n" },
        { worktree: workspace.path, filePath: "second.ts", content: "second\n" },
      ])).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
        writes: 2,
        details: { restored: ["second.ts", "first.ts"], conflicts: [] },
      })
      for (const file of ["first.ts", "second.ts"]) {
        await expect(readFile(path.join(workspace.path, file))).rejects.toMatchObject({ code: "ENOENT" })
      }
    } finally {
      await workspace.cleanup()
    }
  })

  it("reports an unverified creation as a conflict when file identity cannot be captured", async () => {
    const workspace = await temporaryWorkspace()
    try {
      fault.path = path.join(workspace.path, "unknown.ts")
      fault.stage = "stat"
      await expect(new WriteService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "unknown.ts", content: "unknown\n" },
      ])).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
        writes: 1,
        details: { restored: [], conflicts: ["unknown.ts"] },
      })
      expect(await readFile(fault.path, "utf8")).toBe("")
    } finally {
      await workspace.cleanup()
    }
  })

  it("uses the same guarded rollback for a single-file create failure", async () => {
    const workspace = await temporaryWorkspace()
    try {
      fault.path = path.join(workspace.path, "single.ts")
      fault.stage = "close"
      await expect(new WriteService(DEFAULT_CONFIG).write({
        worktree: workspace.path, filePath: "single.ts", content: "single\n",
      })).rejects.toMatchObject({ code: "TRANSACTION_FAILED", writes: 1, details: { restored: ["single.ts"], conflicts: [] } })
      await expect(readFile(fault.path)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })
})