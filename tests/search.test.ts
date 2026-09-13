import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { astSearchFile } from "../src/search/ast.js"
import { grepWorkspace } from "../src/search/grep.js"
import { runOpenCodeLspBridge } from "../src/search/lsp.js"
import { routeSearch } from "../src/search/router.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("search", () => {
  it("routes semantic, structural and literal queries", () => {
    expect(routeSearch("find references to createOrder")).toBe("lsp")
    expect(routeSearch("find structural pattern for empty catch")).toBe("ast")
    expect(routeSearch("find API_KEY text")).toBe("grep")
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

  it("rejects invalid result limits at the search service boundary", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(grepWorkspace({ worktree: workspace.path, pattern: "needle", maxResults: 0 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(astSearchFile({ worktree: workspace.path, filePath: "missing.ts", pattern: "const $A = $B", maxResults: 501 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
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

      expect(result.matches.map((match) => match.path.replaceAll("\\", "/").split("/").slice(-2).join("/"))).toEqual(["src/file.ts", "nested/file.ts"])
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
      const output = await runOpenCodeLspBridge({ worktree: workspace.path, operation: "workspaceSymbol", query: "MissingSymbol" })
      expect(() => JSON.parse(output)).not.toThrow()
    } finally {
      await workspace.cleanup()
    }
  }, 30_000)

  it("passes Windows LSP queries as literal arguments instead of shell commands", async () => {
    if (process.platform !== "win32") return
    const workspace = await temporaryWorkspace()
    try {
      const marker = path.join(workspace.path, "lsp-shell-injection.txt")
      const query = "MissingSymbol & echo injected>lsp-shell-injection.txt & rem"

      await runOpenCodeLspBridge({ worktree: workspace.path, operation: "workspaceSymbol", query })

      await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  }, 30_000)
})
