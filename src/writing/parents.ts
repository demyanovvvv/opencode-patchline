import { mkdir, rmdir } from "node:fs/promises"
import path from "node:path"
import { PatchlineError } from "../errors.js"
import type { FileIdentity } from "../snapshot/store.js"
import { normalizedIdentity, resolveWorkspacePath } from "../workspace/paths.js"
import { readFileIdentity } from "./atomic.js"

export type CreatedDirectory = { absolute: string; identity: FileIdentity }

export async function cleanupParents(worktree: string, directories: readonly CreatedDirectory[]): Promise<void> {
  for (const directory of [...directories].reverse()) {
    try {
      const current = await resolveWorkspacePath(worktree, directory.absolute)
      const identity = await readFileIdentity(current.absolute)
      if (identity.device !== directory.identity.device || identity.inode !== directory.identity.inode) continue
      await rmdir(current.absolute)
    } catch {
      // Only remove verified empty directories; preserve replacements and contents.
    }
  }
}

export async function ensureParents(worktree: string, filePath: string, signal?: AbortSignal): Promise<CreatedDirectory[]> {
  const target = await resolveWorkspacePath(worktree, filePath)
  const directories: CreatedDirectory[] = []
  const relative = path.relative(target.workspace, path.dirname(target.absolute))
  let parent = target.workspace
  try {
    for (const part of relative.split(path.sep).filter(Boolean)) {
      signal?.throwIfAborted()
      const expectedParent = await readFileIdentity(parent)
      const next = await resolveWorkspacePath(worktree, path.join(parent, part))
      if (!next.exists) {
        const actual = await readFileIdentity(parent)
        if (actual.device !== expectedParent.device || actual.inode !== expectedParent.inode) throw new PatchlineError("STALE_SNAPSHOT", "Create parent changed.")
        let created = false
        try { await mkdir(next.absolute); created = true } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause
        }
        const checked = await resolveWorkspacePath(worktree, next.absolute)
        if (normalizedIdentity(checked.canonical) !== normalizedIdentity(next.canonical)) throw new PatchlineError("STALE_SNAPSHOT", "Created parent changed.")
        if (created) directories.push({ absolute: checked.absolute, identity: await readFileIdentity(checked.absolute) })
      }
      parent = next.absolute
    }
    return directories
  } catch (cause) {
    await cleanupParents(worktree, directories)
    throw cause
  }
}