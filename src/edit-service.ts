import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { PatchlineError } from "./errors.js"
import { diffStats, lineRangeForSubstring, mapSeenLines, type DiffStats } from "./editing/diff.js"
import { applyHashlineInMemory } from "./editing/hashline-adapter.js"
import { applyNormalizedTextPreservingShape, decodeUtf8 } from "./preservation/text.js"
import { digestBytes, ScopedSnapshotStore, type FileIdentity, type FileSnapshot, type SnapshotScope } from "./snapshot/store.js"
import { atomicReplace, readFileIdentity } from "./writing/atomic.js"
import { normalizedIdentity, resolveWorkspacePath } from "./workspace/paths.js"

const MAX_EDIT_CONTENT_BYTES = 8 * 1024 * 1024
const MAX_BATCH_ITEMS = 500

export type ExactEdit = {
  oldString: string
  newString: string
  replaceAll?: boolean | undefined
}

export type EditRequest = SnapshotScope & {
  filePath: string
  snapshot: string
  exact?: ExactEdit | undefined
  hashlinePatch?: string | undefined
}

export type PreparedEdit = {
  request: EditRequest
  snapshot: FileSnapshot
  absolutePath: string
  canonicalPath: string
  beforeBytes: Uint8Array
  afterBytes: Uint8Array
  beforeText: string
  afterText: string
  stats: DiffStats
  seenLinesAfter: ReadonlySet<number>
  warnings: string[]
  parentIdentity: FileIdentity
  committedIdentity?: FileIdentity | undefined
}

export type EditResult = {
  path: string
  snapshot: string
  added: number
  deleted: number
  warnings: string[]
  output: string
}

async function assertSnapshotIdentity(prepared: PreparedEdit): Promise<void> {
  if (!prepared.snapshot.identity) return
  const current = await stat(prepared.absolutePath, { bigint: true })
  if (current.dev === prepared.snapshot.identity.device && current.ino === prepared.snapshot.identity.inode) return
  throw new PatchlineError(
    "STALE_SNAPSHOT",
    `Edit rejected: ${prepared.snapshot.relativePath} was replaced after snapshot ${prepared.snapshot.id}. Re-read before retrying.`,
    { path: prepared.snapshot.relativePath, snapshotId: prepared.snapshot.id, retryable: true },
  )
}

function occurrences(text: string, value: string): number[] {
  if (value.length === 0) return []
  const indexes: number[] = []
  let from = 0
  while (from <= text.length) {
    const index = text.indexOf(value, from)
    if (index === -1) break
    indexes.push(index)
    from = index + Math.max(1, value.length)
  }
  return indexes
}

function applyExact(snapshot: FileSnapshot, edit: ExactEdit): string {
  if (!edit.oldString) throw new PatchlineError("INVALID_ARGUMENT", "oldString must not be empty for an existing file.")
  if (edit.oldString === edit.newString) throw new PatchlineError("INVALID_ARGUMENT", "oldString and newString must differ.")
  const indexes = occurrences(snapshot.text, edit.oldString)
  if (indexes.length === 0) {
    throw new PatchlineError("INVALID_ANCHOR", "oldString was not found in the observed snapshot.", {
      path: snapshot.relativePath,
      snapshotId: snapshot.id,
      retryable: true,
    })
  }
  if (!edit.replaceAll && indexes.length !== 1) {
    throw new PatchlineError("INVALID_ANCHOR", `oldString matches ${indexes.length} locations; provide a unique observed range.`, {
      path: snapshot.relativePath,
      snapshotId: snapshot.id,
      retryable: true,
    })
  }
  for (const index of indexes) {
    const range = lineRangeForSubstring(snapshot.text, index, edit.oldString.length)
    for (let line = range.start; line <= range.end; line++) {
      if (!snapshot.seenLines.has(line)) {
        throw new PatchlineError("INVALID_ANCHOR", `Line ${line} was not displayed by the read that created this snapshot.`, {
          path: snapshot.relativePath,
          snapshotId: snapshot.id,
          retryable: true,
        })
      }
    }
  }
  const result = edit.replaceAll ? snapshot.text.split(edit.oldString).join(edit.newString) : snapshot.text.replace(edit.oldString, edit.newString)
  if (Buffer.byteLength(result, "utf8") > MAX_EDIT_CONTENT_BYTES) {
    throw new PatchlineError("INVALID_ARGUMENT", "Edit result exceeds the 8 MiB limit.", { path: snapshot.relativePath, snapshotId: snapshot.id })
  }
  return result
}

export class EditService {
  constructor(private readonly snapshots: ScopedSnapshotStore) {}

  protected async writePreparedFile(prepared: PreparedEdit): Promise<FileIdentity> {
    return atomicReplace(prepared.absolutePath, prepared.afterBytes, {
      expectedParent: prepared.parentIdentity,
      expectedTarget: prepared.snapshot.identity,
    })
  }

  protected async restorePreparedFile(prepared: PreparedEdit): Promise<void> {
    const expectedIdentity = prepared.committedIdentity
    if (!expectedIdentity) throw new PatchlineError("TRANSACTION_FAILED", `Missing landed identity for ${prepared.snapshot.relativePath}.`)
    const currentPath = await resolveWorkspacePath(prepared.request.worktree, prepared.request.filePath)
    if (!currentPath.exists || normalizedIdentity(currentPath.canonical) !== normalizedIdentity(prepared.canonicalPath)) {
      throw new PatchlineError("STALE_SNAPSHOT", `Rollback target changed: ${prepared.snapshot.relativePath}.`, {
        path: prepared.snapshot.relativePath,
        retryable: true,
      })
    }
    const currentIdentity = await stat(currentPath.absolute, { bigint: true })
    if (currentIdentity.dev !== expectedIdentity.device || currentIdentity.ino !== expectedIdentity.inode) {
      throw new PatchlineError("STALE_SNAPSHOT", `Rollback target was replaced: ${prepared.snapshot.relativePath}.`, {
        path: prepared.snapshot.relativePath,
        retryable: true,
      })
    }
    const current = await readFile(currentPath.absolute)
    if (digestBytes(current) !== digestBytes(prepared.afterBytes)) {
      throw new PatchlineError("STALE_SNAPSHOT", `Rollback target changed: ${prepared.snapshot.relativePath}.`, {
        path: prepared.snapshot.relativePath,
        retryable: true,
      })
    }
    await atomicReplace(currentPath.absolute, prepared.beforeBytes, {
      expectedParent: prepared.parentIdentity,
      expectedTarget: prepared.committedIdentity,
    })
  }

  async prepare(request: EditRequest): Promise<PreparedEdit> {
    if ((request.exact === undefined) === (request.hashlinePatch === undefined)) {
      throw new PatchlineError("INVALID_ARGUMENT", "Provide exactly one of exact or hashlinePatch.")
    }
    const resolved = await resolveWorkspacePath(request.worktree, request.filePath)
    if (!resolved.exists) throw new PatchlineError("FILE_NOT_FOUND", `File not found: ${request.filePath}`, { path: request.filePath })
    const snapshot = this.snapshots.get(request, resolved.canonical, request.snapshot)
    if (!snapshot) {
      throw new PatchlineError("SNAPSHOT_NOT_FOUND", `No matching snapshot for ${resolved.relative}. Re-read the affected range.`, {
        path: resolved.relative,
        snapshotId: request.snapshot,
        retryable: true,
      })
    }
    const beforeBytes = await readFile(resolved.absolute)
    const parentIdentity = await readFileIdentity(path.dirname(resolved.absolute))
    if (digestBytes(beforeBytes) !== snapshot.rawDigest) {
      throw new PatchlineError(
        "STALE_SNAPSHOT",
        `Edit rejected: ${resolved.relative} changed since snapshot ${request.snapshot}. Re-read the affected range before retrying.`,
        { path: resolved.relative, snapshotId: request.snapshot, retryable: true, details: { rereadRequired: true } },
      )
    }
    const beforeDocument = decodeUtf8(beforeBytes, resolved.relative)
    let normalizedAfter: string
    let warnings: string[] = []
    if (request.exact) {
      normalizedAfter = applyExact(snapshot, request.exact)
    } else {
      const result = await applyHashlineInMemory(snapshot, request.hashlinePatch!)
      if (Buffer.byteLength(result.text, "utf8") > MAX_EDIT_CONTENT_BYTES) {
        throw new PatchlineError("INVALID_ARGUMENT", "Edit result exceeds the 8 MiB limit.", { path: snapshot.relativePath, snapshotId: snapshot.id })
      }
      normalizedAfter = result.text
      warnings = result.warnings
    }
    if (normalizedAfter === snapshot.text) {
      throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "The edit produced no changes.", { path: resolved.relative })
    }
    const afterBytes = applyNormalizedTextPreservingShape(normalizedAfter, beforeDocument)
    return {
      request,
      snapshot,
      absolutePath: resolved.absolute,
      canonicalPath: resolved.canonical,
      beforeBytes,
      afterBytes,
      beforeText: snapshot.text,
      afterText: normalizedAfter,
      stats: diffStats(snapshot.text, normalizedAfter),
      seenLinesAfter: mapSeenLines(snapshot.text, normalizedAfter, snapshot.seenLines),
      warnings,
      parentIdentity,
    }
  }

  async commit(prepared: PreparedEdit): Promise<EditResult> {
    const currentPath = await resolveWorkspacePath(prepared.request.worktree, prepared.request.filePath)
    if (!currentPath.exists) {
      throw new PatchlineError("FILE_NOT_FOUND", `Edit target disappeared after preflight: ${prepared.snapshot.relativePath}`, {
        path: prepared.snapshot.relativePath,
        snapshotId: prepared.snapshot.id,
        retryable: true,
      })
    }
    if (normalizedIdentity(currentPath.canonical) !== normalizedIdentity(prepared.canonicalPath)) {
      throw new PatchlineError(
        "STALE_SNAPSHOT",
        `Edit rejected: ${prepared.snapshot.relativePath} changed identity after preflight. Re-read before retrying.`,
        { path: prepared.snapshot.relativePath, snapshotId: prepared.snapshot.id, retryable: true },
      )
    }
    await assertSnapshotIdentity(prepared)
    const current = await readFile(prepared.absolutePath)
    if (digestBytes(current) !== prepared.snapshot.rawDigest) {
      throw new PatchlineError(
        "STALE_SNAPSHOT",
        `Edit rejected: ${prepared.snapshot.relativePath} changed after preflight. Re-read before retrying.`,
        { path: prepared.snapshot.relativePath, snapshotId: prepared.snapshot.id, retryable: true },
      )
    }
    const nextIdentity = await this.writePreparedFile(prepared)
    const document = decodeUtf8(prepared.afterBytes, prepared.snapshot.relativePath)
    prepared.committedIdentity = nextIdentity
    const next = this.snapshots.record(
      prepared.request,
      prepared.canonicalPath,
      prepared.snapshot.relativePath,
      document,
      prepared.seenLinesAfter,
      nextIdentity,
    )
    return {
      path: prepared.snapshot.relativePath,
      snapshot: next.id,
      added: prepared.stats.added,
      deleted: prepared.stats.deleted,
      warnings: prepared.warnings,
      output: [
        `Changed: ${prepared.snapshot.relativePath}`,
        `Diff: +${prepared.stats.added} -${prepared.stats.deleted}`,
        "Snapshot verified. No stale conflict.",
        `Next snapshot: ${next.id}`,
        ...(prepared.warnings.length > 0 ? [`Warnings: ${prepared.warnings.join(" ")}`] : []),
      ].join("\n"),
    }
  }

  async edit(request: EditRequest): Promise<EditResult> {
    return this.commit(await this.prepare(request))
  }

  async editBatch(requests: readonly EditRequest[]): Promise<EditResult[]> {
    if (requests.length === 0) throw new PatchlineError("INVALID_ARGUMENT", "Batch must contain at least one edit.")
    if (requests.length > MAX_BATCH_ITEMS) throw new PatchlineError("INVALID_ARGUMENT", `Batch must contain at most ${MAX_BATCH_ITEMS} edits.`)
    const prepared: PreparedEdit[] = []
    const paths = new Set<string>()
    for (const request of requests) {
      const item = await this.prepare(request)
      const canonicalIdentity = normalizedIdentity(item.canonicalPath)
      if (paths.has(canonicalIdentity)) {
        throw new PatchlineError("INVALID_ARGUMENT", `Batch contains duplicate target: ${item.snapshot.relativePath}`)
      }
      paths.add(canonicalIdentity)
      prepared.push(item)
    }
    const results: EditResult[] = []
    const landed: PreparedEdit[] = []
    try {
      for (const item of prepared) {
        results.push(await this.commit(item))
        landed.push(item)
      }
      return results
    } catch (cause) {
      const restored: string[] = []
      const conflicts: string[] = []
      for (const item of landed.reverse()) {
        try {
          await this.restorePreparedFile(item)
          this.snapshots.invalidate(item.canonicalPath, item.request)
          restored.push(item.snapshot.relativePath)
        } catch {
          conflicts.push(item.snapshot.relativePath)
        }
      }
      if (cause instanceof PatchlineError && landed.length === 0) throw cause
      const conflictMessage = conflicts.length > 0 ? ` Preserved external changes in: ${conflicts.join(", ")}.` : ""
      throw new PatchlineError("TRANSACTION_FAILED", `Batch commit failed; restored ${restored.length} of ${landed.length} landed files.${conflictMessage}`, {
        cause,
        writes: landed.length,
        details: { restored, conflicts },
      })
    }
  }
}
