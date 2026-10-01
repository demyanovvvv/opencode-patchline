import type { FileSnapshot } from "../snapshot/store.js"
import { PatchlineError } from "../errors.js"

type Clipboard = { named?: Map<string, readonly string[]>; lines?: readonly string[] }
type BlockResolver = (request: { path: string; text: string; line: number }) => { start: number; end: number } | null
type HashlineSection = { path: string; fileHash?: string; diff: string; parse(): { fileOp?: { kind: "rem" } | { kind: "move"; dest: string } } }
type HashlinePatch = { sections: readonly HashlineSection[] }
export type HashlineResult = { path: string; sourcePath: string; op: string; text: string; warnings: string[]; moveDest?: string }
type HashlineModule = {
  InMemoryFilesystem: new (initial?: Iterable<readonly [string, string]>) => unknown
  InMemorySnapshotStore: new () => { record(path: string, text: string, seenLines?: Iterable<number>): string }
  Patch: { parse(input: string): HashlinePatch }
  Patcher: new (options: { fs: unknown; snapshots: unknown; enforceSeenLines: boolean; clipboard?: Clipboard; blockResolver?: BlockResolver }) => {
    apply(patch: HashlinePatch): Promise<{ sections: Array<{ path: string; op: string; after: string; warnings: string[]; moveDest?: string }> }>
  }
}

type LinearOperation = {
  start: number
  end: number
  before: boolean
  after: boolean
  body: string[]
  deleteOnly: boolean
}

let modulePromise: Promise<HashlineModule> | undefined

async function loadHashline(): Promise<HashlineModule> {
  modulePromise ??= import("@oh-my-pi/hashline") as unknown as Promise<HashlineModule>
  try {
    return await modulePromise
  } catch (cause) {
    modulePromise = undefined
    throw new PatchlineError(
      "CAPABILITY_UNAVAILABLE",
      "The upstream Hashline runtime is unavailable. Linear PUT/CUT edits remain available in Node; structural and clipboard operations require OpenCode/Bun.",
      { cause },
    )
  }
}

function parseLinearFallback(snapshot: FileSnapshot, patchText: string): LinearOperation[] {
  const lines = patchText.replace(/\r\n/g, "\n").split("\n")
  const header = lines.findIndex((line) => line.trim().length > 0)
  if (header < 0 || lines[header] !== `[${snapshot.relativePath}#${snapshot.tag}]`) {
    throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Hashline patch path or snapshot tag does not match the observed file.", { path: snapshot.relativePath, snapshotId: snapshot.id })
  }
  const operations: LinearOperation[] = []
  for (let index = header + 1; index < lines.length;) {
    const line = lines[index]!.trim()
    if (!line) { index++; continue }
    const match = line.match(/^(PUT|CUT)\s+(.+?)\s*(:)?$/)
    if (!match) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Unsupported Hashline operation: ${line}`, { path: snapshot.relativePath, snapshotId: snapshot.id })
    const operation = match[1]!
    const target = match[2]!
    if (target.endsWith("*")) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Structural Hashline blocks require the upstream runtime.", { path: snapshot.relativePath, snapshotId: snapshot.id })
    if (/\s@/.test(target)) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Hashline registers require the upstream runtime.", { path: snapshot.relativePath, snapshotId: snapshot.id })
    let start: number
    let end: number
    let before = false
    let after = false
    if (target === ">$") {
      start = end = snapshot.text.length === 0 ? 0 : snapshot.text.split("\n").length - (snapshot.text.endsWith("\n") ? 1 : 0)
      after = true
    } else if (target.startsWith("<")) {
      start = end = Number.parseInt(target.slice(1), 10)
      before = true
    } else if (target.startsWith(">")) {
      start = end = Number.parseInt(target.slice(1), 10)
      after = true
    } else {
      const range = target.match(/^(\d+)(?:\.=(\d+))?$/)
      if (!range) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Unsupported Hashline target: ${target}`, { path: snapshot.relativePath, snapshotId: snapshot.id })
      start = Number.parseInt(range[1]!, 10)
      end = range[2] ? Number.parseInt(range[2], 10) : start
    }
    if (!Number.isInteger(start) || start < (target === ">$" ? 0 : 1) || end < start) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Invalid Hashline line range: ${target}`, { path: snapshot.relativePath, snapshotId: snapshot.id })
    const lineCount = snapshot.text.length === 0 ? 0 : snapshot.text.split("\n").length - (snapshot.text.endsWith("\n") ? 1 : 0)
    if (start > lineCount + (before ? 1 : 0) || (!before && !after && end > lineCount)) {
      throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Hashline range ${start}.${end} exceeds the observed file.`, { path: snapshot.relativePath, snapshotId: snapshot.id })
    }
    for (let lineNumber = start; lineNumber <= end; lineNumber++) {
      if (!snapshot.seenLines.has(lineNumber) && !(before && lineNumber === lineCount + 1) && !(after && lineNumber === 0)) throw new PatchlineError("INVALID_ANCHOR", `Line ${lineNumber} was not displayed by the read that created this snapshot.`, { path: snapshot.relativePath, snapshotId: snapshot.id, retryable: true })
    }
    const body: string[] = []
    if (operation === "PUT") {
      if (!match[3]) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "PUT requires a ':' body delimiter.", { path: snapshot.relativePath, snapshotId: snapshot.id })
      index++
      while (index < lines.length && lines[index]!.startsWith("+")) body.push(lines[index]!.slice(1)), index++
      if (body.length === 0) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "PUT requires at least one body row in the Node fallback.", { path: snapshot.relativePath, snapshotId: snapshot.id })
    } else {
      index++
      if (index < lines.length && lines[index]!.startsWith("+")) {
        throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "CUT does not accept a body.", { path: snapshot.relativePath, snapshotId: snapshot.id })
      }
    }
    operations.push({ start, end, before, after, body, deleteOnly: operation === "CUT" })
  }
  const touched = new Set<number>()
  for (const operation of operations) {
    if (operation.before || operation.after) continue
    for (let line = operation.start; line <= operation.end; line++) {
      if (touched.has(line)) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Overlapping Hashline operation at line ${line}.`, { path: snapshot.relativePath, snapshotId: snapshot.id })
      touched.add(line)
    }
  }
  return operations
}

function applyLinearFallback(snapshot: FileSnapshot, patchText: string): { text: string; warnings: string[] } {
  const operations = parseLinearFallback(snapshot, patchText)
  const source = snapshot.text.split("\n")
  if (source.length && source[source.length - 1] === "") source.pop()
  for (const operation of [...operations].sort((left, right) => right.start - left.start)) {
    if (operation.before || operation.after) {
      const index = operation.after ? operation.start : operation.start - 1
      source.splice(index, 0, ...operation.body)
      continue
    }
    if (operation.end > source.length) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Hashline range ${operation.start}.${operation.end} exceeds the observed file.`, { path: snapshot.relativePath, snapshotId: snapshot.id })
    source.splice(operation.start - 1, operation.end - operation.start + 1, ...(operation.deleteOnly ? [] : operation.body))
  }
  return { text: source.length ? `${source.join("\n")}${snapshot.text.endsWith("\n") ? "\n" : ""}` : "", warnings: ["Node fallback applied linear PUT/CUT operations; structural Hashline operations require Bun runtime."] }
}

export async function parseHashlinePatch(patchText: string): Promise<Array<{ path: string; tag: string; patch: string; fileOp?: { kind: "rem" } | { kind: "move"; dest: string } }>> {
  let hashline: HashlineModule
  try { hashline = await loadHashline() } catch (cause) {
    if (!(cause instanceof PatchlineError) || cause.code !== "CAPABILITY_UNAVAILABLE") throw cause
    const headers = [...patchText.matchAll(/^\[([^\]\r\n]+)#([A-Fa-f0-9]{4})\][ \t]*\r?$/gm)]
    if (headers.length === 0 || patchText.slice(0, headers[0]!.index).trim()) throw new PatchlineError("INVALID_ARGUMENT", "Hashline patch must begin with a snapshot-tagged section.")
    return headers.map((header, index) => ({ path: header[1]!, tag: header[2]!.toUpperCase(), patch: patchText.slice(header.index, headers[index + 1]?.index ?? patchText.length).trim() }))
  }
  try {
    const parsed = hashline.Patch.parse(patchText)
    return parsed.sections.map((section) => {
      if (!section.fileHash) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Every Hashline section requires a snapshot tag.")
      const fileOp = section.parse().fileOp
      return { path: section.path, tag: section.fileHash.toUpperCase(), patch: `[${section.path}#${section.fileHash}]\n${section.diff}`, ...(fileOp ? { fileOp } : {}) }
    })
  } catch (cause) {
    if (cause instanceof PatchlineError) throw cause
    throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Hashline parse failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

export async function applyHashlineBatchInMemory(observed: readonly FileSnapshot[], patchText: string, clipboard: Clipboard = {}, liveTexts: readonly string[] = observed.map((snapshot) => snapshot.text)): Promise<{ results: HashlineResult[]; publish(): void }> {
  let hashline: HashlineModule
  try { hashline = await loadHashline() } catch (cause) {
    if (!(cause instanceof PatchlineError) || cause.code !== "CAPABILITY_UNAVAILABLE") throw cause
    const drifted = observed.find((snapshot, index) => liveTexts[index] !== snapshot.text)
    if (drifted) {
      throw new PatchlineError("STALE_SNAPSHOT", "The Node Hashline fallback cannot recover a changed live file; re-read before retrying.", { path: drifted.relativePath, retryable: true })
    }
    const sections = await parseHashlinePatch(patchText)
    if (sections.length !== observed.length) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Hashline sections do not match observed files.")
    return { results: observed.map((snapshot, index) => ({ ...applyLinearFallback(snapshot, sections[index]!.patch), path: snapshot.relativePath, sourcePath: snapshot.relativePath, op: "update" })), publish() {} }
  }
  try {
    const patch = hashline.Patch.parse(patchText)
    if (patch.sections.length !== observed.length) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Hashline sections do not match observed files.")
    for (const [index, section] of patch.sections.entries()) {
      const snapshot = observed[index]!
      if (section.path !== snapshot.relativePath || section.fileHash?.toUpperCase() !== snapshot.tag) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Hashline path or tag does not match the observed file.", { path: section.path })
    }
    const native = await import("@oh-my-pi/pi-natives") as unknown as { blockRangeAt(input: { code: string; path: string; line: number }): { startLine: number; endLine: number } | null }
    if (liveTexts.length !== observed.length) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Hashline live content does not match the observed sections.")
    const fs = new hashline.InMemoryFilesystem(observed.map((snapshot, index) => [snapshot.relativePath, liveTexts[index]!] as const))
    const snapshots = new hashline.InMemorySnapshotStore()
    for (const snapshot of observed) snapshots.record(snapshot.relativePath, snapshot.text, snapshot.seenLines)
    const working: Clipboard = { named: new Map(clipboard.named) }
    const blockResolver: BlockResolver = ({ path, text, line }) => {
      const span = native.blockRangeAt({ code: text, path, line })
      return span ? { start: span.startLine, end: span.endLine } : null
    }
    const patcher = new hashline.Patcher({ fs, snapshots, enforceSeenLines: true, clipboard: working, blockResolver })
    const applied = await patcher.apply(patch)
    return {
      results: applied.sections.map((section, index) => ({ path: section.path, sourcePath: observed[index]!.relativePath, op: section.op, text: section.after, warnings: section.warnings, ...(section.moveDest ? { moveDest: section.moveDest } : {}) })),
      publish() { clipboard.named = new Map(working.named) },
    }
  } catch (cause) {
    if (cause instanceof PatchlineError) throw cause
    const message = cause instanceof Error ? cause.message : String(cause)
    if (/file changed between read and edit|stale file hash|stale line anchors|ambiguous/i.test(message)) {
      throw new PatchlineError("STALE_SNAPSHOT", `Hashline recovery rejected the live file: ${message}`, { retryable: true, details: { upstream: "hashline-recovery" }, cause })
    }
    throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Hashline preflight failed: ${message}`, { cause })
  }
}

export async function applyHashlineInMemory(snapshot: FileSnapshot, patchText: string, liveText = snapshot.text): Promise<{ text: string; warnings: string[] }> {
  const batch = await applyHashlineBatchInMemory([snapshot], patchText, {}, [liveText])
  const result = batch.results[0]!
  if (result.moveDest || (result.op !== "update" && result.op !== "noop")) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Hashline file operations require a guarded file-operation transaction.", { path: snapshot.relativePath, snapshotId: snapshot.id })
  return result
}
