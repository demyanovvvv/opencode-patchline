import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { PatchlinePlugin } from "../src/plugin.js"
import * as lspManager from "../src/lsp/manager.js"
import * as lspSearch from "../src/search/lsp.js"
import { PatchlineError } from "../src/errors.js"
import { EditService } from "../src/edit-service.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("OpenCode plugin", () => {
  it("preserves existing provider exclusions when adding read selector constraints", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, {})
      const original = { type: "object", not: { required: ["forbidden"] }, allOf: [{ required: ["filePath"] }] }
      const output = { description: "read", parameters: {}, jsonSchema: original }
      await hooks["tool.definition"]!({ toolID: "read" }, output)
      expect(output.jsonSchema).toEqual({ allOf: [original, { not: { required: ["anchor", "offset"] } }] })
      expect(original.allOf).toEqual([{ required: ["filePath"] }])
      expect(original.not).toEqual({ required: ["forbidden"] })
    } finally { await workspace.cleanup() }
  })
  it("limits provider selector constraints to precision read and tolerates older hosts", async () => {
    const workspace = await temporaryWorkspace()
    try {
      for (const mode of ["precision", "compatibility"] as const) {
        const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { mode })
        const original = { type: "object", required: ["filePath"] }
        const output = { description: "read", parameters: {}, jsonSchema: original }
        await hooks["tool.definition"]!({ toolID: "read" }, output)
        expect(output.jsonSchema).toEqual(mode === "precision" ? { ...original, not: { required: ["anchor", "offset"] } } : original)
        expect(original).toEqual({ type: "object", required: ["filePath"] })
        const unrelated = { description: "edit", parameters: {}, jsonSchema: original }
        await hooks["tool.definition"]!({ toolID: "edit" }, unrelated)
        expect(unrelated.jsonSchema).toBe(original)
        await expect(hooks["tool.definition"]!({ toolID: "read" }, { description: "read", parameters: {} })).resolves.toBeUndefined()
      }
    } finally { await workspace.cleanup() }
  })
  it("does not revoke newer capabilities when an older fingerprint check finishes", async () => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp").mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { workspaceSymbolProvider: true } }])
    const fingerprint = vi.spyOn(lspManager, "fingerprintLspReports").mockResolvedValue("new")
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact" })
      await hooks.config!({ lsp: true } as never)
      const captured = hooks.tool!.patchline_lsp!
      fingerprint.mockImplementationOnce(async () => {
        await hooks.config!({ lsp: true } as never)
        return "old"
      })
      await expect(captured.execute({ operation: "workspaceSymbol", query: "needle" }, { worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: async () => {} } as never)).rejects.toThrow(/configuration.*changed/i)
      expect(hooks.tool).toHaveProperty("patchline_lsp")
    } finally { fingerprint.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it("does not publish compact capabilities after configuration changes during fingerprinting", async () => {
    const workspace = await temporaryWorkspace()
    const configuration = { lsp: { typescript: { disabled: false } } }
    const prepare = vi.spyOn(lspManager, "configureProjectLsp").mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { workspaceSymbolProvider: true } }])
    const fingerprint = vi.spyOn(lspManager, "fingerprintLspReports").mockImplementation(async () => {
      configuration.lsp.typescript.disabled = true
      return "[]"
    })
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact" })
      await hooks.config!(configuration as never)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
    } finally { fingerprint.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it("honors cancellation while checking the LSP toolchain fingerprint", async () => {
    const workspace = await temporaryWorkspace()
    const abort = new AbortController()
    const fingerprint = vi.spyOn(lspManager, "fingerprintLspReports").mockImplementation(async () => {
      abort.abort(new Error("fingerprint cancelled"))
      return "[]"
    })
    const client = vi.spyOn(lspSearch, "runOpenCodeLspClient").mockResolvedValue("obsolete")
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path, client: {} } as never, { lspAutoSetup: false })
      await hooks.config!({ lsp: true } as never)
      await expect(hooks.tool!.patchline_lsp!.execute({ operation: "workspaceSymbol", query: "needle" }, { worktree: workspace.path, abort: abort.signal, metadata: vi.fn(), ask: async () => {} } as never)).rejects.toThrow(/cancelled/i)
      expect(client).not.toHaveBeenCalled()
    } finally { client.mockRestore(); fingerprint.mockRestore(); await workspace.cleanup() }
  })
  it("rejects a status refresh edited in place while fingerprinting toolchain", async () => {
    const workspace = await temporaryWorkspace()
    const configuration = { lsp: { typescript: { disabled: false } } }
    const prepare = vi.spyOn(lspManager, "prepareProjectLsp").mockResolvedValue([])
    const fingerprint = vi.spyOn(lspManager, "fingerprintLspReports").mockImplementation(async () => {
      configuration.lsp.typescript.disabled = true
      return "[]"
    })
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { lspAutoSetup: false })
      await hooks.config!(configuration as never)
      await expect(hooks.tool!.patchline_lsp_status!.execute({}, { worktree: workspace.path, abort: new AbortController().signal, ask: async () => {} } as never)).rejects.toThrow(/configuration.*changed/i)
    } finally { fingerprint.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it.each(["before-dispatch", "during-sdk"])("revokes compact capabilities when the verified launcher changes %s", async (timing) => {
    const workspace = await temporaryWorkspace()
    const script = path.join(workspace.path, "server.js")
    await writeFile(script, "before")
    const prepare = vi.spyOn(lspManager, "configureProjectLsp").mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", command: [process.execPath, script], capabilities: { workspaceSymbolProvider: true } }])
    const client = vi.spyOn(lspSearch, "runOpenCodeLspClient").mockResolvedValue("obsolete")
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path, client: {} } as never, { toolProfile: "compact" })
      await hooks.config!({ lsp: true } as never)
      const captured = hooks.tool!.patchline_lsp!
      if (timing === "before-dispatch") await writeFile(script, "after")
      else client.mockImplementation(async () => { await writeFile(script, "after"); return "obsolete" })
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      await expect(captured.execute({ operation: "workspaceSymbol", query: "needle" }, context)).rejects.toThrow(/toolchain.*changed/i)
      expect(client).toHaveBeenCalledTimes(timing === "before-dispatch" ? 0 : 1)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
    } finally { client.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it("rejects status reports when configuration changes in place during refresh", async () => {
    const workspace = await temporaryWorkspace()
    const configuration = { lsp: { typescript: { disabled: false } } }
    const prepare = vi.spyOn(lspManager, "prepareProjectLsp").mockImplementation(async () => {
      configuration.lsp.typescript.disabled = true
      return []
    })
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { lspAutoSetup: false })
      await hooks.config!(configuration as never)
      await expect(hooks.tool!.patchline_lsp_status!.execute({}, { worktree: workspace.path, abort: new AbortController().signal, ask: async () => {} } as never)).rejects.toThrow(/configuration.*changed/i)
    } finally { prepare.mockRestore(); await workspace.cleanup() }
  })
  it("rejects cached capabilities after an in-place LSP configuration edit", async () => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp").mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { workspaceSymbolProvider: true } }])
    const client = vi.spyOn(lspSearch, "runOpenCodeLspClient").mockResolvedValue("obsolete")
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path, client: {} } as never, { toolProfile: "compact" })
      const configuration = { lsp: { typescript: { disabled: false } } }
      await hooks.config!(configuration as never)
      const captured = hooks.tool!.patchline_lsp!
      configuration.lsp.typescript.disabled = true
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      await expect(captured.execute({ operation: "workspaceSymbol", query: "needle" }, context)).rejects.toThrow(/configuration.*changed/i)
      expect(client).not.toHaveBeenCalled()
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
    } finally { client.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it.each(["success", "unavailable"])("rejects obsolete SDK %s after configuration changes", async (outcome) => {
    const workspace = await temporaryWorkspace()
    const client = vi.spyOn(lspSearch, "runOpenCodeLspClient")
    const bridge = vi.spyOn(lspSearch, "runOpenCodeLspBridge").mockResolvedValue("obsolete fallback")
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path, client: {} } as never, { lspAutoSetup: false })
      client.mockImplementation(async () => {
        await hooks.config!({ lsp: false } as never)
        if (outcome === "unavailable") throw new PatchlineError("CAPABILITY_UNAVAILABLE", "SDK unavailable")
        return "obsolete symbols"
      })
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      await expect(hooks.tool!.patchline_lsp!.execute({ operation: "workspaceSymbol", query: "needle" }, context)).rejects.toThrow(/configuration.*changed/i)
      expect(client).toHaveBeenCalledOnce()
      expect(bridge).not.toHaveBeenCalled()
    } finally { bridge.mockRestore(); client.mockRestore(); await workspace.cleanup() }
  })
  it("does not start LSP after configuration changes during permission", async () => {
    const workspace = await temporaryWorkspace()
    const bridge = vi.spyOn(lspSearch, "runOpenCodeLspBridge").mockResolvedValue("obsolete")
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { lspAutoSetup: false })
      const captured = hooks.tool!.patchline_lsp!
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: async () => { await hooks.config!({ lsp: false } as never) } } as never
      await expect(captured.execute({ operation: "diagnostics", filePath: "index.ts" }, context)).rejects.toThrow(/configuration.*changed|disabled/i)
      expect(bridge).not.toHaveBeenCalled()
    } finally { bridge.mockRestore(); await workspace.cleanup() }
  })
  it("revokes compact capabilities after the host reports LSP unavailable", async () => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp").mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { workspaceSymbolProvider: true } }])
    const client = vi.spyOn(lspSearch, "runOpenCodeLspClient").mockRejectedValue(new PatchlineError("CAPABILITY_UNAVAILABLE", "No connected server"))
    const bridge = vi.spyOn(lspSearch, "runOpenCodeLspBridge").mockRejectedValue(new PatchlineError("CAPABILITY_UNAVAILABLE", "No connected server"))
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path, client: {} } as never, { toolProfile: "compact" })
      await hooks.config!({ lsp: true } as never)
      const captured = hooks.tool!.patchline_lsp!
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      await expect(captured.execute({ operation: "workspaceSymbol", query: "needle" }, context)).rejects.toThrow(/connected/)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      await expect(captured.execute({ operation: "workspaceSymbol", query: "needle" }, context)).rejects.toThrow(/capability/i)
      expect(client).toHaveBeenCalledOnce()
    } finally { bridge.mockRestore(); client.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it.each(["extended", "compact"])("does not prepare or scan explicitly disabled LSP in %s", async (toolProfile) => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp").mockResolvedValue([])
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile })
      await hooks.config!({ lsp: false } as never)
      expect(prepare).not.toHaveBeenCalled()
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      expect(hooks.tool).not.toHaveProperty("patchline_lsp_status")
    } finally { prepare.mockRestore(); await workspace.cleanup() }
  })
  it.each(["fallback", "diagnostics"])("preserves verified compact capability after %s", async (kind) => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp").mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { workspaceSymbolProvider: true } }])
    const client = vi.spyOn(lspSearch, "runOpenCodeLspClient").mockRejectedValue(new PatchlineError("CAPABILITY_UNAVAILABLE", "SDK unavailable"))
    const bridge = vi.spyOn(lspSearch, "runOpenCodeLspBridge")
    if (kind === "fallback") bridge.mockResolvedValue("symbol found")
    else bridge.mockRejectedValue(new PatchlineError("DIAGNOSTICS_UNAVAILABLE", "Malformed response"))
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path, client: {} } as never, { toolProfile: "compact" })
      await hooks.config!({ lsp: true } as never)
      const captured = hooks.tool!.patchline_lsp!
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      for (let attempt = 0; attempt < 2; attempt++) {
        const pending = captured.execute({ operation: "workspaceSymbol", query: "needle" }, context)
        if (kind === "fallback") expect(await pending).toMatchObject({ output: "symbol found" })
        else await expect(pending).rejects.toThrow(/Malformed response/)
      }
      expect(hooks.tool!.patchline_lsp).toBe(captured)
      expect(client).toHaveBeenCalledTimes(2)
      expect(bridge).toHaveBeenCalledTimes(2)
    } finally { bridge.mockRestore(); client.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it.each(["small", "large", "truncated", "aggregate", "extended", "validation"])("includes a bounded existing diff in compact batch output (%s)", async (kind) => {
    const workspace = await temporaryWorkspace()
    const batch = vi.spyOn(EditService.prototype, "editBatch")
    try {
      const diff = kind === "large" ? "x".repeat(2_001) : "@@ -1 +1 @@\n-before\n+after\n"
      batch.mockResolvedValue(Array.from({ length: kind === "aggregate" ? 400 : 1 }, () => ({ path: "a.ts", snapshot: "next", added: 1, deleted: 1, bytesWritten: 1, warnings: [], diff, diffTruncated: kind === "truncated", output: "a.ts: +1 -1\nsnapshot: next" })))
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: kind === "extended" ? "extended" : "compact", lspAutoSetup: false, ...(kind === "validation" ? { validationCommands: { default: `"${process.execPath}" -e "process.exit(1)"` } } : {}) })
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      const result = await hooks.tool!.patchline_edit_batch!.execute({ edits: [{ filePath: "a.ts", snapshot: "observed", oldString: "before", newString: "after" }] }, context)
      const output = typeof result === "string" ? result : result.output
      expect(output).toContain("snapshot: next")
      if (kind === "extended") expect(output).toBe("a.ts: +1 -1\nsnapshot: next")
      else if (kind !== "small") {
        expect(output).toContain("Diff preview omitted")
        expect(output).not.toContain("x".repeat(100))
        if (kind === "aggregate" || kind === "validation") expect(output).not.toContain("@@")
        if (kind === "validation") expect(output).toMatch(/^Validation failed:/)
      } else expect(output).toContain(diff)
    } finally { batch.mockRestore(); await workspace.cleanup() }
  })
  it("returns the actual compact edit preview without granting observation of its context", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "const hidden = 0\nconst value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact", lspAutoSetup: false })
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      const observed = await hooks.tool!.read!.execute({ filePath: "a.ts", offset: 2, limit: 1 }, context)
      const snapshot = typeof observed === "string" ? "" : observed.metadata?.snapshot
      const result = await hooks.tool!.edit!.execute({ filePath: "a.ts", snapshot, oldString: "const value = 1", newString: "const value = 2" }, context)
      expect(typeof result).not.toBe("string")
      if (typeof result === "string") throw new Error("Expected metadata")
      expect(result.output).toContain("-const value = 1")
      expect(result.output).toContain("+const value = 2")
      await expect(hooks.tool!.edit!.execute({ filePath: "a.ts", snapshot: result.metadata?.snapshot, oldString: "const hidden = 0", newString: "const hidden = 3" }, context)).rejects.toThrow()
      expect(await readFile(path.join(workspace.path, "a.ts"), "utf8")).toBe("const hidden = 0\nconst value = 2\n")
    } finally { await workspace.cleanup() }
  })
  it("rejects missing read paths before permission and path handling", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact", lspAutoSetup: false })
      const ask = vi.fn(async () => undefined)
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask } as never
      for (const filePath of [undefined, null, "", 42]) {
        await expect(hooks.tool!.read!.execute({ filePath } as never, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      }
      for (const args of [undefined, null]) {
        await expect(hooks.tool!.read!.execute(args as never, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      }
      expect(ask).not.toHaveBeenCalled()
    } finally { await workspace.cleanup() }
  })
  it.each(["extended", "compact"])("guides %s reads by anchor and routes patches by change scope", async (toolProfile) => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile })
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]!({} as never, output)
      const policy = output.system.join("\n")
      expect(policy).toContain("read with anchor")
      expect(policy).toContain("File size alone does not select the editing tool")
      expect(policy).not.toContain("for large files, large changes")
    } finally { await workspace.cleanup() }
  })
  it.each(["outside.ts", "nested-other/outside.ts"])("rejects compact document symbols outside the verified server project: %s", async (filePath) => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp")
    const bridge = vi.spyOn(lspSearch, "runOpenCodeLspBridge")
    try {
      await mkdir(path.join(workspace.path, "nested"))
      await mkdir(path.join(workspace.path, "nested-other"))
      await writeFile(path.join(workspace.path, filePath), "const outside = 1\n")
      prepare.mockResolvedValue([{ root: path.join(workspace.path, "nested"), server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { documentSymbolProvider: true } }])
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact" })
      await hooks.config!({ lsp: true } as never)
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      await expect(hooks.tool!.patchline_lsp!.execute({ operation: "documentSymbol", filePath }, context)).rejects.toThrow(/verified.*project/i)
      expect(bridge).not.toHaveBeenCalled()
    } finally { bridge.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it("allows compact document symbols inside the verified server project", async () => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp")
    const bridge = vi.spyOn(lspSearch, "runOpenCodeLspBridge").mockResolvedValue("symbols")
    try {
      await mkdir(path.join(workspace.path, "nested"))
      await writeFile(path.join(workspace.path, "nested/index.ts"), "const inside = 1\n")
      prepare.mockResolvedValue([{ root: path.join(workspace.path, "nested"), server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { documentSymbolProvider: true } }])
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact" })
      await hooks.config!({ lsp: true } as never)
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      await expect(hooks.tool!.patchline_lsp!.execute({ operation: "documentSymbol", filePath: "nested/index.ts" }, context)).resolves.toMatchObject({ output: "symbols" })
      expect(bridge).toHaveBeenCalledOnce()
    } finally { bridge.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })
  it.each(["extended", "compact"])("preserves failed validation in truncated %s batch output", async (toolProfile) => {
    const workspace = await temporaryWorkspace()
    const batch = vi.spyOn(EditService.prototype, "editBatch")
    try {
      batch.mockResolvedValue([{ path: "a.ts", snapshot: "next", added: 1, deleted: 1, bytesWritten: 1, warnings: [], diff: "", diffTruncated: false, output: "x".repeat(25_000) }])
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile, validationCommands: { default: `"${process.execPath}" -e "process.exit(1)"` } })
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) } as never
      const result = await hooks.tool!.patchline_edit_batch!.execute({ edits: [{ filePath: "a.ts", snapshot: "observed", oldString: "before", newString: "after" }] }, context)
      const output = typeof result === "string" ? result : result.output
      expect(output.length).toBeLessThanOrEqual(20_000)
      expect(output).toContain("Validation failed")
      expect(output).toContain("Output truncated")
    } finally { batch.mockRestore(); await workspace.cleanup() }
  })
  it("offers only exact edit arguments in compact and rejects hidden Hashline before permissions", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact", lspAutoSetup: false })
      const edit = hooks.tool!.edit!
      expect(edit.args).not.toHaveProperty("hashlinePatch")
      expect(edit.description).not.toContain("Hashline")
      const ask = vi.fn()
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask } as never
      await expect(edit.execute({ filePath: "index.ts", snapshot: "invented", hashlinePatch: "PUT 1:\n+x" }, context)).rejects.toThrow(/compact.*exact/i)
      expect(ask).not.toHaveBeenCalled()
      const extended = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { lspAutoSetup: false })
      expect(extended.tool!.edit!.args).toHaveProperty("hashlinePatch")
    } finally { await workspace.cleanup() }
  })
  it.each(["extended", "compact"])("publishes mutually exclusive read selector guidance in %s", async (toolProfile) => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile, lspAutoSetup: false })
      const read = hooks.tool!.read!
      expect(read.description).toContain('"filePath":"src/main.ts","offset":1,"limit":80')
      expect((read.args.offset as unknown as { description: string }).description).toContain("Omit this property entirely when using anchor")
      expect((read.args.anchor as unknown as { description: string }).description).toContain("Omit this property entirely when using offset")
    } finally { await workspace.cleanup() }
  })
  it("does not restore compact LSP from preparation that finishes after LSP is disabled", async () => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp")
    try {
      let finish!: (reports: Awaited<ReturnType<typeof lspManager.configureProjectLsp>>) => void
      prepare.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact" })
      const pending = hooks.config!({ lsp: true } as never)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      prepare.mockResolvedValue([])
      await hooks.config!({ lsp: false } as never)
      finish([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { documentSymbolProvider: true } }])
      await pending
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
    } finally { prepare.mockRestore(); await workspace.cleanup() }
  })
  it("rejects previously registered LSP calls after configuration disables LSP", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const symbols = vi.fn().mockResolvedValue([])
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path, client: { find: { symbols } } } as never, { lspAutoSetup: false })
      const lsp = hooks.tool!.patchline_lsp!
      const status = hooks.tool!.patchline_lsp_status!
      await hooks.config!({ lsp: false } as never)
      const ask = vi.fn()
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask } as never
      await expect(lsp.execute({ operation: "workspaceSymbol", query: "needle" }, context)).rejects.toThrow(/disabled/)
      await expect(status.execute({}, context)).rejects.toThrow(/disabled/)
      expect(symbols).not.toHaveBeenCalled()
      expect(ask).not.toHaveBeenCalled()
    } finally { await workspace.cleanup() }
  })
  it("offers compact edits without duplicate routers or policy references to hidden tools", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact" })
      expect(Object.keys(hooks.tool!).sort()).toEqual(["read", "edit", "write", "patchline_edit_batch", "patchline_grep", "ast_search", "patchline_diagnostics", "patchline_lsp"].sort())
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]!({} as never, output)
      expect(output.system.join("\n")).not.toMatch(/patchline_execute|patchline_apply_patch|patchline_route_search/)
      expect(output.system.join("\n")).toContain("patchline_edit_batch")
      expect(Buffer.byteLength(output.system.join("\n"))).toBeLessThan(1800)
      expect(output.system.join("\n")).toContain("Run relevant diagnostics and proportional validation after edits.")
      expect(output.system.join("\n")).toContain('read({"filePath":"src/main.ts","anchor":"function main","limit":40}) replaces grep then read')
      for (const rule of ["snapshot", "stale", "native", "unrelated", "anchor", "offset", "Failed to find expected lines"]) expect(output.system.join("\n")).toContain(rule)
      await hooks.config!({ lsp: false } as never)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      await hooks.config!({ lsp: true } as never)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      expect(hooks.tool).not.toHaveProperty("patchline_lsp_status")
    } finally { await workspace.cleanup() }
  })
  it("offers compact LSP only after a verified symbol capability and invalidates it on config reload", async () => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "configureProjectLsp")
    try {
      prepare.mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { documentSymbolProvider: true } }])
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { toolProfile: "compact" })
      await hooks.config!({ lsp: true } as never)
      expect(hooks.tool).toHaveProperty("patchline_lsp")
      expect((hooks.tool!.patchline_lsp!.args.operation as unknown as { options: string[] }).options).toEqual(["documentSymbol"])
      const captured = hooks.tool!.patchline_lsp!
      prepare.mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "missing", verified: false, detail: "missing" }])
      await hooks.config!({ lsp: true } as never)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      const ask = vi.fn()
      const context = { sessionID: "s", worktree: workspace.path, directory: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask } as never
      await expect(captured.execute({ operation: "documentSymbol", filePath: "index.ts" }, context)).rejects.toThrow(/capability/i)
      expect(ask).not.toHaveBeenCalled()
      prepare.mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { documentSymbolProvider: false, workspaceSymbolProvider: false } }])
      await hooks.config!({ lsp: true } as never)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      prepare.mockRejectedValue(new Error("preparation failed"))
      await hooks.config!({ lsp: true } as never)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      prepare.mockResolvedValue([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { workspaceSymbolProvider: {} } }])
      await hooks.config!({ lsp: true } as never)
      expect(hooks.tool).toHaveProperty("patchline_lsp")
      expect((hooks.tool!.patchline_lsp!.args.operation as unknown as { options: string[] }).options).toEqual(["workspaceSymbol"])
      await expect(captured.execute({ operation: "documentSymbol", filePath: "index.ts" }, context)).rejects.toThrow(/capability/i)
      await expect(captured.execute({ operation: "diagnostics", filePath: "index.ts" }, context)).rejects.toThrow(/capability/i)
      expect(ask).not.toHaveBeenCalled()
    } finally { prepare.mockRestore(); await workspace.cleanup() }
  })

  it("refreshes LSP status without installing after the startup toolchain disappears", async () => {
    const workspace = await temporaryWorkspace()
    const configure = vi.spyOn(lspManager, "configureProjectLsp")
    const prepare = vi.spyOn(lspManager, "prepareProjectLsp")
    try {
      const report = { root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured" as const, verified: true, detail: "verified", capabilities: { documentSymbolProvider: true } }
      configure.mockResolvedValue([report])
      prepare.mockResolvedValue([{ ...report, status: "missing", verified: false, detail: "Server disappeared", capabilities: {} }])
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, {})
      await hooks.config!({ lsp: true } as never)
      const result = await hooks.tool!.patchline_lsp_status!.execute({}, { worktree: workspace.path, abort: new AbortController().signal, ask: async () => {} } as never)
      expect(result).toContain("missing")
      expect(result).not.toContain('"verified": true')
      expect(prepare).toHaveBeenCalledWith(workspace.path, expect.objectContaining({ install: false }))
    } finally { configure.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })

  it("does not restore LSP tools when status refresh finishes after disable", async () => {
    const workspace = await temporaryWorkspace()
    const configure = vi.spyOn(lspManager, "configureProjectLsp").mockResolvedValue([])
    const prepare = vi.spyOn(lspManager, "prepareProjectLsp")
    try {
      let finish!: (reports: Awaited<ReturnType<typeof lspManager.prepareProjectLsp>>) => void
      let started!: () => void
      const ready = new Promise<void>((resolve) => { started = resolve })
      prepare.mockImplementation(() => { started(); return new Promise((resolve) => { finish = resolve }) })
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, {})
      const status = hooks.tool!.patchline_lsp_status!
      await hooks.config!({ lsp: true } as never)
      const pending = status.execute({}, { worktree: workspace.path, abort: new AbortController().signal, ask: async () => {} } as never)
      await ready
      await hooks.config!({ lsp: false } as never)
      finish([{ root: workspace.path, server: "typescript", language: "typescript", sample: "index.ts", evidence: [], status: "configured", verified: true, detail: "verified", capabilities: { documentSymbolProvider: true } }])
      await expect(pending).rejects.toThrow(/configuration.*changed|superseded/i)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
    } finally { configure.mockRestore(); prepare.mockRestore(); await workspace.cleanup() }
  })

  it("rejects an older status refresh when a newer refresh has completed", async () => {
    const workspace = await temporaryWorkspace()
    const prepare = vi.spyOn(lspManager, "prepareProjectLsp")
    try {
      let finish!: (reports: Awaited<ReturnType<typeof lspManager.prepareProjectLsp>>) => void
      let started!: () => void
      const ready = new Promise<void>((resolve) => { started = resolve })
      prepare.mockImplementationOnce(() => { started(); return new Promise((resolve) => { finish = resolve }) }).mockResolvedValue([])
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { lspAutoSetup: false })
      const status = hooks.tool!.patchline_lsp_status!
      const context = { worktree: workspace.path, abort: new AbortController().signal, ask: async () => {} } as never
      const older = status.execute({}, context)
      await ready
      expect(await status.execute({}, context)).toContain('"projects": []')
      finish([])
      await expect(older).rejects.toThrow(/superseded/i)
    } finally { prepare.mockRestore(); await workspace.cleanup() }
  })
  it("omits LSP tool schemas when LSP is explicitly disabled", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      await hooks.config!({ lsp: false } as never)
      expect(hooks.tool).not.toHaveProperty("patchline_lsp")
      expect(hooks.tool).not.toHaveProperty("patchline_lsp_status")
      expect(hooks.tool).toHaveProperty("patchline_grep")
      expect(hooks.tool).toHaveProperty("ast_search")
      await hooks.config!({ lsp: true } as never)
      expect(hooks.tool).toHaveProperty("patchline_lsp")
      expect(hooks.tool).toHaveProperty("patchline_lsp_status")
    } finally { await workspace.cleanup() }
  })
  it("provides one provider-neutral policy with concrete tool-call guidance", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const output = { system: ["Existing host instructions"] }
      const transform = hooks["experimental.chat.system.transform"]!
      await transform({} as never, output)
      await transform({} as never, output)
      expect(output.system.filter((text) => text.startsWith("PATCHLINE EDITING POLICY"))).toHaveLength(1)
      expect(output.system[0]).toBe("Existing host instructions")
      expect(output.system[1]).toContain('"strategy":"exact"')
      expect(output.system[1]).toContain("Omit unused optional fields")
      expect(output.system[1]).toContain("*** Begin Patch")
      expect(output.system[1]).toContain("never invent a snapshot")
      expect(output.system[1]).toContain("When the exact path is known, read that file directly")
      expect(output.system[1]).toContain("Locate only when the path or target is unknown")
    } finally {
      await workspace.cleanup()
    }
  })
  it("routes explicit standard operations without requiring a Patchline snapshot", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const result = await hooks.tool!.patchline_execute!.execute({ strategy: "standard", operations: [{ filePath: "large.ts", snapshot: "" }] }, context)
      expect(result).toMatchObject({ metadata: { status: "fallback_required", nextTool: "apply_patch", writes: 0 } })
      expect(context.ask).not.toHaveBeenCalled()
    } finally {
      await workspace.cleanup()
    }
  })
  it("accepts unused empty exact fields for Hashline and no longer advertises patch strategy", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "hash.ts"), "one\ntwo\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "hash.ts" }, context) as unknown as { metadata: { snapshot: string; tag: string } }
      const result = await hooks.tool!.patchline_execute!.execute({ strategy: "hashline", operations: [{ filePath: "hash.ts", snapshot: first.metadata.snapshot, oldString: "", newString: "", hashlinePatch: `[hash.ts#${first.metadata.tag}]\nPUT 1.=1:\n+changed` }] }, context)
      expect(result).toMatchObject({ metadata: { status: "applied", writes: 1, files: expect.any(Array) } })
      const strategy = hooks.tool!.patchline_execute!.args.strategy as unknown as { safeParse(value: string): { success: boolean } }
      expect(strategy.safeParse("patch").success).toBe(false)
      expect(await readFile(path.join(workspace.path, "hash.ts"), "utf8")).toBe("changed\ntwo\n")
    } finally {
      await workspace.cleanup()
    }
  })
  it("rejects adaptive Hashline targets different from the declared operation", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "declared.ts"), "one\n")
      await writeFile(path.join(workspace.path, "other.ts"), "two\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const declared = await hooks.tool!.read!.execute({ filePath: "declared.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const other = await hooks.tool!.read!.execute({ filePath: "other.ts" }, context) as unknown as { metadata: { tag: string } }
      await expect(hooks.tool!.patchline_execute!.execute({ strategy: "hashline", operations: [{ filePath: "declared.ts", snapshot: declared.metadata.snapshot, hashlinePatch: `[other.ts#${other.metadata.tag}]\nPUT 1.=1:\n+changed` }] }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      expect(await readFile(path.join(workspace.path, "other.ts"), "utf8")).toBe("two\n")
    } finally {
      await workspace.cleanup()
    }
  })
  it("authorizes external file creation and search", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const filePath = path.join(outside.path, "nested", "source.ts")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      await hooks.tool!.write!.execute({ filePath, content: "const external = true\n" }, context)
      const result = await hooks.tool!.patchline_grep!.execute({ path: filePath, pattern: "external" }, context)
      expect(typeof result === "string" ? result : result.output).toContain("external")
      expect(await readFile(filePath, "utf8")).toBe("const external = true\n")
    } finally {
      await outside.cleanup()
      await workspace.cleanup()
    }
  })
  it("invalidates observed snapshots before a native patch can partially change files", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "native.ts"), "before\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "native.ts" }, context) as unknown as { metadata: { snapshot: string } }
      await hooks["tool.execute.before"]?.({ tool: "apply_patch", sessionID: "s", callID: "c" }, { args: { patchText: "*** Begin Patch\n*** Update File: native.ts\n-before\n+after\n*** End Patch" } })
      await expect(hooks.tool!.edit!.execute({ filePath: "native.ts", snapshot: first.metadata.snapshot, oldString: "before", newString: "after" }, context)).rejects.toMatchObject({ code: "SNAPSHOT_NOT_FOUND" })
    } finally {
      await workspace.cleanup()
    }
  })
  it("authorizes external reads and edits without changing the snapshot worktree scope", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const filePath = path.join(outside.path, "config.json")
      await writeFile(filePath, "{\n  \"value\": 1\n}\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const ask = vi.fn(async () => undefined)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask }
      const first = await hooks.tool!.read!.execute({ filePath }, context) as unknown as { metadata: { snapshot: string } }
      await hooks.tool!.edit!.execute({ filePath, snapshot: first.metadata.snapshot, oldString: "1", newString: "2" }, context)
      expect(await readFile(filePath, "utf8")).toContain("\"value\": 2")
      expect(ask).toHaveBeenCalledWith(expect.objectContaining({ permission: "external_directory" }))
      const denied = { ...context, ask: vi.fn(async (request: { permission: string }) => { if (request.permission === "external_directory") throw new Error("denied") }) }
      await expect(hooks.tool!.read!.execute({ filePath }, denied)).rejects.toThrow("denied")
    } finally {
      await outside.cleanup()
      await workspace.cleanup()
    }
  })
  it("leaves the native apply_patch available for existing files in precision mode", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "native.ts"), "before\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      expect(hooks.tool).not.toHaveProperty("apply_patch")
      expect(hooks.tool).toHaveProperty("patchline_apply_patch")
      await expect(hooks["tool.execute.before"]?.({ tool: "apply_patch", sessionID: "s", callID: "c" }, { args: { patchText: "*** Begin Patch\n*** Update File: native.ts\n-before\n+after\n*** End Patch" } })).resolves.toBeUndefined()
    } finally {
      await workspace.cleanup()
    }
  })
  it("accepts an exact deletion with an empty unused Hashline field", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "empty-field.ts"), "keep\nremove\nkeep too\nend\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "empty-field.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const result = await hooks.tool!.patchline_execute!.execute({ strategy: "exact", operations: [{ filePath: "empty-field.ts", snapshot: first.metadata.snapshot, oldString: "remove\n", newString: "", hashlinePatch: "" }] }, context)
      expect(result).toMatchObject({ metadata: { status: "applied", writes: 1 } })
      expect(await readFile(path.join(workspace.path, "empty-field.ts"), "utf8")).toBe("keep\nkeep too\nend\n")
    } finally {
      await workspace.cleanup()
    }
  })
  it.each([
    "cat input.txt > output.txt",
    "printf 'bad' > output.txt",
    "python -c \"open('output.txt', 'w').write('bad')\"",
    "node -e \"require('fs').writeFileSync('output.txt', 'bad')\"",
  ])("blocks common direct shell write form: %s", async (command) => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      await expect(hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s", callID: "c" },
        { args: { command } },
      )).rejects.toMatchObject({ code: "FALLBACK_REJECTED" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("registers familiar precision tools and blocks direct shell writes", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      expect(Object.keys(hooks.tool ?? {})).toEqual(expect.arrayContaining(["read", "edit", "write", "patchline_apply_patch", "patchline_execute", "ast_search", "patchline_lsp"]))
      await expect(hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s", callID: "c" },
        { args: { command: "Set-Content -Path a.ts -Value bad" } },
      )).rejects.toMatchObject({ code: "FALLBACK_REJECTED" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("returns a compact standard-tool fallback for large adaptive changes", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const largeContent = Array.from({ length: 300 }, (_, index) => `line-${index}\n`).join("")
      const largeReplacement = Array.from({ length: 140 }, (_, index) => `replacement-${index}\n`).join("")
      await writeFile(path.join(workspace.path, "large.ts"), largeContent)
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "large.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const result = await hooks.tool!.patchline_execute!.execute({ strategy: "auto", operations: [{ filePath: "large.ts", snapshot: first.metadata.snapshot, oldString: Array.from({ length: 140 }, (_, index) => `line-${index}\n`).join(""), newString: largeReplacement }] }, context)
      expect(result).toMatchObject({ metadata: { status: "fallback_required", strategy: "standard", writes: 0 } })
      await expect(readFile(path.join(workspace.path, "large.ts"), "utf8")).resolves.toBe(largeContent)
    } finally {
      await workspace.cleanup()
    }
  })

  it("routes a ratio-sized replacement to the standard tool without writing", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const content = Array.from({ length: 100 }, (_, index) => `line-${index}\n`).join("")
      const replacement = Array.from({ length: 40 }, (_, index) => `replacement-${index}\n`).join("")
      await writeFile(path.join(workspace.path, "ratio.ts"), content)
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "ratio.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const result = await hooks.tool!.patchline_execute!.execute({ strategy: "auto", operations: [{ filePath: "ratio.ts", snapshot: first.metadata.snapshot, oldString: content.split("\n").slice(0, 40).join("\n"), newString: replacement }] }, context)
      expect(result).toMatchObject({ metadata: { status: "fallback_required", strategy: "standard", writes: 0 } })
      await expect(readFile(path.join(workspace.path, "ratio.ts"), "utf8")).resolves.toBe(content)
    } finally {
      await workspace.cleanup()
    }
  })

  it("routes the exact 35 percent boundary using logical snapshot lines", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const content = Array.from({ length: 100 }, (_, index) => `line-${index}\n`).join("")
      const replacement = Array.from({ length: 35 }, (_, index) => `replacement-${index}\n`).join("")
      await writeFile(path.join(workspace.path, "boundary.ts"), content)
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "boundary.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const result = await hooks.tool!.patchline_execute!.execute({ strategy: "auto", operations: [{ filePath: "boundary.ts", snapshot: first.metadata.snapshot, oldString: content.split("\n").slice(0, 35).join("\n"), newString: replacement }] }, context)
      expect(result).toMatchObject({ metadata: { status: "fallback_required", strategy: "standard", writes: 0 } })
      await expect(readFile(path.join(workspace.path, "boundary.ts"), "utf8")).resolves.toBe(content)
    } finally {
      await workspace.cleanup()
    }
  })

  it("routes replaceAll by the affected snapshot lines", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const content = Array.from({ length: 100 }, () => "x\n").join("")
      await writeFile(path.join(workspace.path, "replace-all.ts"), content)
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "replace-all.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const result = await hooks.tool!.patchline_execute!.execute({ strategy: "auto", operations: [{ filePath: "replace-all.ts", snapshot: first.metadata.snapshot, oldString: "x", newString: "y", replaceAll: true }] }, context)
      expect(result).toMatchObject({ metadata: { status: "fallback_required", strategy: "standard", writes: 0 } })
      await expect(readFile(path.join(workspace.path, "replace-all.ts"), "utf8")).resolves.toBe(content)
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects unsupported explicit patch strategy", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "patch.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "patch.ts" }, context) as unknown as { metadata: { snapshot: string } }
      await expect(hooks.tool!.patchline_execute!.execute({ strategy: "patch", operations: [{ filePath: "patch.ts", snapshot: first.metadata.snapshot, oldString: "const value = 1", newString: "const value = 2" }] }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects mixed exact and Hashline adaptive operations", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "mixed.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "mixed.ts" }, context) as unknown as { metadata: { snapshot: string; tag: string } }
      await expect(hooks.tool!.patchline_execute!.execute({ strategy: "auto", operations: [{ filePath: "mixed.ts", snapshot: first.metadata.snapshot, oldString: "const value = 1", newString: "const value = 2" }, { filePath: "mixed.ts", snapshot: first.metadata.snapshot, hashlinePatch: `[mixed.ts#${first.metadata.tag}]\nPUT 1: const value = 3` }] }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects one adaptive operation with both exact and Hashline representations", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "ambiguous.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "ambiguous.ts" }, context) as unknown as { metadata: { snapshot: string; tag: string } }
      await expect(hooks.tool!.patchline_execute!.execute({ strategy: "auto", operations: [{
        filePath: "ambiguous.ts",
        snapshot: first.metadata.snapshot,
        oldString: "const value = 1",
        newString: "const value = 2",
        hashlinePatch: `[ambiguous.ts#${first.metadata.tag}]\nPUT 1: const value = 3`,
      }] }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("uses UTF-8 bytes when routing payload size", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "unicode.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const first = await hooks.tool!.read!.execute({ filePath: "unicode.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const operation = { filePath: "unicode.ts", snapshot: first.metadata.snapshot, oldString: "const value = 1", newString: "😀".repeat(40_000) }
      const result = await hooks.tool!.patchline_execute!.execute({ strategy: "auto", operations: [operation] }, context)
      expect(result).toMatchObject({ metadata: { status: "fallback_required", strategy: "standard", writes: 0 } })
    } finally {
      await workspace.cleanup()
    }
  })

  it("uses adaptive execution for a multi-file exact edit", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "const a = 1\n")
      await writeFile(path.join(workspace.path, "b.ts"), "const b = 1\n")
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
      const first = await hooks.tool!.read!.execute({ filePath: "a.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const second = await hooks.tool!.read!.execute({ filePath: "b.ts" }, context) as unknown as { metadata: { snapshot: string } }
      const result = await hooks.tool!.patchline_execute!.execute({
        strategy: "auto",
        operations: [
          { filePath: "a.ts", snapshot: first.metadata.snapshot, oldString: "1", newString: "2" },
          { filePath: "b.ts", snapshot: second.metadata.snapshot, oldString: "1", newString: "2" },
        ],
      }, context)
      expect(result).toMatchObject({ metadata: { status: "applied", strategy: "batch", writes: 2 } })
      await expect(readFile(path.join(workspace.path, "a.ts"), "utf8")).resolves.toBe("const a = 2\n")
      await expect(readFile(path.join(workspace.path, "b.ts"), "utf8")).resolves.toBe("const b = 2\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects adaptive mutation operations without a snapshot", async () => {
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
      await expect(hooks.tool!.patchline_execute!.execute({
        strategy: "auto",
        operations: [{ filePath: "missing.ts", oldString: "old", newString: "new" }],
      }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: expect.stringContaining("snapshot") })
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
      expect(read).toMatchObject({ metadata: { status: "observed", recoveryAction: "Use the returned snapshot for an edit." } })
      const snapshot = typeof read === "string" ? "" : String(read.metadata?.snapshot)
      const edit = await hooks.tool!.edit!.execute({ filePath: "a.ts", snapshot, oldString: "1", newString: "2" }, context)
      expect(typeof edit === "string" ? edit : edit.output).toContain("Diff: +1 -1")
      expect(edit).toMatchObject({ metadata: { status: "applied", writes: 1, recoveryAction: "Use the returned snapshot for the next edit.", bytesWritten: Buffer.byteLength("const value = 2\n", "utf8") } })
      expect(context.metadata).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ status: "running", stage: "committing", path: "a.ts" }) }))
      expect(typeof edit === "string" ? "" : edit.metadata?.diff).toContain("-const value = 1")
      expect(typeof edit === "string" ? "" : edit.metadata?.diff).toContain("+const value = 2")
      expect(typeof edit === "string" ? "" : edit.metadata?.diff).toMatch(/^Index: a\.ts\n={5,}\n--- a\.ts\n\+\+\+ a\.ts\n@@/)
      expect(context.metadata).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ stage: "preflight" }) }))
      expect(ask).toHaveBeenCalledTimes(5)
    } finally {
      await workspace.cleanup()
    }
  })

  it("runs a guarded batch edit through the precision tool contract", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "first.ts"), "const first = 1\n")
      await writeFile(path.join(workspace.path, "second.ts"), "const second = 2\n")
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
      const firstRead = await hooks.tool!.read!.execute({ filePath: "first.ts" }, context)
      const secondRead = await hooks.tool!.read!.execute({ filePath: "second.ts" }, context)
      const firstSnapshot = typeof firstRead === "string" ? "" : String(firstRead.metadata?.snapshot)
      const secondSnapshot = typeof secondRead === "string" ? "" : String(secondRead.metadata?.snapshot)
      const result = await hooks.tool!.patchline_edit_batch!.execute({ edits: [
        { filePath: "first.ts", snapshot: firstSnapshot, oldString: "1", newString: "10" },
        { filePath: "second.ts", snapshot: secondSnapshot, oldString: "2", newString: "20" },
      ] }, context)
      expect(typeof result === "string" ? result : result.output).toContain("Diff: +1 -1")
      expect(result).toMatchObject({ metadata: { status: "applied", files: [expect.objectContaining({ path: "first.ts", diff: expect.stringContaining("-const first = 1") }), expect.objectContaining({ path: "second.ts", diff: expect.stringContaining("+const second = 20") })] } })
      expect(await readFile(path.join(workspace.path, "first.ts"), "utf8")).toBe("const first = 10\n")
      expect(await readFile(path.join(workspace.path, "second.ts"), "utf8")).toBe("const second = 20\n")
      expect(ask).toHaveBeenCalledTimes(9)
    } finally {
      await workspace.cleanup()
    }
  })

  it("keeps failed batch edits as errors with visible preflight details and zero writes", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "duplicate.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = {
        sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path,
        abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined),
      }
      const read = await hooks.tool!.read!.execute({ filePath: "duplicate.ts" }, context)
      const snapshot = typeof read === "string" ? "" : String(read.metadata?.snapshot)
      await expect(hooks.tool!.patchline_edit_batch!.execute({ edits: [
        { filePath: "duplicate.ts", snapshot, oldString: "1", newString: "2" },
        { filePath: "duplicate.ts", snapshot, oldString: "1", newString: "3" },
      ] }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      expect(context.metadata).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ status: "failed", stage: "preflight", writes: 0, code: "INVALID_ARGUMENT", paths: ["duplicate.ts"] }) }))
      expect(await readFile(path.join(workspace.path, "duplicate.ts"), "utf8")).toBe("const value = 1\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("returns structured creation metadata", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const result = await hooks.tool!.write!.execute({ filePath: "created.ts", content: "export {}\n" }, {
        sessionID: "s",
        messageID: "m",
        agent: "build",
        directory: workspace.path,
        worktree: workspace.path,
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(async () => undefined),
      })

      expect(result).toMatchObject({ metadata: { status: "applied", created: true, bytesWritten: Buffer.byteLength("export {}\n", "utf8"), recoveryAction: "Read the new file before editing it." } })
    } finally {
      await workspace.cleanup()
    }
  })

  it("truncates a formatted grep response above the output budget", async () => {
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

      const result = await hooks.tool!.patchline_grep!.execute({ pattern: "NEEDLE", path: "many.ts", maxResults: 30 }, context)
      const output = typeof result === "string" ? result : result.output
      expect(output.length).toBeLessThanOrEqual(20_000)
      expect(output).toContain("Results truncated")
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

      const output = await hooks.tool!.patchline_apply_patch!.execute({ patchText }, context)
      expect(typeof output === "string" ? output : output.output).toHaveLength(20_000)
      expect(typeof output === "string" ? output : output.output).toContain("Output truncated")
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

      await expect(hooks.tool!.patchline_apply_patch!.execute({ patchText: `*** Begin Patch\n*** Add File: oversized.ts\n+${"x".repeat(8 * 1024 * 1024)}\n*** End Patch` }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      expect(ask).not.toHaveBeenCalled()
    } finally {
      await workspace.cleanup()
    }
  })

  it("reports writes and paths for single-file creation and pre-write failures", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const result = await hooks.tool!.write!.execute({ filePath: "new.ts", content: "new\n" }, context)
      expect(result).toMatchObject({ metadata: { writes: 1, path: "new.ts", paths: ["new.ts"], stage: "completed", bytesWritten: 4 } })
      await expect(hooks.tool!.write!.execute({ filePath: "new.ts", content: "overwrite\n" }, context)).rejects.toMatchObject({ code: "WRITE_PROTECTED" })
      expect(context.metadata).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ status: "failed", stage: "preflight", writes: 0, path: "new.ts", paths: ["new.ts"] }) }))
    } finally {
      await workspace.cleanup()
    }
  })

  it("caps aggregate batch previews while retaining exact per-file totals", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const edits = []
      for (const filePath of ["first.ts", "second.ts", "third.ts"]) {
        await writeFile(path.join(workspace.path, filePath), "old\n")
        const observed = await hooks.tool!.read!.execute({ filePath }, context)
        edits.push({ filePath, snapshot: String(typeof observed === "string" ? "" : observed.metadata?.snapshot), oldString: "old", newString: "x".repeat(12_000) })
      }
      const result = await hooks.tool!.patchline_edit_batch!.execute({ edits }, context)
      if (typeof result === "string") throw new Error("Expected metadata")
      const files = result.metadata!.files as Array<{ diff: string; patch?: string; diffTruncated: boolean }>
      expect(files.reduce((size, file) => size + file.diff.length + (file.patch?.length ?? 0), 0)).toBeLessThanOrEqual(20_000)
      expect(files[1]).toMatchObject({ diff: "", diffTruncated: true })
      expect(result.metadata).toMatchObject({ writes: 3, added: 3, deleted: 3 })
    } finally {
      await workspace.cleanup()
    }
  })

  it("counts blank added lines and marks omitted oversized diff hunks", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const created = await hooks.tool!.patchline_apply_patch!.execute({ patchText: "*** Begin Patch\n*** Add File: blank.ts\n+first\n+\n+last\n*** End Patch" }, context)
      expect(created).toMatchObject({ metadata: { writes: 1, files: [{ additions: 3, deletions: 0 }] } })
      const observed = await hooks.tool!.read!.execute({ filePath: "blank.ts" }, context)
      const edited = await hooks.tool!.edit!.execute({ filePath: "blank.ts", snapshot: String(typeof observed === "string" ? "" : observed.metadata?.snapshot), oldString: "first", newString: "x".repeat(25_000) }, context)
      expect(edited).toMatchObject({ metadata: { diff: "", diffTruncated: true, added: 1, deleted: 1 } })
      expect(await readFile(path.join(workspace.path, "blank.ts"), "utf8")).toContain("x".repeat(25_000))
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
      const result = await hooks.tool!.patchline_apply_patch!.execute({ patchText: "*** Begin Patch\n*** Add File: created.ts\n+export {}\n*** End Patch" }, context)
      expect(typeof result === "string" ? result : result.output).toContain("Created: created.ts")
      expect(result).toMatchObject({ metadata: { files: [expect.objectContaining({ type: "add", relativePath: "created.ts", patch: expect.stringContaining("+export {}") })] } })
      await expect(hooks.tool!.patchline_apply_patch!.execute({ patchText: "*** Begin Patch\n*** Update File: created.ts\n-old\n+new\n*** End Patch" }, context)).rejects.toMatchObject({ code: "FALLBACK_REJECTED" })
      expect(context.metadata).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ status: "failed", code: "FALLBACK_REJECTED", stage: "preflight" }) }))
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

      await expect(hooks.tool!.patchline_apply_patch!.execute({ patchText }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
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

      await expect(hooks.tool!.patchline_apply_patch!.execute({ patchText: "ignored prefix\n[missing.ts#ABCD]\nPUT 1:1\n+value" }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
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
        recoveryAction: "Re-read the affected range and retry the edit.",
      })
      expect(context.metadata).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ status: "failed", stage: "preflight", path: "stale.ts", writes: 0, code: "STALE_SNAPSHOT" }) }))
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
      expect(ask).toHaveBeenCalledWith({ permission: "bash", patterns: [command], always: ["*"], metadata: { command, reason: "post-edit validation" } })
      expect(context.metadata).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ status: "failed", stage: "validation", path: "validated.ts", writes: 1 }) }))
      expect(await readFile(path.join(workspace.path, "validated.ts"), "utf8")).toBe("const value = 2\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("keeps an applied diff visible when validation exits unsuccessfully", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "failed.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { validationCommands: { default: `"${process.execPath}" -e "process.exit(1)"` } })
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const observed = await hooks.tool!.read!.execute({ filePath: "failed.ts" }, context)
      const result = await hooks.tool!.edit!.execute({ filePath: "failed.ts", snapshot: String(typeof observed === "string" ? "" : observed.metadata?.snapshot), oldString: "1", newString: "2" }, context)
      expect(result).toMatchObject({ metadata: { status: "applied", writes: 1, validation: "failed", reason: expect.stringContaining("Validation failed"), diff: expect.stringContaining("+const value = 2") } })
      expect(await readFile(path.join(workspace.path, "failed.ts"), "utf8")).toBe("const value = 2\n")
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
      expect(hooks.tool).not.toHaveProperty("patchline_edit_batch")
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
      await expect(hooks.tool!.patchline_apply_patch!.execute({ patchText: "*** Begin Patch\n*** Add File: created.ts\n+export {}\n*** End Patch" }, {
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

  it("reports structured search, route, LSP, diagnostics and summary results", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "const needle = 1\n")
      const client = { find: { symbols: vi.fn(async () => ({ data: [{ name: "needle" }] })) } }
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path, client } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      expect(await hooks.tool!.patchline_grep!.execute({ pattern: "needle", path: "a.ts" }, context)).toMatchObject({ metadata: { kind: "search", resultCount: 1, truncated: false } })
      expect(await hooks.tool!.patchline_route_search!.execute({ query: "find symbols" }, context)).toMatchObject({ output: "lsp", metadata: { kind: "route", mechanism: "lsp" } })
      expect(await hooks.tool!.patchline_lsp!.execute({ operation: "workspaceSymbol", query: "needle" }, context)).toMatchObject({ metadata: { kind: "lsp", operation: "workspaceSymbol" } })
      expect(await hooks.tool!.patchline_diagnostics!.execute({ command: `"${process.execPath}" -e "process.exit(0)"` }, context)).toMatchObject({ metadata: { kind: "diagnostics", exitCode: 0 } })
      expect(await hooks.tool!.patchline_summary!.execute({}, context)).toMatchObject({ metadata: { kind: "summary", summary: { reads: 0, searches: 1, diagnostics: 1 } } })
      expect(context.metadata).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ stage: "searching" }) }))
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not let a presentation callback failure prevent reading or writing", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "const value = 1\n")
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(() => { throw new Error("renderer unavailable") }), ask: vi.fn(async () => undefined) }
      const read = await hooks.tool!.read!.execute({ filePath: "a.ts" }, context)
      expect(read).toMatchObject({ metadata: { kind: "read", path: "a.ts", lines: 1 } })
      const snapshot = typeof read === "string" ? "" : String(read.metadata?.snapshot)
      await hooks.tool!.edit!.execute({ filePath: "a.ts", snapshot, oldString: "1", newString: "2" }, context)
      expect(await readFile(path.join(workspace.path, "a.ts"), "utf8")).toBe("const value = 2\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it.each(["write", "classic", "hashline", "batch", "adaptive", "adaptiveHashline"])("runs configured validation after %s mutations", async (kind) => {
    const workspace = await temporaryWorkspace()
    try {
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never, { validationCommands: { default: `"${process.execPath}" -e "process.exit(1)"` } })
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      let result
      if (kind === "write") result = await hooks.tool!.write!.execute({ filePath: "a.ts", content: "before\n" }, context)
      else if (kind === "classic") result = await hooks.tool!.patchline_apply_patch!.execute({ patchText: "*** Begin Patch\n*** Add File: a.ts\n+before\n*** End Patch" }, context)
      else {
        await writeFile(path.join(workspace.path, "a.ts"), "before\n// preserved\n// preserved too\n// untouched\n")
        const read = await hooks.tool!.read!.execute({ filePath: "a.ts" }, context)
        const snapshot = typeof read === "string" ? "" : String(read.metadata?.snapshot)
        const tag = typeof read === "string" ? "" : String(read.metadata?.tag)
        result = kind === "adaptiveHashline"
          ? await hooks.tool!.patchline_execute!.execute({ strategy: "hashline", operations: [{ filePath: "a.ts", snapshot, hashlinePatch: `[a.ts#${tag}]\nPUT 1.=1:\n+after` }] }, context)
          : kind === "adaptive"
          ? await hooks.tool!.patchline_execute!.execute({ strategy: "exact", operations: [{ filePath: "a.ts", snapshot, oldString: "before", newString: "after" }] }, context)
          : kind === "hashline"
          ? await hooks.tool!.patchline_apply_patch!.execute({ patchText: `[a.ts#${tag}]\nPUT 1.=1:\n+after` }, context)
          : await hooks.tool!.patchline_edit_batch!.execute({ edits: [{ filePath: "a.ts", snapshot, oldString: "before", newString: "after" }] }, context)
      }
      expect(result).toMatchObject({ metadata: { status: "applied", writes: 1, validation: "failed" } })
      expect(typeof result === "string" ? result : result.output).toContain("Validation failed")
      expect(typeof result === "string" ? result : result.output).toContain("exit 1")
      expect(typeof result === "string" ? result : result.output).toContain("process.exit(1)")
      expect(context.ask).toHaveBeenCalledWith(expect.objectContaining({ permission: "bash" }))
    } finally { await workspace.cleanup() }
  })

  it("returns complete bounded search rows and reports skipped files", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "many.ts"), `${"needle".padEnd(1_000, "x")}\n`.repeat(100))
      await writeFile(path.join(workspace.path, "invalid.ts"), Buffer.from([0xff]))
      const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
      const result = await hooks.tool!.patchline_grep!.execute({ pattern: "needle", maxResults: 100 }, context)
      const output = typeof result === "string" ? result : result.output
      expect(output.length).toBeLessThanOrEqual(20_000)
      expect(output).toContain("Results truncated")
      expect(output).toContain("Skipped 1 file")
      expect(output).toContain("ENCODING_UNSUPPORTED")
    } finally { await workspace.cleanup() }
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
