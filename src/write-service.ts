import { mkdir, open, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"
import type { PatchlineConfig } from "./config.js"
import { PatchlineError } from "./errors.js"
import { isGeneratedFile, matchesAllowedPath } from "./guards/files.js"
import { atomicReplace, readFileIdentity } from "./writing/atomic.js"
import { normalizedIdentity, resolveWorkspacePath } from "./workspace/paths.js"
import { digestBytes, type FileIdentity } from "./snapshot/store.js"

export type WriteRequest = {
  worktree: string
  filePath: string
  content: string
}

export type PreparedWrite = WriteRequest & {
  absolutePath: string
  canonicalPath: string
  relativePath: string
}

type CreatedWrite = PreparedWrite & {
  bytes: Uint8Array
  identity: FileIdentity
}

type CreatedFile = {
  bytes: Uint8Array
  identity: FileIdentity
}

export class WriteService {
  constructor(private readonly config: PatchlineConfig) {}

  protected async replaceExistingFile(
    filePath: string,
    content: string,
    expectedTarget: FileIdentity,
    expectedParent: FileIdentity,
  ): Promise<void> {
    await atomicReplace(filePath, Buffer.from(content, "utf8"), { expectedParent, expectedTarget })
  }

  protected async writeCreatedFile(item: PreparedWrite): Promise<CreatedFile> {
    await mkdir(path.dirname(item.absolutePath), { recursive: true })
    const currentPath = await resolveWorkspacePath(item.worktree, item.filePath)
    if (currentPath.exists || normalizedIdentity(currentPath.canonical) !== normalizedIdentity(item.canonicalPath)) {
      throw new PatchlineError("STALE_SNAPSHOT", `Create target changed after preflight: ${item.relativePath}.`, {
        path: item.relativePath,
        retryable: true,
      })
    }
    const handle = await open(item.absolutePath, "wx+")
    try {
      await handle.writeFile(item.content, "utf8")
      const bytes = Buffer.alloc(Buffer.byteLength(item.content, "utf8"))
      let offset = 0
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (result.bytesRead === 0) throw new PatchlineError("TRANSACTION_FAILED", `Could not verify created file: ${item.relativePath}.`)
        offset += result.bytesRead
      }
      const identity = await handle.stat({ bigint: true })
      return { bytes, identity: { device: identity.dev, inode: identity.ino } }
    } finally {
      await handle.close()
    }
  }

  protected async removeCreatedFile(item: CreatedWrite): Promise<void> {
    const currentPath = await resolveWorkspacePath(item.worktree, item.filePath)
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
  }

  async write(request: WriteRequest): Promise<{ path: string; created: boolean; output: string }> {
    const resolved = await resolveWorkspacePath(request.worktree, request.filePath)
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
      const targetIdentity = await readFileIdentity(resolved.absolute)
      const parentIdentity = await readFileIdentity(path.dirname(resolved.absolute))
      await this.replaceExistingFile(resolved.absolute, request.content, targetIdentity, parentIdentity)
    } else {
      await this.writeCreatedFile({
        ...request,
        absolutePath: resolved.absolute,
        canonicalPath: resolved.canonical,
        relativePath: resolved.relative,
      })
    }
    return { path: resolved.relative, created: !resolved.exists, output: `${resolved.exists ? "Replaced" : "Created"}: ${resolved.relative}` }
  }

  async createBatch(requests: readonly WriteRequest[]): Promise<Array<{ path: string; created: true; output: string }>> {
    if (requests.length === 0) throw new PatchlineError("INVALID_ARGUMENT", "Create batch must contain at least one file.")
    const prepared: PreparedWrite[] = []
    const paths = new Set<string>()
    for (const request of requests) {
      const resolved = await resolveWorkspacePath(request.worktree, request.filePath)
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
       prepared.push({ ...request, absolutePath: resolved.absolute, canonicalPath: resolved.canonical, relativePath: resolved.relative })
    }
    const created: CreatedWrite[] = []
    try {
      for (const item of prepared) {
        const result = await this.writeCreatedFile(item)
        created.push({ ...item, ...result })
      }
      return created.map((item) => ({ path: item.relativePath, created: true, output: `Created: ${item.relativePath}` }))
    } catch (cause) {
      const conflicts: string[] = []
      const restored: string[] = []
      for (const item of created.reverse()) {
        try {
          await this.removeCreatedFile(item)
          restored.push(item.relativePath)
        } catch {
          conflicts.push(item.relativePath)
        }
      }
      const conflictMessage = conflicts.length > 0 ? ` Preserved external changes in: ${conflicts.join(", ")}.` : ""
      throw new PatchlineError("TRANSACTION_FAILED", `Create batch failed; removed ${restored.length} of ${created.length} partially created files.${conflictMessage}`, {
        cause,
        writes: restored.length,
        details: { restored, conflicts },
      })
    }
  }
}
