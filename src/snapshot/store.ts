import { createHash } from "node:crypto"
import { xxh32 } from "@node-rs/xxhash"
import type { TextDocument } from "../preservation/text.js"
import { normalizedIdentity } from "../workspace/paths.js"

export type SnapshotScope = {
  sessionId: string
  worktree: string
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
  identity?: FileIdentity | undefined
  recordedAt: number
}

export type SnapshotStoreOptions = {
  ttlMs?: number
  maxSnapshots?: number
  now?: () => number
}

function hashlineTag(text: string): string {
  const normalized = text.replace(/[ \t\r]+(?=\n|$)/g, "")
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
  readonly #ttlMs: number
  readonly #maxSnapshots: number
  readonly #now: () => number

  constructor(options: SnapshotStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? 60 * 60 * 1_000
    this.#maxSnapshots = options.maxSnapshots ?? 512
    this.#now = options.now ?? Date.now
  }

  record(
    scope: SnapshotScope,
    canonicalPath: string,
    relativePath: string,
    document: TextDocument,
    seenLines: Iterable<number>,
    identity?: FileIdentity,
  ): FileSnapshot {
    this.cleanup()
    const tag = hashlineTag(document.normalizedText)
    const key = scopeKey(scope, canonicalPath, tag)
    const existing = this.#snapshots.get(key)
    const combined = new Set(existing?.seenLines ?? [])
    for (const line of seenLines) combined.add(line)
    const snapshot: FileSnapshot = {
      ...scope,
      id: `${tag}-${digestBytes(document.bytes).slice(0, 12)}`,
      tag,
      canonicalPath,
      relativePath,
      rawDigest: digestBytes(document.bytes),
      text: document.normalizedText,
      seenLines: combined,
      document,
      identity,
      recordedAt: this.#now(),
    }
    this.#snapshots.delete(key)
    this.#snapshots.set(key, snapshot)
    while (this.#snapshots.size > this.#maxSnapshots) {
      const oldest = this.#snapshots.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.#snapshots.delete(oldest)
    }
    return snapshot
  }

  get(scope: SnapshotScope, canonicalPath: string, idOrTag: string): FileSnapshot | undefined {
    this.cleanup()
    for (const [key, snapshot] of this.#snapshots) {
      if (
        snapshot.sessionId === scope.sessionId &&
        normalizedIdentity(snapshot.worktree) === normalizedIdentity(scope.worktree) &&
        normalizedIdentity(snapshot.canonicalPath) === normalizedIdentity(canonicalPath) &&
        (snapshot.id === idOrTag || snapshot.tag === idOrTag)
      ) {
        this.#snapshots.delete(key)
        this.#snapshots.set(key, snapshot)
        return snapshot
      }
    }
    return undefined
  }

  invalidate(canonicalPath: string, scope?: SnapshotScope): void {
    for (const [key, snapshot] of this.#snapshots) {
      if (
        normalizedIdentity(snapshot.canonicalPath) === normalizedIdentity(canonicalPath) &&
        (scope === undefined || (
          snapshot.sessionId === scope.sessionId &&
          normalizedIdentity(snapshot.worktree) === normalizedIdentity(scope.worktree)
        ))
      ) this.#snapshots.delete(key)
    }
  }

  clear(): void {
    this.#snapshots.clear()
  }

  cleanup(): number {
    const expiresBefore = this.#now() - this.#ttlMs
    let removed = 0
    for (const [key, snapshot] of this.#snapshots) {
      if (snapshot.recordedAt < expiresBefore) {
        this.#snapshots.delete(key)
        removed++
      }
    }
    return removed
  }

  get size(): number {
    return this.#snapshots.size
  }
}
