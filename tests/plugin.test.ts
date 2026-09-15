import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { PatchlinePlugin } from "../src/plugin.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("OpenCode plugin", () => {
  it("registers familiar precision tools and blocks direct shell writes", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      expect(Object.keys(hooks.tool ?? {})).toEqual(expect.arrayContaining(["read", "edit", "write", "apply_patch", "ast_search", "patchline_lsp"]))
      await expect(hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s", callID: "c" },
        { args: { command: "Set-Content -Path a.ts -Value bad" } },
      )).rejects.toMatchObject({ code: "FALLBACK_REJECTED" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("uses read and edit through their OpenCode tool contracts", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const ask = vi.fn(async () => undefined)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask,
      }
      const read = await hooks.tool!.read!.execute({ filePath: "a.ts" }, context)
      expect(typeof read).not.toBe("string")
      const snapshot = typeof read === "string" ? "" : String(read.metadata?.snapshot)
      const edit = await hooks.tool!.edit!.execute({ filePath: "a.ts", snapshot, oldString: "1", newString: "2" }, context)
      expect(typeof edit === "string" ? edit : edit.output).toContain("Diff: +1 -1")
      expect(ask).toHaveBeenCalledTimes(2)
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects a formatted grep response above the output budget", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "many.ts"), Array.from({ length: 30 }, (_, index) => `${index}:${"x".repeat(900)} NEEDLE`).join("\n"))
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(async () => undefined),
      }

      await expect(hooks.tool!.patchline_grep!.execute({ pattern: "NEEDLE", path: "many.ts", maxResults: 30 }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("bounds successful create-batch output without reporting a mutation failure", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const files = Array.from({ length: 150 }, (_, index) => `${String(index).padStart(3, "0")}-${"x".repeat(140)}.ts`)
      const patchText = [
        "*** Begin Patch",
        ...files.flatMap((file) => [`*** Add File: ${file}`, "+"]),
        "*** End Patch",
      ].join("\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(async () => undefined),
      }

      const output = await hooks.tool!.apply_patch!.execute({ patchText }, context)
      expect(output).toHaveLength(20_000)
      expect(output).toContain("Output truncated")
      expect(await readFile(path.join(workspace.path, files.at(-1)!), "utf8")).toBe("")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects an oversized apply_patch payload before asking for permission", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const ask = vi.fn(async () => undefined)
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask,
      }

      await expect(hooks.tool!.apply_patch!.execute({ patchText: `*** Begin Patch\n*** Add File: oversized.ts\n+${"x".repeat(8 * 1024 * 1024)}\n*** End Patch` }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      expect(ask).not.toHaveBeenCalled()
    } finally {
      await workspace.cleanup()
    }
  })

  it("allows apply_patch to create new files only", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(async () => undefined),
      }
      const result = await hooks.tool!.apply_patch!.execute({ patchText: "*** Begin Patch\n*** Add File: created.ts\n+export {}\n*** End Patch" }, context)
      expect(typeof result === "string" ? result : result.output).toContain("Created: created.ts")
      await expect(hooks.tool!.apply_patch!.execute({ patchText: "*** Begin Patch\n*** Update File: created.ts\n-old\n+new\n*** End Patch" }, context)).rejects.toMatchObject({ code: "FALLBACK_REJECTED" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects classic apply_patch content outside its envelope", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(async () => undefined),
      }
      const patchText = "*** Begin Patch\n*** Add File: accepted.ts\n+export {}\n*** End Patch\n*** Add File: trailing.ts\n+export {}"

      await expect(hooks.tool!.apply_patch!.execute({ patchText }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(readFile(path.join(workspace.path, "accepted.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      await expect(readFile(path.join(workspace.path, "trailing.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects content before the first Hashline section without requesting edit permission", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const ask = vi.fn(async () => undefined)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask,
      }

      await expect(hooks.tool!.apply_patch!.execute({ patchText: "ignored prefix\n[missing.ts#ABCD]\nPUT 1:1\n+value" }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      expect(ask).not.toHaveBeenCalled()
    } finally {
      await workspace.cleanup()
    }
  })

  it("preserves structured stale errors through the edit tool", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "stale.ts")
      await writeFile(file, "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(async () => undefined),
      }
      const read = await hooks.tool!.read!.execute({ filePath: "stale.ts" }, context)
      const snapshot = typeof read === "string" ? "" : String(read.metadata?.snapshot)
      await writeFile(file, "const value = external()\n")
      await expect(hooks.tool!.edit!.execute({ filePath: "stale.ts", snapshot, oldString: "1", newString: "2" }, context)).rejects.toMatchObject({
        code: "STALE_SNAPSHOT",
        retryable: true,
        path: "stale.ts",
        writes: 0,
      })
      expect(await readFile(file, "utf8")).toBe("const value = external()\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("requires bash permission before running an explicit diagnostic command", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const marker = path.join(workspace.path, "diagnostics-ran.txt")
      const command = `${process.execPath} -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"`
      const ask = vi.fn(async () => { throw new Error("permission denied") })
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask,
      }

      await expect(hooks.tool!.patchline_diagnostics!.execute({ command }, context)).rejects.toThrow("permission denied")
      expect(ask).toHaveBeenCalledWith({ permission: "bash", patterns: [command], always: ["*"], metadata: { command, reason: "diagnostics" } })
      await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("requires bash permission before configured post-edit validation", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "validated.ts"), "const value = 1\n")
      const command = `${process.execPath} -e "console.log('validated')"`
      const ask = vi.fn(async (request: { permission: string }) => {
        if (request.permission === "bash") throw new Error("validation permission denied")
      })
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { validationCommands: { default: command } })
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask,
      }
      const read = await hooks.tool!.read!.execute({ filePath: "validated.ts" }, context)
      const snapshot = typeof read === "string" ? "" : String(read.metadata?.snapshot)

      await expect(hooks.tool!.edit!.execute({ filePath: "validated.ts", snapshot, oldString: "1", newString: "2" }, context)).rejects.toThrow("validation permission denied")
      expect(ask).toHaveBeenNthCalledWith(3, { permission: "bash", patterns: [command], always: ["*"], metadata: { command, reason: "post-edit validation" } })
      expect(await readFile(path.join(workspace.path, "validated.ts"), "utf8")).toBe("const value = 2\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("keeps compatibility mode from shadowing or blocking built-in editing", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { mode: "compatibility" })
      expect(hooks.tool).not.toHaveProperty("read")
      expect(hooks.tool).not.toHaveProperty("edit")
      expect(hooks.tool).not.toHaveProperty("write")
      expect(hooks.tool).not.toHaveProperty("apply_patch")
      await expect(hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s", callID: "c" },
        { args: { command: "Set-Content -Path a.ts -Value bad" } },
      )).resolves.toBeUndefined()
    } finally {
      await workspace.cleanup()
    }
  })

  it("can disable classic apply_patch fallback", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { applyPatchFallback: false })
      await expect(hooks.tool!.apply_patch!.execute({ patchText: "*** Begin Patch\n*** Add File: created.ts\n+export {}\n*** End Patch" }, {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(async () => undefined),
      })).rejects.toMatchObject({ code: "FALLBACK_REJECTED" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("exposes an optional summary and keeps it available without detailed telemetry", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { telemetry: false })
      const context = {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(async () => undefined),
      }
      await hooks.tool!.read!.execute({ filePath: "a.ts" }, context)
      const summary = await hooks.tool!.patchline_summary!.execute({}, context)
      expect(typeof summary === "string" ? summary : summary.output).toContain("Reads: 1")
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not register the summary tool when summary output is disabled", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { summary: false })
      expect(hooks.tool).not.toHaveProperty("patchline_summary")
    } finally {
      await workspace.cleanup()
    }
  })
})
