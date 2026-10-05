import { link, lstat, mkdtemp, readFile, rename, rm, rmdir, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { diffPreview, DIFF_PREVIEW_BUDGET } from "./visualization/diff-preview.js"
import { PatchlineError } from "./errors.js"
import { analyzeDiff, lineRangeForSubstring, type DiffStats } from "./editing/diff.js"
import { applyHashlineBatchInMemory, applyHashlineInMemory, parseHashlinePatch } from "./editing/hashline-adapter.js"
import { applyNormalizedTextPreservingShape, decodeUtf8 } from "./preservation/text.js"
import { digestBytes, ScopedSnapshotStore, type FileIdentity, type FileSnapshot, type SnapshotScope } from "./snapshot/store.js"
import { atomicReplace, readFileIdentity } from "./writing/atomic.js"
import { normalizedIdentity, resolveWorkspacePath } from "./workspace/paths.js"
import { reportMutationStage, type MutationObserver } from "./writing/progress.js"
import { isGeneratedFile } from "./guards/files.js"
import { DEFAULT_CONFIG, type PatchlineConfig } from "./config.js"

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
  backupPath?: string
  parentIdentity: FileIdentity
  committedIdentity?: FileIdentity | undefined
  removed?: boolean
  destination?: { absolute: string; canonical: string; relative: string; parentIdentity: FileIdentity }
  destinationIdentity?: FileIdentity
  previewBudget?: number
}

export type EditResult = {
  path: string
  snapshot: string
  type?: "update" | "delete"
  sourcePath?: string
  added: number
  deleted: number
  bytesWritten: number
  warnings: string[]
  diff: string
  diffTruncated: boolean
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
  private readonly clipboards = new Map<string, { named?: Map<string, readonly string[]> }>()
  private readonly hashlineQueues = new Map<string, Promise<void>>()
  constructor(private readonly snapshots: ScopedSnapshotStore, private readonly config: PatchlineConfig = DEFAULT_CONFIG) {}

  protected async writePreparedFile(prepared: PreparedEdit): Promise<FileIdentity> {
    return atomicReplace(prepared.absolutePath, prepared.afterBytes, {
      expectedParent: prepared.parentIdentity,
      expectedTarget: prepared.snapshot.identity,
    })
  }

  private async assertParent(filePath: string, expected: FileIdentity): Promise<void> {
    const actual = await readFileIdentity(path.dirname(filePath))
    if (actual.device !== expected.device || actual.inode !== expected.inode) throw new PatchlineError("STALE_SNAPSHOT", `Parent directory changed: ${filePath}.`, { path: filePath, retryable: true })
  }

  protected async cleanupBackup(prepared: PreparedEdit): Promise<void> {
    if (!prepared.backupPath || !prepared.committedIdentity) return
    const identity = await readFileIdentity(prepared.backupPath)
    const bytes = await readFile(prepared.backupPath)
    if (identity.device !== prepared.committedIdentity.device || identity.inode !== prepared.committedIdentity.inode || digestBytes(bytes) !== prepared.snapshot.rawDigest) {
      throw new PatchlineError("STALE_SNAPSHOT", `Removal backup changed: ${prepared.snapshot.relativePath}.`, { path: prepared.snapshot.relativePath, retryable: true })
    }
    await unlink(prepared.backupPath)
    await rmdir(path.dirname(prepared.backupPath)).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "ENOTEMPTY" && cause.code !== "EEXIST") throw cause
    })
  }

  private async assertDestination(prepared: PreparedEdit): Promise<void> {
    const destination = prepared.destination!
    const current = await resolveWorkspacePath(prepared.request.worktree, destination.relative, prepared.request.authorizePath)
    if (normalizedIdentity(current.canonical) !== normalizedIdentity(destination.canonical) || current.exists) throw new PatchlineError("STALE_SNAPSHOT", `Move destination changed: ${destination.relative}.`, { path: destination.relative, retryable: true })
    await this.assertParent(destination.absolute, destination.parentIdentity)
  }

  private async stageRemoval(prepared: PreparedEdit): Promise<void> {
    await this.assertPreparedCurrent(prepared)
    await this.assertParent(prepared.absolutePath, prepared.parentIdentity)
    const directory = await mkdtemp(path.join(path.dirname(prepared.absolutePath), ".patchline-tmp-"))
    const backup = path.join(directory, path.basename(prepared.absolutePath))
    try {
      await this.assertPreparedCurrent(prepared)
      await this.assertParent(prepared.absolutePath, prepared.parentIdentity)
      await rename(prepared.absolutePath, backup)
      prepared.backupPath = backup
      prepared.removed = true
      prepared.committedIdentity = await readFileIdentity(backup)
      if (digestBytes(await readFile(backup)) !== prepared.snapshot.rawDigest || prepared.committedIdentity.device !== prepared.snapshot.identity?.device || prepared.committedIdentity.inode !== prepared.snapshot.identity?.inode) {
        throw new PatchlineError("STALE_SNAPSHOT", `Removal target changed: ${prepared.snapshot.relativePath}.`, { path: prepared.snapshot.relativePath, retryable: true })
      }
    } catch (cause) {
      if (!prepared.backupPath) await rm(directory, { recursive: true, force: true })
      throw cause
    }
  }

  protected async restorePreparedFile(prepared: PreparedEdit): Promise<void> {
    if (prepared.backupPath) {
      const identity = await readFileIdentity(prepared.backupPath)
      if (identity.device !== prepared.committedIdentity?.device || identity.inode !== prepared.committedIdentity?.inode || digestBytes(await readFile(prepared.backupPath)) !== prepared.snapshot.rawDigest) throw new PatchlineError("STALE_SNAPSHOT", "Removal backup changed.")
      await this.assertParent(prepared.absolutePath, prepared.parentIdentity)
      const current = await resolveWorkspacePath(prepared.request.worktree, prepared.request.filePath, prepared.request.authorizePath)
      if (current.exists || normalizedIdentity(current.canonical) !== normalizedIdentity(prepared.canonicalPath)) throw new PatchlineError("STALE_SNAPSHOT", "Removal source was replaced.")
      if (prepared.destinationIdentity) {
        const destination = prepared.destination!
        const actual = await readFileIdentity(destination.absolute)
        if (actual.device !== prepared.destinationIdentity.device || actual.inode !== prepared.destinationIdentity.inode || digestBytes(await readFile(destination.absolute)) !== digestBytes(prepared.afterBytes)) throw new PatchlineError("STALE_SNAPSHOT", "Move destination changed.")
        await this.assertParent(destination.absolute, destination.parentIdentity)
      }
      await link(prepared.backupPath, prepared.absolutePath)
      if (prepared.destinationIdentity) await unlink(prepared.destination!.absolute)
      await unlink(prepared.backupPath)
      await rmdir(path.dirname(prepared.backupPath)).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== "ENOTEMPTY" && cause.code !== "EEXIST") throw cause
      })
      return
    }
    const expectedIdentity = prepared.committedIdentity
    if (!expectedIdentity) throw new PatchlineError("TRANSACTION_FAILED", `Missing landed identity for ${prepared.snapshot.relativePath}.`)
    const currentPath = await resolveWorkspacePath(prepared.request.worktree, prepared.request.filePath, prepared.request.authorizePath)
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
    return this.prepareResult(request, async (snapshot) => request.exact
      ? { text: applyExact(snapshot, request.exact), warnings: [] }
      : applyHashlineInMemory(snapshot, request.hashlinePatch!, this.config.hashlineRecovery ? decodeUtf8(await readFile(snapshot.canonicalPath), snapshot.relativePath).normalizedText : snapshot.text))
  }

  protected async prepareResult(request: EditRequest, transform: (snapshot: FileSnapshot) => Promise<{ text: string; warnings: string[] }>, allowUnchanged = false): Promise<PreparedEdit> {
    const resolved = await resolveWorkspacePath(request.worktree, request.filePath, request.authorizePath)
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
    if (digestBytes(beforeBytes) !== snapshot.rawDigest && (request.hashlinePatch === undefined || !this.config.hashlineRecovery)) {
      throw new PatchlineError(
        "STALE_SNAPSHOT",
        `Edit rejected: ${resolved.relative} changed since snapshot ${request.snapshot}. Re-read the affected range before retrying.`,
        { path: resolved.relative, snapshotId: request.snapshot, retryable: true, details: { rereadRequired: true } },
      )
    }
    const beforeDocument = decodeUtf8(beforeBytes, resolved.relative)
    const result = await transform(snapshot)
    if (Buffer.byteLength(result.text, "utf8") > MAX_EDIT_CONTENT_BYTES) {
      throw new PatchlineError("INVALID_ARGUMENT", "Edit result exceeds the 8 MiB limit.", { path: snapshot.relativePath, snapshotId: snapshot.id })
    }
    const normalizedAfter = result.text
    const warnings = result.warnings
    if (!allowUnchanged && normalizedAfter === snapshot.text) {
      throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "The edit produced no changes.", { path: resolved.relative })
    }
    const afterBytes = applyNormalizedTextPreservingShape(normalizedAfter, beforeDocument)
    const beforeText = beforeDocument.normalizedText
    const analysis = analyzeDiff(beforeText, normalizedAfter, beforeText === snapshot.text ? snapshot.seenLines : new Set())
    return {
      request,
      snapshot,
      absolutePath: resolved.absolute,
      canonicalPath: resolved.canonical,
      beforeBytes,
      afterBytes,
      beforeText,
      afterText: normalizedAfter,
      stats: analysis.stats,
      seenLinesAfter: analysis.seenLinesAfter,
      warnings,
      parentIdentity,
    }
  }

  protected async assertPreparedCurrent(prepared: PreparedEdit): Promise<void> {
    const currentPath = await resolveWorkspacePath(prepared.request.worktree, prepared.request.filePath, prepared.request.authorizePath)
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
    if (digestBytes(current) !== digestBytes(prepared.beforeBytes)) {
      throw new PatchlineError(
        "STALE_SNAPSHOT",
        `Edit rejected: ${prepared.snapshot.relativePath} changed after preflight. Re-read before retrying.`,
        { path: prepared.snapshot.relativePath, snapshotId: prepared.snapshot.id, retryable: true },
      )
    }
  }

  async applyHashline(scope: SnapshotScope, patchText: string, observer?: MutationObserver, signal?: AbortSignal): Promise<EditResult[]> {
    signal?.throwIfAborted()
    const key = `${scope.sessionId}\0${normalizedIdentity(scope.worktree)}`
    const previous = this.hashlineQueues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.hashlineQueues.set(key, current)
    try {
      await previous
      signal?.throwIfAborted()
      return await this.applyHashlineScoped(scope, patchText, observer, signal)
    } finally {
      release()
      if (this.hashlineQueues.get(key) === current) this.hashlineQueues.delete(key)
    }
  }

  private async applyHashlineScoped(scope: SnapshotScope, patchText: string, observer?: MutationObserver, signal?: AbortSignal): Promise<EditResult[]> {
    signal?.throwIfAborted()
    if (Buffer.byteLength(patchText, "utf8") > MAX_EDIT_CONTENT_BYTES) throw new PatchlineError("INVALID_ARGUMENT", "Patch exceeds the 8 MiB limit.")
    const sections = await parseHashlinePatch(patchText)
    if (sections.length === 0 || sections.length > MAX_BATCH_ITEMS) throw new PatchlineError("INVALID_ARGUMENT", "Hashline patch must contain 1–500 files.")
    const observed: FileSnapshot[] = []
    const occupied = new Set<string>()
    for (const section of sections) {
      signal?.throwIfAborted()
      const resolved = await resolveWorkspacePath(scope.worktree, section.path, scope.authorizePath)
      const key = normalizedIdentity(resolved.canonical)
      if (occupied.has(key)) throw new PatchlineError("INVALID_ARGUMENT", `Duplicate Hashline target: ${section.path}`)
      occupied.add(key)
      if (section.fileOp && resolved.symlink) throw new PatchlineError("SYMLINK_ESCAPE", `File operations cannot target a symbolic link: ${resolved.relative}`, { path: resolved.relative })
      if (section.fileOp) {
        const entry = await lstat(resolved.absolute)
        if (entry.isSymbolicLink()) throw new PatchlineError("SYMLINK_ESCAPE", `File operations cannot target a symbolic link: ${resolved.relative}`, { path: resolved.relative })
      }
      const snapshot = this.snapshots.get(scope, resolved.canonical, section.tag)
      if (!snapshot) throw new PatchlineError("SNAPSHOT_NOT_FOUND", `Read ${section.path} before applying Hashline.`, { path: section.path, retryable: true })
      if ((!this.config.hashlineRecovery || section.fileOp !== undefined) && digestBytes(await readFile(resolved.absolute)) !== snapshot.rawDigest) throw new PatchlineError("STALE_SNAPSHOT", `Re-read ${section.path} before retrying.`, { path: section.path, retryable: true })
      observed.push(snapshot)
    }
    const key = `${scope.sessionId}\0${normalizedIdentity(scope.worktree)}`
    const clipboard = this.clipboards.get(key) ?? {}
    const normalizedPatch = sections.map((section, index) => section.patch.replace(/^\[[^\n]+\]/, `[${observed[index]!.relativePath}#${observed[index]!.tag}]`)).join("\n")
    const liveTexts = await Promise.all(observed.map(async (snapshot) => decodeUtf8(await readFile(snapshot.canonicalPath), snapshot.relativePath).normalizedText))
    const batch = await applyHashlineBatchInMemory(observed, normalizedPatch, clipboard, this.config.hashlineRecovery ? liveTexts : undefined)
    const prepared: PreparedEdit[] = []
    for (const [index, result] of batch.results.entries()) {
      const section = sections[index]!
      const snapshot = observed[index]!
      const request = { ...scope, filePath: snapshot.relativePath, snapshot: snapshot.id, hashlinePatch: section.patch }
      const removing = result.op === "delete"
      if (this.config.hashlineRecovery && section.fileOp === undefined) {
        const current = decodeUtf8(await readFile(snapshot.canonicalPath), snapshot.relativePath).normalizedText
        if (current !== snapshot.text && !result.warnings.some((warning) => /recover|drift/i.test(warning))) throw new PatchlineError("STALE_SNAPSHOT", `Hashline recovery could not prove unchanged anchors for ${snapshot.relativePath}.`, { path: snapshot.relativePath, snapshotId: snapshot.id, retryable: true })
      }
      if (this.config.protectGeneratedFiles && isGeneratedFile(snapshot.relativePath, this.config.generatedPatterns)) throw new PatchlineError("GENERATED_FILE", `Generated file cannot be patched: ${snapshot.relativePath}`)
      const item = await this.prepareResult(request, async () => ({ text: removing ? "" : result.text, warnings: result.warnings }), removing || !!result.moveDest || result.op === "noop")
      if (removing && snapshot.text.split("\n").some((line, row) => (line.length > 0 || row < snapshot.text.split("\n").length - 1) && !snapshot.seenLines.has(row + 1))) throw new PatchlineError("INVALID_ANCHOR", `Read all lines before removing ${snapshot.relativePath}.`)
      if (removing) item.removed = false
      if (result.moveDest) {
        const destination = await resolveWorkspacePath(scope.worktree, result.moveDest, scope.authorizePath)
        if (destination.exists) throw new PatchlineError("WRITE_PROTECTED", `Move destination already exists: ${result.moveDest}`)
        if (this.config.protectGeneratedFiles && isGeneratedFile(destination.relative, this.config.generatedPatterns)) throw new PatchlineError("GENERATED_FILE", `Generated move destination: ${destination.relative}`)
        if (occupied.has(normalizedIdentity(destination.canonical))) throw new PatchlineError("INVALID_ARGUMENT", `Move destination overlaps another section: ${destination.relative}`)
        occupied.add(normalizedIdentity(destination.canonical))
        item.destination = { ...destination, parentIdentity: await readFileIdentity(path.dirname(destination.absolute)) }
      }
      if (result.op !== "noop" || result.moveDest) prepared.push(item)
    }
    if (prepared.length === 0) throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "The patch produced no changes.")
    const results = await this.commitBatch(prepared, observer, signal)
    batch.publish()
    this.clipboards.set(key, clipboard)
    while (this.clipboards.size > 512) this.clipboards.delete(this.clipboards.keys().next().value!)
    return results
  }

  async commit(prepared: PreparedEdit): Promise<EditResult> {
    await this.assertPreparedCurrent(prepared)
    if (prepared.removed === false || prepared.destination) {
      if (prepared.destination) await this.assertDestination(prepared)
      await this.stageRemoval(prepared)
      let next: FileSnapshot | undefined
      if (prepared.destination) {
        const destination = prepared.destination
        await this.assertDestination(prepared)
        await link(prepared.backupPath!, destination.absolute)
        prepared.destinationIdentity = prepared.committedIdentity!
        if (digestBytes(prepared.afterBytes) !== prepared.snapshot.rawDigest) {
          prepared.destinationIdentity = await atomicReplace(destination.absolute, prepared.afterBytes, { expectedParent: destination.parentIdentity, expectedTarget: prepared.destinationIdentity })
        }
        next = this.snapshots.record(prepared.request, destination.canonical, destination.relative, decodeUtf8(prepared.afterBytes), prepared.seenLinesAfter, prepared.destinationIdentity)
      }
      this.snapshots.invalidate(prepared.canonicalPath, prepared.request)
      const target = prepared.destination?.relative ?? prepared.snapshot.relativePath
      const budget = prepared.previewBudget ?? DIFF_PREVIEW_BUDGET
      const preview = budget > 0 ? diffPreview(prepared.snapshot.relativePath, prepared.destination?.relative ?? "/dev/null", prepared.beforeText, prepared.afterText, budget) : { patch: "", truncated: true }
      return { path: target, sourcePath: prepared.snapshot.relativePath, type: prepared.destination ? "update" : "delete", snapshot: next?.id ?? "", added: prepared.stats.added, deleted: prepared.stats.deleted, bytesWritten: prepared.destination ? prepared.afterBytes.byteLength : 0, warnings: prepared.warnings, diff: preview.patch, diffTruncated: preview.truncated, output: `${prepared.destination ? "Moved" : "Removed"}: ${prepared.snapshot.relativePath}${prepared.destination ? ` -> ${target}` : ""}${next ? `\nNext snapshot: ${next.id}` : ""}` }
    }
    const document = decodeUtf8(prepared.afterBytes, prepared.snapshot.relativePath)
    const budget = prepared.previewBudget ?? DIFF_PREVIEW_BUDGET
    const preview = budget > 0 ? diffPreview(prepared.snapshot.relativePath, prepared.snapshot.relativePath, prepared.beforeText, prepared.afterText, budget) : { patch: "", truncated: true }
    const nextIdentity = await this.writePreparedFile(prepared)
    prepared.committedIdentity = nextIdentity
    let next: FileSnapshot
    try {
      next = this.snapshots.record(
        prepared.request,
        prepared.canonicalPath,
        prepared.snapshot.relativePath,
        document,
        prepared.seenLinesAfter,
        nextIdentity,
      )
    } catch (cause) {
      this.snapshots.invalidate(prepared.canonicalPath, prepared.request)
      throw new PatchlineError("TRANSACTION_FAILED", `File changed but snapshot bookkeeping failed: ${prepared.snapshot.relativePath}. Re-read before retrying.`, { cause, path: prepared.snapshot.relativePath, writes: 1 })
    }
    return {
      path: prepared.snapshot.relativePath,
      snapshot: next.id,
      added: prepared.stats.added,
      deleted: prepared.stats.deleted,
      bytesWritten: prepared.afterBytes.byteLength,
      warnings: prepared.warnings,
      diff: preview.patch,
      diffTruncated: preview.truncated,
      output: [
        `Changed: ${prepared.snapshot.relativePath}`,
        `Diff: +${prepared.stats.added} -${prepared.stats.deleted}`,
        "Snapshot verified. No stale conflict.",
        `Next snapshot: ${next.id}`,
        ...(prepared.warnings.length > 0 ? [`Warnings: ${prepared.warnings.join(" ")}`] : []),
      ].join("\n"),
    }
  }

  async edit(request: EditRequest, observer?: MutationObserver, signal?: AbortSignal): Promise<EditResult> {
    const results = await this.editBatch([request], observer, signal)
    return results[0]!
  }

  async editBatch(requests: readonly EditRequest[], observer?: MutationObserver, signal?: AbortSignal): Promise<EditResult[]> {
    signal?.throwIfAborted()
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
    signal?.throwIfAborted()
    return this.commitBatch(prepared, observer, signal)
  }

  protected async commitBatch(prepared: readonly PreparedEdit[], observer?: MutationObserver, signal?: AbortSignal): Promise<EditResult[]> {
    const results: EditResult[] = []
    const landed: PreparedEdit[] = []
    let remainingPreview = DIFF_PREVIEW_BUDGET
    signal?.throwIfAborted()
    reportMutationStage(observer, "committing")
    try {
      for (const item of prepared) {
        signal?.throwIfAborted()
        item.previewBudget = remainingPreview
        landed.push(item)
        const result = await this.commit(item)
        results.push(result)
        remainingPreview -= result.diff.length
        signal?.throwIfAborted()
      }
      for (const [index, item] of prepared.entries()) {
        try {
          await this.cleanupBackup(item)
        } catch {
          results[index]?.warnings.push(`Warning: rollback backup retained for ${item.snapshot.relativePath}.`)
        }
      }
      return results
    } catch (cause) {
      const restored: string[] = []
      const conflicts: string[] = []
      reportMutationStage(observer, "rollback")
      const committed = landed.filter((item) => item.committedIdentity || item.backupPath)
      for (const item of [...committed].reverse()) {
        try {
          await this.restorePreparedFile(item)
          this.snapshots.invalidate(item.canonicalPath, item.request)
          restored.push(item.snapshot.relativePath)
        } catch {
          conflicts.push(item.snapshot.relativePath)
        }
      }
      if (committed.length === 0) throw cause
      const conflictMessage = conflicts.length > 0 ? ` Preserved external changes in: ${conflicts.join(", ")}.` : ""
      throw new PatchlineError("TRANSACTION_FAILED", `Batch commit failed; restored ${restored.length} of ${committed.length} landed files.${conflictMessage}`, {
        cause,
        writes: committed.length,
        details: { restored, conflicts, ...(signal?.aborted ? { cancelled: true } : {}) },
      })
    }
  }
}
