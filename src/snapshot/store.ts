import { createHash } from "node:crypto"
import { xxh32 } from "@node-rs/xxhash"
import { PatchlineError } from "../errors.js"
import type { TextDocument } from "../preservation/text.js"
import { buildLineIndex, type LineIndex } from "../preservation/line-index.js"
import { normalizedIdentity } from "../workspace/paths.js"

export type SnapshotScope = {
  sessionId: string
  worktree: string
  authorizePath?: ((path: string) => Promise<void>) | undefined
}

export type FileIdentity = {
  device: bigint
  inode: bigint
}

export type FileSnapshot = SnapshotScope & {
  id: string
  tag: string
  canonicalPath: string
  relativePath: string
  rawDigest: string
  text: string
  seenLines: ReadonlySet<number>
  document: TextDocument
  lineIndex: LineIndex
  identity?: FileIdentity | undefined
  recordedAt: number
}

export type SnapshotStoreOptions = {
  ttlMs?: number
  maxSnapshots?: number
  maxBytes?: number
  now?: () => number
}

function hashlineTag(text: string): string {
  const normalized = text.replace(/[^\n]+/g, (line) => {
    let end = line.length
    while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t" || line[end - 1] === "\r")) end--
    return line.slice(0, end)
  })
  return (xxh32(normalized, 0) & 0xffff).toString(16).padStart(4, "0").toUpperCase()
}

export function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function scopeKey(scope: SnapshotScope, canonicalPath: string, tag: string): string {
  return [scope.sessionId, normalizedIdentity(scope.worktree), normalizedIdentity(canonicalPath), tag].join("\0")
}

export class ScopedSnapshotStore {
  readonly #snapshots = new Map<string, FileSnapshot>()
  readonly #tags = new Map<string, Set<string>>()
  readonly #ids = new Map<string, Set<string>>()
  readonly #ttlMs: number
  readonly #maxSnapshots: number
  readonly #maxBytes: number
  readonly #documents = new Map<string, { document: TextDocument; lineIndex: LineIndex; refs: number; bytes: number }>()
  #bytes = 0
  readonly #now: () => number

  constructor(options: SnapshotStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? 60 * 60 * 1_000
    this.#maxSnapshots = options.maxSnapshots ?? 512
    this.#maxBytes = options.maxBytes ?? 128 * 1024 * 1024
    this.#now = options.now ?? Date.now
  }

  #remove(key: string): void {
    const snapshot = this.#snapshots.get(key)
    if (!snapshot) return
    this.#snapshots.delete(key)
    this.#bytes -= snapshot.seenLines.size * 32
    const pooled = this.#documents.get(snapshot.rawDigest)
    if (pooled && --pooled.refs === 0) {
      this.#bytes -= pooled.bytes
      this.#documents.delete(snapshot.rawDigest)
    }
    const tagKey = scopeKey(snapshot, snapshot.canonicalPath, snapshot.tag)
    const idKey = scopeKey(snapshot, snapshot.canonicalPath, snapshot.id)
    for (const [index, indexKey] of [[this.#tags, tagKey], [this.#ids, idKey]] as const) {
      const keys = index.get(indexKey)
      keys?.delete(key)
      if (keys?.size === 0) index.delete(indexKey)
    }
  }

  getOrBuildLineIndex(document: TextDocument): { index: LineIndex; reused: boolean; rawDigest: string } {
    const rawDigest = digestBytes(document.bytes)
    const pooled = this.#documents.get(rawDigest)
    if (pooled) return { index: pooled.lineIndex, reused: true, rawDigest }
    return { index: buildLineIndex(document.normalizedText), reused: false, rawDigest }
  }

  record(
    scope: SnapshotScope,
    canonicalPath: string,
    relativePath: string,
    document: TextDocument,
    seenLines: Iterable<number>,
    identity?: FileIdentity,
    lineIndex?: LineIndex,
    rawDigest = digestBytes(document.bytes),
  ): FileSnapshot {
    this.cleanup()
    const tag = hashlineTag(document.normalizedText)
    const key = `${scopeKey(scope, canonicalPath, tag)}\0${rawDigest}`
    let existing = this.#snapshots.get(key)
    if (existing && identity && existing.identity && (identity.device !== existing.identity.device || identity.inode !== existing.identity.inode)) {
      this.#remove(key)
      existing = undefined
    }
    let pooled = this.#documents.get(rawDigest)
    if (!pooled) {
      const pooledLineIndex = lineIndex ?? buildLineIndex(document.normalizedText)
      pooled = { document, lineIndex: pooledLineIndex, refs: 0, bytes: document.bytes.byteLength + 2 * document.text.length + (document.text === document.normalizedText ? 0 : 2 * document.normalizedText.length) + 8 * pooledLineIndex.starts.length }
      this.#documents.set(rawDigest, pooled)
      this.#bytes += pooled.bytes
    }
    if (!existing) pooled.refs++
    document = pooled.document
    const combined = new Set(existing?.seenLines ?? [])
    for (const line of seenLines) combined.add(line)
    this.#bytes += (combined.size - (existing?.seenLines.size ?? 0)) * 32
    const snapshot: FileSnapshot = {
      ...scope,
      id: `${tag}-${rawDigest.slice(0, 12)}`,
      tag,
      canonicalPath,
      relativePath,
      rawDigest,
      text: document.normalizedText,
      seenLines: combined,
      document,
      lineIndex: pooled.lineIndex,
      identity,
      recordedAt: this.#now(),
    }
    this.#snapshots.delete(key)
    this.#snapshots.set(key, snapshot)
    const tagKey = scopeKey(scope, canonicalPath, tag)
    const idKey = scopeKey(scope, canonicalPath, snapshot.id)
    if (!this.#tags.has(tagKey)) this.#tags.set(tagKey, new Set())
    if (!this.#ids.has(idKey)) this.#ids.set(idKey, new Set())
    this.#tags.get(tagKey)!.add(key)
    this.#ids.get(idKey)!.add(key)
    if ((pooled.bytes + combined.size * 32) > this.#maxBytes) {
      this.#remove(key)
      throw new PatchlineError("STANDARD_TOOL_REQUIRED", "Snapshot exceeds the memory budget; use the standard tool for this file.", { path: relativePath })
    }
    while (this.#snapshots.size > this.#maxSnapshots || this.#bytes > this.#maxBytes) {
      const oldest = this.#snapshots.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.#remove(oldest)
    }
    return snapshot
  }

  get(scope: SnapshotScope, canonicalPath: string, idOrTag: string): FileSnapshot | undefined {
    this.cleanup()
    const candidates = this.#ids.get(scopeKey(scope, canonicalPath, idOrTag))
      ?? this.#tags.get(scopeKey(scope, canonicalPath, idOrTag.toUpperCase()))
    if (!candidates?.size) return undefined
    if (candidates.size !== 1) {
      throw new PatchlineError("INVALID_ANCHOR", `Hashline tag ${idOrTag} is ambiguous for this file. Re-read and use the full snapshot ID.`, {
        snapshotId: idOrTag,
        retryable: true,
      })
    }
    const key = candidates.values().next().value!
    const snapshot = this.#snapshots.get(key)!
    this.#snapshots.delete(key)
    this.#snapshots.set(key, snapshot)
    return snapshot
  }

  invalidate(canonicalPath: string, scope?: SnapshotScope): void {
    for (const [key, snapshot] of this.#snapshots) {
      if (
        normalizedIdentity(snapshot.canonicalPath) === normalizedIdentity(canonicalPath) &&
        (scope === undefined || (
          snapshot.sessionId === scope.sessionId &&
          normalizedIdentity(snapshot.worktree) === normalizedIdentity(scope.worktree)
        ))
      ) this.#remove(key)
    }
  }

  clear(): void {
    this.#snapshots.clear()
    this.#tags.clear()
    this.#ids.clear()
    this.#documents.clear()
    this.#bytes = 0
  }

  cleanup(): number {
    const expiresBefore = this.#now() - this.#ttlMs
    let removed = 0
    for (const [key, snapshot] of this.#snapshots) {
      if (snapshot.recordedAt < expiresBefore) {
        this.#remove(key)
        removed++
      }
    }
    return removed
  }

  get size(): number {
    return this.#snapshots.size
  }

  get bytes(): number {
    return this.#bytes
  }
}
