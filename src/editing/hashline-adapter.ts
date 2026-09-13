import type { FileSnapshot } from "../snapshot/store.js"
import { PatchlineError } from "../errors.js"

type HashlineModule = {
  InMemoryFilesystem: new (initial?: Iterable<readonly [string, string]>) => {
    readText(path: string): Promise<string>
  }
  InMemorySnapshotStore: new () => {
    record(path: string, text: string, seenLines?: Iterable<number>): string
  }
  Patch: { parse(input: string): unknown }
  Patcher: new (options: { fs: unknown; snapshots: unknown; enforceSeenLines: boolean }) => {
    apply(patch: unknown): Promise<{ sections: Array<{ path: string; after: string; warnings: string[] }> }>
  }
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
      "The upstream Hashline runtime is unavailable. Use snapshot-anchored exact edit or run Patchline under OpenCode/Bun.",
      { cause },
    )
  }
}

export async function applyHashlineInMemory(snapshot: FileSnapshot, patchText: string): Promise<{ text: string; warnings: string[] }> {
  const hashline = await loadHashline()
  const fs = new hashline.InMemoryFilesystem([[snapshot.relativePath, snapshot.document.text]])
  const snapshots = new hashline.InMemorySnapshotStore()
  snapshots.record(snapshot.relativePath, snapshot.text, snapshot.seenLines)
  const patcher = new hashline.Patcher({ fs, snapshots, enforceSeenLines: true })
  try {
    const result = await patcher.apply(hashline.Patch.parse(patchText))
    if (result.sections.length !== 1 || result.sections[0]?.path !== snapshot.relativePath) {
      throw new PatchlineError("PATCH_PREFLIGHT_FAILED", "Hashline edit must target exactly the observed file.")
    }
    return { text: result.sections[0].after, warnings: result.sections[0].warnings }
  } catch (cause) {
    if (cause instanceof PatchlineError) throw cause
    throw new PatchlineError("PATCH_PREFLIGHT_FAILED", `Hashline preflight failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      path: snapshot.relativePath,
      snapshotId: snapshot.id,
      cause,
    })
  }
}
