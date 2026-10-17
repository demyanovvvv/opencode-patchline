import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { astSearchFile, collectBoundedAstMatches, type AstTraversalNode } from "../src/search/ast.js"
import { readBoundedUtf8Bytes } from "../src/io/bounded-file.js"
import { grepWorkspace } from "../src/search/grep.js"
import { buildLspArgs, interpretLspOutput, runOpenCodeLspBridge, runOpenCodeLspClient } from "../src/search/lsp.js"
import { routeSearch } from "../src/search/router.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("search", () => {
  it("defers the native AST parser until a valid search needs it", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "main.ts"), "const value = 1\n")
      const code = `import { createRequire } from 'node:module';const require=createRequire(import.meta.url);const {astSearchFile}=await import('./src/search/ast.ts');const loaded=()=>Object.keys(require.cache).some(file=>file.includes('@ast-grep'));const states=[loaded()];try{await astSearchFile({worktree:${JSON.stringify(workspace.path)},filePath:'main.ts',pattern:'$A',maxResults:0})}catch{}states.push(loaded());const result=await astSearchFile({worktree:${JSON.stringify(workspace.path)},filePath:'main.ts',pattern:'const $A = $B',maxResults:1});states.push(loaded());console.log(JSON.stringify({states,matches:result.matches.length}))`
      const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd() })
      expect(JSON.parse(stdout)).toEqual({ states: [false, false, true], matches: 1 })
    } finally { await workspace.cleanup() }
  })
  it("bounds AST traversal after one match beyond the requested result limit", () => {
    const visited: string[] = []
    const node = (name: string, children: AstTraversalNode[] = []): AstTraversalNode => ({
      children: () => children,
      matches: () => {
        visited.push(name)
        return name.startsWith("match")
      },
    })
    const root = node("root", [node("match-1"), node("match-2"), node("match-3")])

    const result = collectBoundedAstMatches(root, {}, 2)

    expect(result.matches).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(visited).toEqual(["root", "match-1", "match-2", "match-3"])
  })

  it("uses the active OpenCode client for workspace symbols when available", async () => {
    const calls: unknown[] = []
    const result = await runOpenCodeLspClient({ find: { symbols: async (input) => { calls.push(input); return [{ name: "value" }] } } }, { worktree: "C:/worktree", query: "value" })
    expect(JSON.parse(result)).toEqual([{ name: "value" }])
    expect(calls).toEqual([{ query: { query: "value", directory: "C:/worktree" }, signal: expect.any(AbortSignal) }])
  })

  it("does not call SDK symbols without a connected active LSP client", async () => {
    let calls = 0
    await expect(runOpenCodeLspClient({
      lsp: { status: async () => ({ data: [] }) },
      find: { symbols: async () => { calls++; return { data: [] } } },
    }, { worktree: "C:/worktree", query: "value" })).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE", message: expect.stringContaining("ast_search"),
    })
    expect(calls).toBe(0)
  })

  it.each([undefined, null, {}, { data: null }, { data: {} }, "[]"])("rejects malformed SDK symbols response %j", async (response) => {
    await expect(runOpenCodeLspClient({
      find: { symbols: async () => response },
    }, { worktree: "C:/worktree", query: "value" })).rejects.toMatchObject({ code: "DIAGNOSTICS_UNAVAILABLE" })
  })

  it("allows legitimate empty SDK search results with a connected client", async () => {
    const calls: unknown[] = []
    const result = await runOpenCodeLspClient({
      lsp: { status: async (input) => { calls.push(input); return { data: [{ status: "connected" }] } } },
      find: { symbols: async () => ({ data: [] }) },
    }, { worktree: "C:/worktree", query: "missing" })
    expect(JSON.parse(result)).toEqual({ data: [] })
    expect(calls).toEqual([{ query: { directory: "C:/worktree" } }])
  })

  it.each([{ error: { message: "offline" } }, { data: null }, [{ status: "disconnected" }]])("does not search with unavailable SDK status %j", async (status) => {
    let calls = 0
    await expect(runOpenCodeLspClient({
      lsp: { status: async () => status },
      find: { symbols: async () => { calls++; return [] } },
    }, { worktree: "C:/worktree", query: "value" })).rejects.toBeDefined()
    expect(calls).toBe(0)
  })

  it("bounds a stalled SDK status probe by the shared request deadline", async () => {
    let calls = 0
    await expect(runOpenCodeLspClient({
      lsp: { status: async () => new Promise(() => {}) },
      find: { symbols: async () => { calls++; return [] } },
    }, { worktree: "C:/worktree", query: "value", timeoutMs: 10 })).rejects.toMatchObject({ code: "DIAGNOSTICS_UNAVAILABLE" })
    expect(calls).toBe(0)
  })

  it("does not launch symbols when cancellation occurs during SDK status", async () => {
    const controller = new AbortController()
    let calls = 0
    let finishStatus!: (value: unknown) => void
    let started!: () => void
    const statusStarted = new Promise<void>((resolve) => { started = resolve })
    const result = runOpenCodeLspClient({
      lsp: { status: () => { started(); return new Promise((resolve) => { finishStatus = resolve }) } },
      find: { symbols: async () => { calls++; return [] } },
    }, { worktree: "C:/worktree", query: "value", signal: controller.signal })
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" })
    await statusStarted
    controller.abort()
    await rejected
    finishStatus({ data: [{ status: "connected" }] })
    await Promise.resolve()
    expect(calls).toBe(0)
  })

  it("routes semantic, structural and literal queries", () => {
    expect(routeSearch("find references to createOrder")).toBe("lsp")
    expect(routeSearch("find structural pattern for empty catch")).toBe("ast")
    expect(routeSearch("find API_KEY text")).toBe("grep")
  })

  it("reports disabled OpenCode LSP instead of returning an empty symbol result", () => {
    expect(() => interpretLspOutput("documentSymbol", "[]", "all LSPs are disabled", 0)).toThrowError(expect.objectContaining({
      code: "CAPABILITY_UNAVAILABLE",
      message: expect.stringContaining("ast_search"),
      details: { operation: "documentSymbol", lsp: "disabled" },
    }))
  })

  it("reports empty symbol output as an unverified CLI indexing capability", () => {
    for (const operation of ["workspaceSymbol", "documentSymbol"] as const) {
      expect(() => interpretLspOutput(operation, "[]", "enabled LSP servers", 0)).toThrowError(expect.objectContaining({ code: "CAPABILITY_UNAVAILABLE", message: expect.stringContaining("native OpenCode LSP") }))
    }
    expect(interpretLspOutput("documentSymbol", '[{"name":"value"}]', "", 0)).toBe('[{"name":"value"}]')
    expect(interpretLspOutput("diagnostics", "{}", "", 0)).toBe("{}")
  })

  it("preserves non-zero LSP bridge failures as diagnostics errors", () => {
    expect(() => interpretLspOutput("diagnostics", "", "language server crashed", 1)).toThrowError(expect.objectContaining({
      code: "DIAGNOSTICS_UNAVAILABLE",
    }))
  })

  it("does not report clean diagnostics when the CLI produced no result", () => {
    for (const output of ["", " \n\t"]) {
      expect(() => interpretLspOutput("diagnostics", output, "enabled LSP servers", 0)).toThrowError(expect.objectContaining({
        code: "DIAGNOSTICS_UNAVAILABLE",
        message: expect.stringContaining("no diagnostics result"),
      }))
    }
    expect(interpretLspOutput("diagnostics", "[]", "", 0)).toBe("[]")
    expect(interpretLspOutput("diagnostics", "{}", "", 0)).toBe("{}")
  })

  it("bounds capability failure details returned from OpenCode startup logs", () => {
    expect(() => interpretLspOutput("documentSymbol", "", `all LSPs are disabled ${"x".repeat(10_000)}`, 0)).toThrowError(
      expect.objectContaining({ message: expect.stringMatching(/LSP detail truncated/) }),
    )
  })

  it("resolves the OpenCode executable beside Node when PATH lacks the npm prefix", async () => {
    if (process.platform !== "win32") return
    const workspace = await temporaryWorkspace()
    const originalPath = process.env.PATH
    try {
      process.env.PATH = ""
      await expect(runOpenCodeLspBridge({ worktree: workspace.path, operation: "workspaceSymbol", query: "value" })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" })
    } finally {
      process.env.PATH = originalPath
      await workspace.cleanup()
    }
  })

  it("requests OpenCode startup logs so disabled LSP is distinguishable from no results", () => {
    expect(buildLspArgs("documentSymbol", "file:///tmp/file.ts")).toEqual([
      "debug",
      "lsp",
      "document-symbols",
      "file:///tmp/file.ts",
      "--pure",
      "--print-logs",
      "--log-level",
      "INFO",
    ])
  })

  it("finds bounded literal matches", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "one.ts"), "API_KEY\nAPI_KEY\n")
      const result = await grepWorkspace({ worktree: workspace.path, pattern: "API_KEY", include: "*.ts", maxResults: 1 })
      expect(result.matches).toHaveLength(1)
      expect(result.truncated).toBe(true)
    } finally {
      await workspace.cleanup()
    }
  })

  it("skips oversized files before loading them into search memory", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "oversized.txt"), `${"x".repeat(10 * 1024 * 1024)}needle`)

      const result = await grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 10 })

      expect(result).toMatchObject({ matches: [], truncated: false, skipped: [{ path: "oversized.txt", reason: "INVALID_ARGUMENT" }], skippedCount: 1 })
    } finally {
      await workspace.cleanup()
    }
  })

  it("reads a bounded UTF-8 file without mixing numeric and bigint sizes", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "bounded.txt")
      await writeFile(file, "hello\n")

      await expect(readBoundedUtf8Bytes(file, "bounded.txt", 6)).resolves.toEqual(Buffer.from("hello\n"))
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects directories that exceed the literal-search enumeration budget", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await mkdir(path.join(workspace.path, "large-search-directory"))
      await Promise.all(Array.from({ length: 4_097 }, (_, index) => writeFile(path.join(workspace.path, "large-search-directory", `file-${index}.ts`), "")))

      await expect(grepWorkspace({
        worktree: workspace.path,
        pattern: "needle",
        path: "large-search-directory",
        maxResults: 10,
      })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  }, 30_000)

  it("bounds the text returned for a single long matching line", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "long-line.txt"), `needle${"x".repeat(100_000)}`)

      const result = await grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 10 })

      expect(result.matches).toHaveLength(1)
      expect(result.matches[0]!.text.length).toBeLessThanOrEqual(2_000)
      expect(result.matches[0]!.text).toContain("truncated")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects invalid result limits at the search service boundary", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 0 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(astSearchFile({ worktree: workspace.path, filePath: "missing.ts", pattern: "const $A = $B", maxResults: 501 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("marks results truncated only when matches exist beyond the result limit", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "a.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "b.ts"), "quiet\n")
      await expect(grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 1 })).resolves.toMatchObject({ matches: [{ line: 1 }], truncated: false })
      await writeFile(path.join(workspace.path, "b.ts"), "needle\n")
      await expect(grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 1 })).resolves.toMatchObject({ truncated: true })
    } finally {
      await workspace.cleanup()
    }
  })

  it("matches direct and nested files with a double-star include glob", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await mkdir(path.join(workspace.path, "src", "nested"), { recursive: true })
      await writeFile(path.join(workspace.path, "src", "file.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "src", "nested", "file.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "src", "nested.txt"), "needle\n")

      const result = await grepWorkspace({ worktree: workspace.path, pattern: "needle", include: "src/**/*.ts", maxResults: 10 })

      expect(result.matches.map((match) => path.relative(workspace.path, match.path).replaceAll("\\", "/"))).toEqual(["src/file.ts", "src/nested/file.ts"])
    } finally {
      await workspace.cleanup()
    }
  })

  it("returns literal matches in a deterministic, filesystem-independent order", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await mkdir(path.join(workspace.path, "b"), { recursive: true })
      await writeFile(path.join(workspace.path, "b", "z.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "b", "a.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "z.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "a.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "_x.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "1.ts"), "needle\n")

      const result = await grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 10 })

      expect(result.matches.map((match) => path.relative(workspace.path, match.path).replaceAll("\\", "/"))).toEqual([
        "_x.ts",
        "1.ts",
        "a.ts",
        "b/a.ts",
        "b/z.ts",
        "z.ts",
      ])
    } finally {
      await workspace.cleanup()
    }
  })

  it("treats grep patterns as literal text instead of regular expressions", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "literal.ts"), "value = a.b\nvalue = axb\nvalue = a[0]\n")
      const dotted = await grepWorkspace({ worktree: workspace.path, pattern: "a.b", maxResults: 10 })
      const bracketed = await grepWorkspace({ worktree: workspace.path, pattern: "a[0]", maxResults: 10 })

      expect(dotted.matches.map((match) => match.line)).toEqual([1])
      expect(bracketed.matches.map((match) => match.line)).toEqual([3])
    } finally {
      await workspace.cleanup()
    }
  })

  it("searches a targeted file without scanning sibling files", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "target.ts"), "needle\n")
      await writeFile(path.join(workspace.path, "sibling.ts"), "needle\n")
      const result = await grepWorkspace({ worktree: workspace.path, path: "target.ts", pattern: "needle", maxResults: 10 })

      expect(result.matches).toHaveLength(1)
      expect(path.basename(result.matches[0]!.path)).toBe("target.ts")
      expect(result.truncated).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it("skips invalid UTF-8 and binary files instead of matching replacement text", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "invalid.bin"), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xff]))
      await writeFile(path.join(workspace.path, "binary.bin"), Buffer.from("needle\0after", "utf8"))
      await writeFile(path.join(workspace.path, "valid.ts"), "needle\n")

      const result = await grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 10 })

      expect(result.matches.map((match) => path.basename(match.path))).toEqual(["valid.ts"])
      expect(result.truncated).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it("finds TypeScript structural patterns", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "call.ts"), "const value = dangerous(input)\n")
      const result = await astSearchFile({ worktree: workspace.path, filePath: "call.ts", pattern: "dangerous($A)", maxResults: 10 })
      expect(result.matches).toHaveLength(1)
      expect(result.matches[0]?.text).toBe("dangerous(input)")
    } finally {
      await workspace.cleanup()
    }
  })

  it("stops AST matching after the requested result limit", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "calls.ts"), "dangerous(first)\ndangerous(second)\ndangerous(third)\n")

      const result = await astSearchFile({
        worktree: workspace.path,
        filePath: "calls.ts",
        pattern: "dangerous($A)",
        maxResults: 2,
      })

      expect(result.matches.map((match) => match.text)).toEqual(["dangerous(first)", "dangerous(second)"])
      expect(result.truncated).toBe(true)
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects oversized AST source before parsing it", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "oversized.ts"), `const value = 1\n${" ".repeat(10 * 1024 * 1024)}`)

      await expect(astSearchFile({
        worktree: workspace.path,
        filePath: "oversized.ts",
        pattern: "const $A = $B",
        maxResults: 10,
      })).rejects.toMatchObject({ code: "INVALID_ARGUMENT", path: "oversized.ts" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("bounds the source text returned for one large AST match", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "large-node.ts"), `function large() {\n/*${"x".repeat(100_000)}*/\n}\n`)

      const result = await astSearchFile({
        worktree: workspace.path,
        filePath: "large-node.ts",
        pattern: "function $A() { $$$BODY }",
        maxResults: 10,
      })

      expect(result.matches).toHaveLength(1)
      expect(result.matches[0]!.text.length).toBeLessThanOrEqual(2_000)
      expect(result.matches[0]!.text).toContain("truncated")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects invalid UTF-8 before AST parsing", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "invalid.ts"), Buffer.from([0x63, 0x6f, 0x6e, 0x73, 0x74, 0x20, 0xff]))

      await expect(astSearchFile({
        worktree: workspace.path,
        filePath: "invalid.ts",
        pattern: "const $A = $B",
        maxResults: 10,
      })).rejects.toMatchObject({ code: "ENCODING_UNSUPPORTED", path: "invalid.ts" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("uses the installed OpenCode LSP status bridge", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(runOpenCodeLspBridge({ worktree: workspace.path, operation: "workspaceSymbol", query: "MissingSymbol" })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE", details: { operation: "workspaceSymbol" } })
    } finally {
      await workspace.cleanup()
    }
  }, 30_000)

  it("does not start the OpenCode LSP bridge after tool cancellation", async () => {
    const workspace = await temporaryWorkspace()
    const controller = new AbortController()
    controller.abort()
    try {
      await expect(runOpenCodeLspBridge({
        worktree: workspace.path,
        operation: "workspaceSymbol",
        query: "MissingSymbol",
        signal: controller.signal,
      })).rejects.toMatchObject({ name: "AbortError" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects disabled LSP before resolving files or starting the bridge", async () => {
    await expect(runOpenCodeLspBridge({
      worktree: path.join(process.cwd(), "nonexistent-disabled-lsp-worktree"),
      operation: "documentSymbol",
      filePath: "missing.ts",
      configuration: { lsp: false },
    })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE", message: expect.stringMatching(/disabled/i) })
  })

  it("passes Windows LSP queries as literal arguments instead of shell commands", async () => {
    if (process.platform !== "win32") return
    const workspace = await temporaryWorkspace()
    try {
      const marker = path.join(workspace.path, "lsp-shell-injection.txt")
      const query = "MissingSymbol & echo injected>lsp-shell-injection.txt & rem"

      await expect(runOpenCodeLspBridge({ worktree: workspace.path, operation: "workspaceSymbol", query })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" })

      await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  }, 30_000)
})
