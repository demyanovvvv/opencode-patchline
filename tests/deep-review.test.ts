import { mkdir, writeFile, readFile } from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { describe, expect, it } from "vitest"
import { EditService } from "../src/edit-service.js"
import { ReadService, isFileReadResult } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { decodeUtf8, applyNormalizedTextPreservingShape } from "../src/preservation/text.js"
import { PatchlinePlugin } from "../src/plugin.js"
import { temporaryWorkspace } from "./helpers/workspace.js"
import { diffStats } from "../src/editing/diff.js"
import { runOpenCodeLspClient } from "../src/search/lsp.js"
import { grepWorkspace } from "../src/search/grep.js"
import { astSearchFile, collectBoundedAstMatches } from "../src/search/ast.js"
import { xxh32 } from "@node-rs/xxhash"

describe("deep review regressions", () => {
  it("retains existing Hashline tags while replacing whitespace normalization", () => {
    const store = new ScopedSnapshotStore()
    const scope = { sessionId: "tags", worktree: process.cwd() }
    for (const text of ["", " \n", "a  \n\tb\t\n", "\r\n", "a \rb", "unicode 🦊\t\n", "\n\n", "a\t "]) {
      const document = decodeUtf8(Buffer.from(text))
      const expected = (xxh32(document.normalizedText.replace(/[ \t\r]+(?=\n|$)/g, ""), 0) & 0xffff).toString(16).padStart(4, "0").toUpperCase()
      expect(store.record(scope, path.join(scope.worktree, "tag.ts"), "tag.ts", document, []).tag).toBe(expected)
    }
  })
  it("searches bare-CR source lines with accurate line numbers", async () => {
    const w = await temporaryWorkspace()
    try {
      await writeFile(path.join(w.path, "file.ts"), "quiet\rneedle\r")
      const r = await grepWorkspace({ worktree: w.path, pattern: "needle", maxResults: 1 })
      expect(r.matches[0]?.line).toBe(2)
    } finally { await w.cleanup() }
  })
  it("bounds global search file enumeration", async () => {
    const w = await temporaryWorkspace()
    try {
      await Promise.all(Array.from({ length: 5 }, (_, i) => writeFile(path.join(w.path, `f${i}.ts`), "quiet")))
      await expect(grepWorkspace({ worktree: w.path, pattern: "needle", maxResults: 1, maxFiles: 4 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally { await w.cleanup() }
  })
  it("rejects SDK error envelopes rather than reporting symbols", async () => {
    await expect(runOpenCodeLspClient({ find: { symbols: async () => ({ error: { message: "unavailable" } }) } }, { worktree: process.cwd(), query: "symbol" })).rejects.toMatchObject({ code: "DIAGNOSTICS_UNAVAILABLE" })
  })
  it("checks SDK cancellation before starting", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runOpenCodeLspClient({ find: { symbols: async () => [] } }, { worktree: process.cwd(), query: "symbol", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  })
  it("deadlines a hanging SDK request", async () => {
    await expect(runOpenCodeLspClient({ find: { symbols: async () => new Promise(() => {}) } }, { worktree: process.cwd(), query: "symbol", timeoutMs: 10 })).rejects.toMatchObject({ code: "DIAGNOSTICS_UNAVAILABLE" })
  })
  it("checks AST cancellation before resolving or parsing", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(astSearchFile({ worktree: process.cwd(), filePath: "missing.ts", pattern: "x", maxResults: 1, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  })
  it("bounds AST traversal when there are no matching nodes", () => {
    const leaf = { children: () => [], matches: () => false }
    const root = { children: () => Array.from({ length: 100_001 }, () => leaf), matches: () => false }
    expect(() => collectBoundedAstMatches(root, {}, 1)).toThrow(/budget/i)
  })
  it("does not publish a snapshot that cannot fit its quota", () => {
    const store = new ScopedSnapshotStore({ maxBytes: 100 })
    expect(() => store.record({ sessionId: "s", worktree: process.cwd() }, path.join(process.cwd(), "large.ts"), "large.ts", decodeUtf8(Buffer.from("x\n".repeat(100))), [])).toThrow(/budget/i)
  })
  it("reports an applied edit even when its next snapshot cannot fit", async () => {
    const w = await temporaryWorkspace()
    try {
      await writeFile(path.join(w.path, "file.ts"), "x\n")
      const store = new ScopedSnapshotStore({ maxBytes: 100 })
      const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
      const r = await new ReadService(store).read(scope)
      if (!isFileReadResult(r)) throw new Error("file expected")
      const result = await new EditService(store).edit({ ...scope, snapshot: r.snapshot, exact: { oldString: "x", newString: "a".repeat(100) } })
      expect(result.snapshot).toBe("")
      expect(result.warnings.join(" ")).toMatch(/snapshot/i)
      expect(await readFile(path.join(w.path, "file.ts"), "utf8")).toBe("a".repeat(100) + "\n")
    } finally { await w.cleanup() }
  })
  it("clears stale observations when an identical file has a new identity", () => {
    const store = new ScopedSnapshotStore()
    const scope = { sessionId: "s", worktree: process.cwd() }
    const file = path.join(scope.worktree, "identity.ts")
    const document = decodeUtf8(Buffer.from("one\ntwo\n"))
    store.record(scope, file, "identity.ts", document, [1], { device: 1n, inode: 1n })
    const replacement = store.record(scope, file, "identity.ts", document, [2], { device: 1n, inode: 2n })
    expect([...replacement.seenLines]).toEqual([2])
  })
  it("uses a full snapshot ID to edit after a short-tag collision", async () => {
    const w = await temporaryWorkspace()
    try {
      const file = path.join(w.path, "file.ts")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path }
      await writeFile(file, "value\n")
      await new ReadService(store).read({ ...scope, filePath: "file.ts" })
      await writeFile(file, "value \n")
      const r = await new ReadService(store).read({ ...scope, filePath: "file.ts" })
      if (!isFileReadResult(r)) throw new Error("file expected")
      await new EditService(store).applyHashline(scope, `[file.ts#${r.snapshot}]\nPUT 1.=1:\n+after`)
      expect(await readFile(file, "utf8")).toBe("after\n")
    } finally { await w.cleanup() }
  })
  it("bounds live file growth before mutation reads", async () => {
    const w = await temporaryWorkspace()
    try {
      const file = path.join(w.path, "file.ts")
      await writeFile(file, "before\n")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
      const r = await new ReadService(store).read(scope)
      if (!isFileReadResult(r)) throw new Error("file expected")
      await writeFile(file, Buffer.alloc(8 * 1024 * 1024 + 1, 120))
      await expect(new EditService(store).prepare({ ...scope, snapshot: r.snapshot, exact: { oldString: "before", newString: "after" } })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally { await w.cleanup() }
  })
  it("preflights a recovery result without accumulating unbounded live files", async () => {
    const w = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path }
      const headers: string[] = []
      for (let i = 0; i < 5; i++) {
        const file = path.join(w.path, `file-${i}.ts`)
        const document = decodeUtf8(Buffer.from("before " + "x".repeat(1024 * 1024)))
        await writeFile(file, document.bytes)
        const s = store.record(scope, file, `file-${i}.ts`, document, [1])
        headers.push(`[file-${i}.ts#${s.tag}]\nPUT 1.=1:\n+after`)
      }
      await expect(new EditService(store).applyHashline(scope, headers.join("\n"))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
    } finally { await w.cleanup() }
  })
  it("rejects aggregate edit preparation beyond its memory budget", async () => {
    const w = await temporaryWorkspace()
    try {
      const store = new ScopedSnapshotStore()
      const requests = []
      for (let i = 0; i < 3; i++) {
        const filePath = `file-${i}.ts`
        await writeFile(path.join(w.path, filePath), "before " + "x".repeat(2 * 1024 * 1024))
        const scope = { sessionId: "s", worktree: w.path, filePath }
        const document = decodeUtf8(await readFile(path.join(w.path, filePath)))
        const snapshot = store.record(scope, path.join(w.path, filePath), filePath, document, [1])
        requests.push({ ...scope, snapshot: snapshot.id, exact: { oldString: "before", newString: "after" } })
      }
      await expect(new EditService(store).editBatch(requests)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      expect((await readFile(path.join(w.path, "file-0.ts"), "utf8")).startsWith("before")).toBe(true)
    } finally { await w.cleanup() }
  })
  it("counts large pure additions without a matching diff", () => {
    expect(diffStats("", "line\n".repeat(3000))).toEqual({ added: 3000, deleted: 0 })
    expect(diffStats("line\n".repeat(3000), "")).toEqual({ added: 0, deleted: 3000 })
  })
  it("tracks the actual exact replacement through repeated lines", async () => {
    const w = await temporaryWorkspace()
    try {
      await writeFile(path.join(w.path, "file.ts"), "a\nb\n")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
      const r = await new ReadService(store).read({ ...scope, limit: 1 })
      if (!isFileReadResult(r)) throw new Error("file expected")
      const p = await new EditService(store).prepare({ ...scope, snapshot: r.snapshot, exact: { oldString: "a\n", newString: "b\n" } })
      expect([...p.seenLinesAfter]).toEqual([1])
    } finally { await w.cleanup() }
  })
  it("tracks linear Hashline replacement provenance through repeated lines", async () => {
    const w = await temporaryWorkspace()
    try {
      await writeFile(path.join(w.path, "file.ts"), "a\nb\n")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path }
      const r = await new ReadService(store).read({ ...scope, filePath: "file.ts", limit: 1 })
      if (!isFileReadResult(r)) throw new Error("file expected")
      const [result] = await new EditService(store).applyHashline(scope, `[file.ts#${r.tag}]\nPUT 1.=1:\n+b`)
      expect([...store.get(scope, path.join(w.path, "file.ts"), result!.snapshot)!.seenLines]).toEqual([1])
    } finally { await w.cleanup() }
  })
  it("authorizes the resolved internal read path", async () => {
    const w = await temporaryWorkspace()
    try {
      await mkdir(path.join(w.path, "sub"))
      await writeFile(path.join(w.path, "secret.ts"), "secret\n")
      const hooks = await PatchlinePlugin({ directory: w.path, worktree: w.path } as never)
      const context = { sessionID: "s", messageID: "m", agent: "test", directory: w.path, worktree: w.path, abort: new AbortController().signal, metadata() {}, async ask(input: { permission: string; patterns: string[] }) {
        if (input.permission === "read" && input.patterns.some((p) => p.replaceAll("\\", "/") === "secret.ts")) throw new Error("denied")
      } }
      await expect(hooks.tool!.read!.execute({ filePath: "sub/../secret.ts" }, context)).rejects.toThrow("denied")
    } finally { await w.cleanup() }
  })

  it("protects generated files in exact preflight", async () => {
    const w = await temporaryWorkspace()
    try {
      await mkdir(path.join(w.path, "dist"))
      await writeFile(path.join(w.path, "dist", "file.ts"), "before\n")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path, filePath: "dist/file.ts" }
      const r = await new ReadService(store).read(scope)
      if (!isFileReadResult(r)) throw new Error("file expected")
      await expect(new EditService(store).prepare({ ...scope, snapshot: r.snapshot, exact: { oldString: "before", newString: "after" } })).rejects.toMatchObject({ code: "GENERATED_FILE" })
    } finally { await w.cleanup() }
  })

  it("computes tags without quadratic whitespace backtracking", () => {
    const store = new ScopedSnapshotStore()
    const document = decodeUtf8(Buffer.from(" ".repeat(40_000) + "x\n"))
    const start = performance.now()
    store.record({ sessionId: "s", worktree: process.cwd() }, path.join(process.cwd(), "sample.ts"), "sample.ts", document, [])
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it.each(["$&", "$$", "$`", "$'"])("inserts %s literally", async (replacement) => {
    const w = await temporaryWorkspace()
    try {
      await writeFile(path.join(w.path, "file.ts"), "before\n")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
      const r = await new ReadService(store).read(scope)
      if (!isFileReadResult(r)) throw new Error("file expected")
      await new EditService(store).edit({ ...scope, snapshot: r.snapshot, exact: { oldString: "before", newString: replacement } })
      expect(await readFile(path.join(w.path, "file.ts"), "utf8")).toBe(replacement + "\n")
    } finally { await w.cleanup() }
  })

  it("accepts a final newline without requiring a nonexistent line", async () => {
    const w = await temporaryWorkspace()
    try {
      await writeFile(path.join(w.path, "file.ts"), "before\n")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
      const r = await new ReadService(store).read(scope)
      if (!isFileReadResult(r)) throw new Error("file expected")
      await expect(new EditService(store).prepare({ ...scope, snapshot: r.snapshot, exact: { oldString: "before\n", newString: "after\n" } })).resolves.toBeDefined()
    } finally { await w.cleanup() }
  })

  it("preserves untouched mixed line endings between edits", () => {
    const document = decodeUtf8(Buffer.from("first\r\nkeep\nlast\r\n"))
    expect(Buffer.from(applyNormalizedTextPreservingShape("FIRST\nkeep\nLAST\n", document)).toString()).toBe("FIRST\r\nkeep\nLAST\r\n")
  })

  it("normalizes CRLF replacement text before analyzing and encoding", async () => {
    const w = await temporaryWorkspace()
    try {
      await writeFile(path.join(w.path, "file.ts"), "before\r\n")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
      const r = await new ReadService(store).read(scope)
      if (!isFileReadResult(r)) throw new Error("file expected")
      const p = await new EditService(store).prepare({ ...scope, snapshot: r.snapshot, exact: { oldString: "before", newString: "after\r\nextra" } })
      expect(decodeUtf8(p.afterBytes).normalizedText).toBe(p.afterText)
      expect(Buffer.from(p.afterBytes).toString()).toBe("after\r\nextra\r\n")
    } finally { await w.cleanup() }
  })
  it("matches CRLF exact input against the normalized snapshot", async () => {
    const w = await temporaryWorkspace()
    try {
      await writeFile(path.join(w.path, "file.ts"), "before\r\nnext\r\n")
      const store = new ScopedSnapshotStore()
      const scope = { sessionId: "s", worktree: w.path, filePath: "file.ts" }
      const r = await new ReadService(store).read(scope)
      if (!isFileReadResult(r)) throw new Error("file expected")
      await new EditService(store).edit({ ...scope, snapshot: r.snapshot, exact: { oldString: "before\r\nnext", newString: "after\r\nnext" } })
      expect(await readFile(path.join(w.path, "file.ts"), "utf8")).toBe("after\r\nnext\r\n")
    } finally { await w.cleanup() }
  })
})
