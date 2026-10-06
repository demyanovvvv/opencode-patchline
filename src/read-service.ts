import { opendir, stat } from "node:fs/promises"
import { PatchlineError } from "./errors.js"
import { readBoundedUtf8Bytes } from "./io/bounded-file.js"
import { decodeUtf8 } from "./preservation/text.js"
import { sliceIndexedLines } from "./preservation/line-index.js"
import { ScopedSnapshotStore, type SnapshotScope } from "./snapshot/store.js"
import { resolveWorkspacePath } from "./workspace/paths.js"

const MAX_READ_FILE_BYTES = 8 * 1024 * 1024
const MAX_READ_LINE_CHARS = 20_000
const MAX_READ_OUTPUT_CHARS = 20_000
const MAX_DIRECTORY_ENTRIES = 4_096

export type ReadRequest = SnapshotScope & {
  filePath: string
  offset?: number | undefined
  limit?: number | undefined
}

export type FileReadResult = {
  kind: "file"
  path: string
  snapshot: string
  tag: string
  offset: number
  endLine: number
  totalLines: number
  requestedLimit: number
  truncated: boolean
  nextOffset?: number | undefined
  lineEnding: string
  bom: boolean
  output: string
  lineIndexReused: boolean
}

export type DirectoryReadResult = {
  kind: "directory"
  path: string
  offset: number
  endEntry: number
  totalEntries: number
  truncated: boolean
  output: string
}

export type ReadResult = FileReadResult & { kind: "file" } | DirectoryReadResult

export function isFileReadResult(result: ReadResult): result is FileReadResult {
  return result.kind === "file"
}

export class ReadService {
  constructor(
    private readonly snapshots: ScopedSnapshotStore,
    private readonly defaultLimit = 120,
  ) {}

  async read(request: ReadRequest): Promise<ReadResult> {
    if (request.offset !== undefined && (!Number.isInteger(request.offset) || request.offset < 1)) {
      throw new PatchlineError("INVALID_ARGUMENT", "Read offset must be a positive integer.", { path: request.filePath })
    }
    if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1)) {
      throw new PatchlineError("INVALID_ARGUMENT", "Read limit must be a positive integer.", { path: request.filePath })
    }
    const resolved = await resolveWorkspacePath(request.worktree, request.filePath, request.authorizePath)
    if (!resolved.exists) {
      throw new PatchlineError("FILE_NOT_FOUND", `File not found: ${request.filePath}`, { path: request.filePath })
    }
    const fileInfo = await stat(resolved.absolute, { bigint: true })
    const displayPath = resolved.relative || "."
    const offset = request.offset ?? 1
    const limit = fileInfo.isDirectory() ? Math.min(this.defaultLimit, request.limit ?? this.defaultLimit) : Math.min(2_000, request.limit ?? this.defaultLimit)

    if (fileInfo.isDirectory()) {
      const directory = await opendir(resolved.absolute)
      const entries: string[] = []
      try {
        while (true) {
          const entry = await directory.read()
          if (entry === null) break
          entries.push(`${entry.name}${entry.isDirectory() ? "/" : ""}`)
          if (entries.length > MAX_DIRECTORY_ENTRIES) {
            throw new PatchlineError("INVALID_ARGUMENT", `Directory exceeds the ${MAX_DIRECTORY_ENTRIES}-entry read limit: ${displayPath}`, { path: displayPath })
          }
        }
      } finally {
        await directory.close()
      }
      entries.sort((left, right) => left.localeCompare(right))
      if (offset > entries.length && !(entries.length === 0 && offset === 1)) {
        throw new PatchlineError("INVALID_ARGUMENT", `Offset ${offset} is out of range for this directory (${entries.length} entries)`, { path: displayPath })
      }
      const selected = entries.slice(offset - 1, offset - 1 + limit)
      const endEntry = selected.length === 0 ? offset - 1 : offset + selected.length - 1
      const truncated = endEntry < entries.length
      const output = [
        `Path: ${displayPath}`,
        "Type: directory",
        "",
        ...selected,
        "",
        truncated
          ? `(Showing ${selected.length} of ${entries.length} entries. Use offset=${endEntry + 1} to continue.)`
          : `(${entries.length} entries)`,
      ].join("\n")
      if (output.length > MAX_READ_OUTPUT_CHARS) {
        throw new PatchlineError("INVALID_ARGUMENT", `Directory read output exceeds the 20,000-character limit: ${displayPath}`, { path: displayPath })
      }
      return {
        kind: "directory",
        path: displayPath,
        offset,
        endEntry,
        totalEntries: entries.length,
        truncated,
        output,
      }
    }

    const document = decodeUtf8(await readBoundedUtf8Bytes(resolved.absolute, resolved.relative, MAX_READ_FILE_BYTES), resolved.relative)
    const lineIndexResult = this.snapshots.getOrBuildLineIndex(document)
    const lineIndex = lineIndexResult.index
    const totalLines = lineIndex.totalLines
    if (offset > totalLines && !(totalLines === 0 && offset === 1)) {
      throw new PatchlineError("INVALID_ARGUMENT", `Offset ${offset} is out of range for this file (${totalLines} lines)`, { path: displayPath })
    }
    let endLine = Math.min(totalLines, offset + limit - 1)
    const selectedLines = sliceIndexedLines(document.normalizedText, lineIndex, offset, limit)
    const rows: string[] = []
    const prefix = (last: number) => [
      `Path: ${displayPath}`,
      `Snapshot: ${"x".repeat(17)}`,
      `Hashline: [${resolved.relative}#${"x".repeat(4)}]`,
      `Range: ${offset}-${last} of ${totalLines}`,
      `Text: ${document.lineEnding}, BOM ${document.bom ? "yes" : "no"}`,
      "",
    ].join("\n")
    const continuation = (last: number) => last < totalLines ? `\n\nMore content is available after line ${last}. Use offset=${last + 1} to continue. Requested limit=${request.limit ?? this.defaultLimit}; returned ${Math.max(0, last - offset + 1)} lines (bounded page).` : ""
    let rendered = 0
    for (const [index, line] of selectedLines.entries()) {
      const row = `${offset + index}:${line}`
      const last = offset + index
      if (line.length > MAX_READ_LINE_CHARS || prefix(last).length + rendered + row.length + index + continuation(last).length > MAX_READ_OUTPUT_CHARS) break
      rows.push(row)
      rendered += row.length
    }
    if (selectedLines.length > 0 && rows.length === 0) throw new PatchlineError("INVALID_ARGUMENT", `A source line exceeds the bounded read output: ${displayPath}. Use ordinary apply_patch with a smaller context.`, { path: displayPath })
    endLine = Math.min(totalLines, offset + rows.length - 1)
    const more = continuation(endLine)
    const seenLines = Array.from({ length: Math.max(0, endLine - offset + 1) }, (_, index) => offset + index)
    const snapshot = this.snapshots.record(request, resolved.canonical, resolved.relative, document, seenLines, {
      device: fileInfo.dev,
      inode: fileInfo.ino,
    }, lineIndex, lineIndexResult.rawDigest)
    const output = [
      `Path: ${displayPath}`,
      `Snapshot: ${snapshot.id}`,
      `Hashline: [${resolved.relative}#${snapshot.tag}]`,
      `Range: ${offset}-${endLine} of ${totalLines}`,
      `Text: ${document.lineEnding}, BOM ${document.bom ? "yes" : "no"}`,
      "",
      ...rows,
    ].join("\n") + more
    return {
      kind: "file",
      path: resolved.relative,
      snapshot: snapshot.id,
      tag: snapshot.tag,
      offset,
      endLine,
      totalLines,
      requestedLimit: request.limit ?? this.defaultLimit,
      truncated: endLine < totalLines,
      nextOffset: endLine < totalLines ? endLine + 1 : undefined,
      lineEnding: document.lineEnding,
      bom: document.bom,
      output,
      lineIndexReused: lineIndexResult.reused,
    }
  }
}
