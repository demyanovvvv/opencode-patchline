import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { EditService } from "../../src/edit-service.js"
import { isFileReadResult, ReadService } from "../../src/read-service.js"
import { ScopedSnapshotStore } from "../../src/snapshot/store.js"
import { summarizeLatencies } from "../stats.js"
import { z } from "zod"
import { PatchlinePlugin } from "../../src/plugin.js"
import { grepWorkspace } from "../../src/search/grep.js"

export async function measureToolProfiles(worktree: string) {
  const measure = async (toolProfile: "extended" | "compact") => {
    const hooks = await PatchlinePlugin({ directory: worktree, worktree } as never, { toolProfile, lspAutoSetup: false, lspAutoInstall: false })
    await hooks.config!({ lsp: false } as never)
    const tools = Object.entries(hooks.tool ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, definition]) => {
      const schema = { name, description: definition.description, parameters: z.toJSONSchema(z.object(definition.args)) }
      return { name, schemaBytes: Buffer.byteLength(JSON.stringify(schema)) }
    })
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({} as never, output)
    return { tools, schemaBytes: tools.reduce((sum, entry) => sum + entry.schemaBytes, 0), policyBytes: Buffer.byteLength(output.system.join("\n")) }
  }
  return { extended: await measure("extended"), compact: await measure("compact"), scope: "plugin-only; lsp:false; JSON bytes, not provider tokens" }
}

export async function localChecks(tempRoot = os.tmpdir()) {
  const root = await mkdtemp(path.join(tempRoot, "patchline-local-ab-"))
  const results: { name: string; passed: boolean; detail: string; data?: unknown }[] = []
  try {
    const anchor = "export const uniqueTarget = 5000"
    await writeFile(path.join(root, "anchor.mjs"), Array.from({ length: 10_000 }, (_, index) => index === 5000 ? anchor : `export const value${index} = ${index}`).join("\n") + "\n")
    type ReadMode = "grep-read" | "anchor"
    const readers = { "grep-read": new ReadService(new ScopedSnapshotStore()), anchor: new ReadService(new ScopedSnapshotStore()) }
    const samples: Record<ReadMode, number[]> = { "grep-read": [], anchor: [] }
    const firstRead: Partial<Record<ReadMode, number>> = {}
    const outputChars: Partial<Record<ReadMode, number>> = {}
    const pairs: { order: ReadMode[]; grepReadMs: number; anchorMs: number }[] = []
    for (let iteration = 0; iteration < 21; iteration++) {
      const order: ReadMode[] = iteration % 2 === 0 ? ["grep-read", "anchor"] : ["anchor", "grep-read"]
      const pages: string[] = []
      const durations: Partial<Record<ReadMode, number>> = {}
      for (const mode of order) {
        const started = performance.now()
        const found = mode === "grep-read" ? await grepWorkspace({ worktree: root, path: "anchor.mjs", pattern: anchor, maxResults: 1 }) : undefined
        if (found && (found.matches.length !== 1 || found.truncated || found.skippedCount)) throw new Error("Anchor replay discovery failed")
        const result = await readers[mode].read({ sessionId: `replay-${mode}`, worktree: root, filePath: "anchor.mjs", limit: 5, ...(found ? { offset: found.matches[0]!.line } : { anchor }) })
        const duration = performance.now() - started
        durations[mode] = duration
        if (iteration === 0) firstRead[mode] = duration
        else samples[mode].push(duration)
        if (result.kind !== "file" || result.offset !== 5001 || result.endLine !== 5005 || !result.output.includes(anchor)) throw new Error("Anchor replay returned the wrong source range")
        outputChars[mode] = result.output.length + (found ? JSON.stringify(found).length : 0)
        pages.push(result.output)
      }
      if (pages[0] !== pages[1]) throw new Error("Anchor replay pages differ")
      if (iteration > 0) pairs.push({ order, grepReadMs: durations["grep-read"]!, anchorMs: durations.anchor! })
    }
    const summary = (mode: ReadMode) => ({ firstReadMs: firstRead[mode], warm: summarizeLatencies(samples[mode]), toolCalls: mode === "grep-read" ? 2 : 1, outputChars: outputChars[mode] })
    results.push({ name: "anchor-read-replay", passed: true, detail: "10,000-line fixture; byte-identical five-line pages; 20 paired warm samples with balanced alternating order; first read is process-local, not OS-cold; local calls/chars are not provider tokens", data: { grepRead: summary("grep-read"), anchor: summary("anchor"), pairs, pageEqualityVerified: true } })
    type EditMode = "sequential" | "batch"
    const editSamples: Record<EditMode, number[]> = { sequential: [], batch: [] }
    const firstEdit: Partial<Record<EditMode, number>> = {}
    const editPairs: { order: EditMode[]; sequentialMs: number; batchMs: number }[] = []
    const files = ["batch-a.mjs", "batch-b.mjs"]
    for (let iteration = 0; iteration < 21; iteration++) {
      const order: EditMode[] = iteration % 2 === 0 ? ["sequential", "batch"] : ["batch", "sequential"]
      const durations: Partial<Record<EditMode, number>> = {}
      for (const mode of order) {
        const store = new ScopedSnapshotStore()
        const reader = new ReadService(store)
        const editor = new EditService(store)
        const requests = []
        for (const filePath of files) {
          await writeFile(path.join(root, filePath), "// preserve this comment\nexport const value = 1\n")
          const page = await reader.read({ sessionId: mode, worktree: root, filePath })
          if (!isFileReadResult(page)) throw new Error("Batch replay expected file")
          requests.push({ sessionId: mode, worktree: root, filePath, snapshot: page.snapshot, exact: { oldString: "value = 1", newString: "value = 2" } })
        }
        const started = performance.now()
        if (mode === "batch") await editor.editBatch(requests)
        else for (const request of requests) await editor.edit(request)
        durations[mode] = performance.now() - started
        for (const file of files) {
          if (await readFile(path.join(root, file), "utf8") !== "// preserve this comment\nexport const value = 2\n") throw new Error("Batch replay changed unexpected bytes")
        }
        if (iteration === 0) firstEdit[mode] = durations[mode]
        else editSamples[mode].push(durations[mode])
      }
      if (iteration > 0) editPairs.push({ order, sequentialMs: durations.sequential!, batchMs: durations.batch! })
    }
    results.push({ name: "batch-edit-replay", passed: true, detail: "Two observed files; identical final bytes verified for sequential and atomic batch edits; setup/read excluded, local tool time only, not provider tokens or model quality.", data: { firstEdit, sequential: { ...summarizeLatencies(editSamples.sequential), toolCalls: 2 }, batch: { ...summarizeLatencies(editSamples.batch), toolCalls: 1 }, pairs: editPairs, finalBytesEqualityVerified: true } })
    const file = path.join(root, "sample.mjs")
    const before = "\uFEFF// Привет\r\nexport const value = 1\r\n"
    const latencies: number[] = []
    for (let index = 0; index < 12; index++) {
      await writeFile(file, before)
      const snapshots = new ScopedSnapshotStore()
      const start = performance.now()
      const observed = await new ReadService(snapshots).read({ sessionId: "local", worktree: root, filePath: "sample.mjs" })
      if (!isFileReadResult(observed)) throw new Error("Expected a file")
      await new EditService(snapshots).edit({ sessionId: "local", worktree: root, filePath: "sample.mjs", snapshot: observed.snapshot, exact: { oldString: "value = 1", newString: "value = 2" } })
      if (index >= 2) latencies.push(performance.now() - start)
      if (await readFile(file, "utf8") !== before.replace("value = 1", "value = 2")) throw new Error("Byte preservation failed")
    }
    const stats = summarizeLatencies(latencies)
    results.push({ name: "Patchline: BOM / CRLF / Unicode сохранены", passed: true, detail: `2 разогрева + 10 измерений; p50 ${stats.p50Ms.toFixed(2)} мс, p95 ${stats.p95Ms.toFixed(2)} мс. Это время инструментов, не модели.`, data: stats })
    await writeFile(file, "export const value = 1\n")
    const snapshots = new ScopedSnapshotStore()
    const observed = await new ReadService(snapshots).read({ sessionId: "stale", worktree: root, filePath: "sample.mjs" })
    if (!isFileReadResult(observed)) throw new Error("Expected a file")
    await writeFile(file, "export const value = 3\n")
    let rejected = false
    try { await new EditService(snapshots).edit({ sessionId: "stale", worktree: root, filePath: "sample.mjs", snapshot: observed.snapshot, exact: { oldString: "value = 1", newString: "value = 2" } }) }
    catch (error) { rejected = (error as { code?: string }).code === "STALE_SNAPSHOT" || /stale|changed/i.test(String(error)) }
    results.push({ name: "Patchline: устаревшая правка отклонена", passed: rejected && await readFile(file, "utf8") === "export const value = 3\n", detail: "Детерминированная внешняя запись после чтения; новое содержимое сохранено." })
    // A two-file preflight must not commit the first edit when the second is stale.
    await writeFile(path.join(root, "second.mjs"), "export const value = 1\n")
    const store = new ScopedSnapshotStore()
    const reads = new ReadService(store)
    const first = await reads.read({ sessionId: "batch", worktree: root, filePath: "sample.mjs" })
    const second = await reads.read({ sessionId: "batch", worktree: root, filePath: "second.mjs" })
    if (!isFileReadResult(first) || !isFileReadResult(second)) throw new Error("Expected files")
    await writeFile(path.join(root, "second.mjs"), "export const value = 9\n")
    let batchRejected = false
    try { await new EditService(store).editBatch([
      { sessionId: "batch", worktree: root, filePath: "sample.mjs", snapshot: first.snapshot, exact: { oldString: "value = 3", newString: "value = 4" } },
      { sessionId: "batch", worktree: root, filePath: "second.mjs", snapshot: second.snapshot, exact: { oldString: "value = 1", newString: "value = 2" } },
    ]) } catch { batchRejected = true }
    results.push({ name: "Patchline: конфликт batch не вызывает частичную запись", passed: batchRejected && await readFile(file, "utf8") === "export const value = 3\n" && await readFile(path.join(root, "second.mjs"), "utf8") === "export const value = 9\n", detail: "Первый файл и внешнее изменение второго сохранены." })
    return results
  } finally { await rm(root, { recursive: true, force: true }) }
}
