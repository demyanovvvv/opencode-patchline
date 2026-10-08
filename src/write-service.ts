import { open, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"
import type { PatchlineConfig } from "./config.js"
import { PatchlineError } from "./errors.js"
import { isGeneratedFile, matchesAllowedPath } from "./guards/files.js"
import { atomicReplace, readFileIdentity } from "./writing/atomic.js"
import { normalizedIdentity, resolveWorkspacePath } from "./workspace/paths.js"
import { digestBytes, type FileIdentity } from "./snapshot/store.js"
import { reportMutationStage, type MutationObserver } from "./writing/progress.js"
import { cleanupParents, ensureParents, type CreatedDirectory } from "./writing/parents.js"
import { withPathLocks } from "./writing/path-lock.js"
import { readBoundedUtf8Bytes } from "./io/bounded-file.js"

const MAX_WRITE_CONTENT_BYTES = 8 * 1024 * 1024
const MAX_BATCH_ITEMS = 500

function assertWriteSize(content: string, pathName: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_CONTENT_BYTES) {
    throw new PatchlineError("INVALID_ARGUMENT", `Write content exceeds the 8 MiB limit: ${pathName}`, { path: pathName })
  }
}

export type WriteRequest = {
  worktree: string
  filePath: string
  content: string
  authorizePath?: ((path: string) => Promise<void>) | undefined
}

export type PreparedWrite = WriteRequest & {
  absolutePath: string
  canonicalPath: string
  relativePath: string
  signal?: AbortSignal | undefined
  directories?: CreatedDirectory[]
}

type CreatedWrite = PreparedWrite & CreatedFile

type CreatedFile = {
  bytes: Uint8Array
  identity?: FileIdentity | undefined
}

export class WriteService {
  constructor(private readonly config: PatchlineConfig) {}

  protected async replaceExistingFile(
    filePath: string,
    content: string,
    expectedTarget: FileIdentity,
    expectedParent: FileIdentity,
    expectedDigest: string,
  ): Promise<void> {
    await atomicReplace(filePath, Buffer.from(content, "utf8"), { expectedParent, expectedTarget, expectedDigest })
  }

  protected async writeCreatedFile(item: PreparedWrite, onCreated?: (file: CreatedFile) => void): Promise<CreatedFile> {
    item.signal?.throwIfAborted()
    item.directories = await ensureParents(item.worktree, item.filePath, item.signal, item.authorizePath)
    const currentPath = await resolveWorkspacePath(item.worktree, item.filePath, item.authorizePath)
    if (currentPath.exists || normalizedIdentity(currentPath.canonical) !== normalizedIdentity(item.canonicalPath)) {
      throw new PatchlineError("STALE_SNAPSHOT", `Create target changed after preflight: ${item.relativePath}.`, {
        path: item.relativePath,
        retryable: true,
      })
    }
    item.signal?.throwIfAborted()
    const handle = await open(item.absolutePath, "wx+")
    const created: CreatedFile = { bytes: Buffer.alloc(0) }
    try {
      onCreated?.(created)
      const identity = await handle.stat({ bigint: true })
      created.identity = { device: identity.dev, inode: identity.ino }
      onCreated?.(created)
      const expected = Buffer.from(item.content, "utf8")
      let offset = 0
      while (offset < expected.length) {
        item.signal?.throwIfAborted()
        const result = await handle.write(expected, offset, expected.length - offset, offset)
        if (result.bytesWritten === 0) throw new PatchlineError("TRANSACTION_FAILED", `Could not write created file: ${item.relativePath}.`)
        offset += result.bytesWritten
        created.bytes = expected.subarray(0, offset)
        onCreated?.(created)
      }
      const bytes = Buffer.alloc(expected.length)
      offset = 0
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (result.bytesRead === 0) throw new PatchlineError("TRANSACTION_FAILED", `Could not verify created file: ${item.relativePath}.`)
        offset += result.bytesRead
      }
      const final = await handle.stat({ bigint: true })
      if (final.size !== BigInt(expected.length) || digestBytes(bytes) !== digestBytes(expected)) {
        throw new PatchlineError("STALE_SNAPSHOT", `Created file changed during verification: ${item.relativePath}.`, { path: item.relativePath, retryable: true })
      }
      created.bytes = bytes
      onCreated?.(created)
      return created
    } finally {
      await handle.close()
    }
  }

  protected async removeCreatedFile(item: CreatedWrite): Promise<void> {
    if (!item.identity) throw new PatchlineError("STALE_SNAPSHOT", `Create rollback identity is unavailable: ${item.relativePath}.`, { path: item.relativePath, retryable: true })
    const currentPath = await resolveWorkspacePath(item.worktree, item.filePath, item.authorizePath)
    if (!currentPath.exists || normalizedIdentity(currentPath.canonical) !== normalizedIdentity(item.canonicalPath)) {
      throw new PatchlineError("STALE_SNAPSHOT", `Create rollback target changed: ${item.relativePath}.`, {
        path: item.relativePath,
        retryable: true,
      })
    }
    const currentIdentity = await stat(currentPath.absolute, { bigint: true })
    if (currentIdentity.dev !== item.identity.device || currentIdentity.ino !== item.identity.inode) {
      throw new PatchlineError("STALE_SNAPSHOT", `Create rollback target was replaced: ${item.relativePath}.`, {
        path: item.relativePath,
        retryable: true,
      })
    }
    const current = await readFile(currentPath.absolute)
    if (digestBytes(current) !== digestBytes(item.bytes)) {
      throw new PatchlineError("STALE_SNAPSHOT", `Create rollback target changed: ${item.relativePath}.`, {
        path: item.relativePath,
        retryable: true,
      })
    }
    await rm(currentPath.absolute, { force: true })
    await cleanupParents(item.worktree, item.directories ?? [], item.authorizePath)
  }

  async write(request: WriteRequest, signal?: AbortSignal): Promise<{ path: string; created: boolean; bytesWritten: number; output: string }> {
    signal?.throwIfAborted()
    assertWriteSize(request.content, request.filePath)
    const resolved = await resolveWorkspacePath(request.worktree, request.filePath, request.authorizePath)
    if (resolved.exists && this.config.protectExistingWrites) {
      const allowed = matchesAllowedPath(resolved.relative, this.config.allowedFullReplacements)
      if (!allowed) {
        throw new PatchlineError(
          "WRITE_PROTECTED",
          `Existing source file cannot be rewritten: ${resolved.relative}. Read it and use snapshot-anchored edit.`,
          { path: resolved.relative },
        )
      }
    }
    if (this.config.protectGeneratedFiles && isGeneratedFile(resolved.relative, this.config.generatedPatterns)) {
      throw new PatchlineError("GENERATED_FILE", `Generated file must be updated by its canonical generator: ${resolved.relative}`, {
        path: resolved.relative,
      })
    }
    if (resolved.exists) {
      await withPathLocks([resolved.canonical], async () => {
        const targetIdentity = await readFileIdentity(resolved.absolute)
        const parentIdentity = await readFileIdentity(path.dirname(resolved.absolute))
        const expectedDigest = digestBytes(await readBoundedUtf8Bytes(resolved.absolute, resolved.relative, MAX_WRITE_CONTENT_BYTES))
        signal?.throwIfAborted()
        await this.replaceExistingFile(resolved.absolute, request.content, targetIdentity, parentIdentity, expectedDigest)
      }, signal)
    } else {
      const item: PreparedWrite = { ...request, absolutePath: resolved.absolute, canonicalPath: resolved.canonical, relativePath: resolved.relative, signal }
      let created: CreatedWrite | undefined
      try {
        await this.writeCreatedFile(item, (file) => { created = { ...item, ...file } })
        signal?.throwIfAborted()
      } catch (cause) {
        if (!created) { await cleanupParents(item.worktree, item.directories ?? [], item.authorizePath); throw cause }
        const restored: string[] = []
        const conflicts: string[] = []
        try {
          await this.removeCreatedFile(created)
          restored.push(item.relativePath)
        } catch {
          conflicts.push(item.relativePath)
        }
        throw new PatchlineError("TRANSACTION_FAILED", `Create failed; removed ${restored.length} of 1 partially created files.`, {
          path: item.relativePath, cause, writes: 1, details: { restored, conflicts, ...(signal?.aborted ? { cancelled: true } : {}) },
        })
      }
    }
    return {
      path: resolved.relative,
      created: !resolved.exists,
      bytesWritten: Buffer.byteLength(request.content, "utf8"),
      output: `${resolved.exists ? "Replaced" : "Created"}: ${resolved.relative}`,
    }
  }

  async createBatch(requests: readonly WriteRequest[], observer?: MutationObserver, signal?: AbortSignal): Promise<Array<{ path: string; created: true; output: string }>> {
    signal?.throwIfAborted()
    if (requests.length === 0) throw new PatchlineError("INVALID_ARGUMENT", "Create batch must contain at least one file.")
    if (requests.length > MAX_BATCH_ITEMS) throw new PatchlineError("INVALID_ARGUMENT", `Create batch must contain at most ${MAX_BATCH_ITEMS} files.`)
    const prepared: PreparedWrite[] = []
    const paths = new Set<string>()
    let totalBytes = 0
    for (const request of requests) {
      signal?.throwIfAborted()
      const bytes = Buffer.byteLength(request.content, "utf8")
      assertWriteSize(request.content, request.filePath)
      totalBytes += bytes
      if (totalBytes > MAX_WRITE_CONTENT_BYTES) {
        throw new PatchlineError("INVALID_ARGUMENT", "Create batch content exceeds the 8 MiB aggregate limit.")
      }
      const resolved = await resolveWorkspacePath(request.worktree, request.filePath, request.authorizePath)
      if (resolved.exists) {
        throw new PatchlineError("WRITE_PROTECTED", `Existing file cannot be created through apply_patch: ${resolved.relative}. Use snapshot-anchored edit.`, {
          path: resolved.relative,
        })
      }
      if (this.config.protectGeneratedFiles && isGeneratedFile(resolved.relative, this.config.generatedPatterns)) {
        throw new PatchlineError("GENERATED_FILE", `Generated file must be created by its canonical generator: ${resolved.relative}`, {
          path: resolved.relative,
        })
      }
      const canonicalIdentity = normalizedIdentity(resolved.canonical)
      if (paths.has(canonicalIdentity)) throw new PatchlineError("INVALID_ARGUMENT", `Create batch contains duplicate target: ${resolved.relative}`)
      paths.add(canonicalIdentity)
       prepared.push({ ...request, absolutePath: resolved.absolute, canonicalPath: resolved.canonical, relativePath: resolved.relative, signal })
    }
    const created = new Map<string, CreatedWrite>()
    reportMutationStage(observer, "committing")
    try {
      for (const item of prepared) {
        signal?.throwIfAborted()
        const track = (file: CreatedFile) => { created.set(item.relativePath, { ...item, ...file }) }
        const result = await this.writeCreatedFile(item, track)
        track(result)
        signal?.throwIfAborted()
      }
      return Array.from(created.values(), (item) => ({ path: item.relativePath, created: true, output: `Created: ${item.relativePath}` }))
    } catch (cause) {
      reportMutationStage(observer, "rollback")
      const conflicts: string[] = []
      const restored: string[] = []
      for (const item of Array.from(created.values()).reverse()) {
        try {
          await this.removeCreatedFile(item)
          restored.push(item.relativePath)
        } catch {
          conflicts.push(item.relativePath)
        }
      }
      for (const item of [...prepared].reverse()) await cleanupParents(item.worktree, item.directories ?? [], item.authorizePath)
      const conflictMessage = conflicts.length > 0 ? ` Preserved external changes in: ${conflicts.join(", ")}.` : ""
      throw new PatchlineError("TRANSACTION_FAILED", `Create batch failed; removed ${restored.length} of ${created.size} partially created files.${conflictMessage}`, {
        cause,
        writes: created.size,
        details: { restored, conflicts, ...(signal?.aborted ? { cancelled: true } : {}) },
      })
    }
  }
}
