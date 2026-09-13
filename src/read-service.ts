import { readdir, readFile, stat } from "node:fs/promises"
import { PatchlineError } from "./errors.js"
import { decodeUtf8 } from "./preservation/text.js"
import { ScopedSnapshotStore, type SnapshotScope } from "./snapshot/store.js"
import { resolveWorkspacePath } from "./workspace/paths.js"

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
  lineEnding: string
  bom: boolean
  output: string
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
    const resolved = await resolveWorkspacePath(request.worktree, request.filePath)
    if (!resolved.exists) {
      throw new PatchlineError("FILE_NOT_FOUND", `File not found: ${request.filePath}`, { path: request.filePath })
    }
    const fileInfo = await stat(resolved.absolute, { bigint: true })
    const displayPath = resolved.relative || "."
    const offset = request.offset ?? 1
    const limit = Math.min(this.defaultLimit, request.limit ?? this.defaultLimit)

    if (fileInfo.isDirectory()) {
      const entries = (await readdir(resolved.absolute, { withFileTypes: true }))
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .sort((left, right) => left.localeCompare(right))
      if (offset > entries.length && !(entries.length === 0 && offset === 1)) {
        throw new PatchlineError("INVALID_ARGUMENT", `Offset ${offset} is out of range for this directory (${entries.length} entries)`, { path: displayPath })
      }
      const selected = entries.slice(offset - 1, offset - 1 + limit)
      const endEntry = selected.length === 0 ? offset - 1 : offset + selected.length - 1
      const truncated = endEntry < entries.length
      return {
        kind: "directory",
        path: displayPath,
        offset,
        endEntry,
        totalEntries: entries.length,
        truncated,
        output: [
          `Path: ${displayPath}`,
          "Type: directory",
          "",
          ...selected,
          "",
          truncated
            ? `(Showing ${selected.length} of ${entries.length} entries. Use offset=${endEntry + 1} to continue.)`
            : `(${entries.length} entries)`,
        ].join("\n"),
      }
    }

    const document = decodeUtf8(await readFile(resolved.absolute), resolved.relative)
    const lines = document.normalizedText.length === 0 ? [] : document.normalizedText.split("\n")
    if (document.normalizedText.endsWith("\n")) lines.pop()
    const totalLines = lines.length
    if (offset > totalLines && !(totalLines === 0 && offset === 1)) {
      throw new PatchlineError("INVALID_ARGUMENT", `Offset ${offset} is out of range for this file (${totalLines} lines)`, { path: displayPath })
    }
    const endLine = Math.min(totalLines, offset + limit - 1)
    const seenLines = Array.from({ length: Math.max(0, endLine - offset + 1) }, (_, index) => offset + index)
    const snapshot = this.snapshots.record(request, resolved.canonical, resolved.relative, document, seenLines, {
      device: fileInfo.dev,
      inode: fileInfo.ino,
    })
    const rows = lines.slice(offset - 1, endLine).map((line, index) => `${offset + index}:${line}`)
    const more = endLine < totalLines ? `\n\nMore content is available after line ${endLine}.` : ""
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
      lineEnding: document.lineEnding,
      bom: document.bom,
      output,
    }
  }
}
