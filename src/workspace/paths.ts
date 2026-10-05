import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { PatchlineError } from "../errors.js"

export type ResolvedPath = {
  absolute: string
  canonical: string
  workspace: string
  relative: string
  exists: boolean
  symlink: boolean
}

function comparePath(value: string): string {
  const normalized = path.normalize(value)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(comparePath(root), comparePath(candidate))
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function isGitInternalPath(workspace: string, candidate: string): boolean {
  const relative = path.relative(comparePath(workspace), comparePath(candidate))
  return relative.split(/[\\/]+/).some((part) => part.toLowerCase() === ".git")
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function canonicalFuturePath(filePath: string): Promise<string> {
  let current = filePath
  const missing: string[] = []
  while (!(await exists(current))) {
    missing.push(path.basename(current))
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return path.join(await realpath(current), ...missing.reverse())
}

export async function resolveWorkspacePath(worktree: string, inputPath: string, authorizePath?: (path: string) => Promise<void>): Promise<ResolvedPath> {
  if (!inputPath.trim()) throw new PatchlineError("INVALID_ARGUMENT", "Path must not be empty.")
  const lexicalWorkspace = path.resolve(worktree)
  const canonicalWorkspace = await realpath(lexicalWorkspace)
  const lexical = path.resolve(lexicalWorkspace, inputPath)
  if (!isInside(lexicalWorkspace, lexical) && !path.isAbsolute(inputPath)) throw new PatchlineError("PATH_OUTSIDE_WORKSPACE", `External targets require an explicit absolute path: ${inputPath}`, { path: inputPath })
  if (!isInside(lexicalWorkspace, lexical) && !authorizePath) throw new PatchlineError("PATH_OUTSIDE_WORKSPACE", `Path is outside the worktree: ${inputPath}`, { path: inputPath })
  const lexicalRelative = path.relative(lexicalWorkspace, lexical)
  if (isGitInternalPath(lexicalWorkspace, lexical)) throw new PatchlineError("GIT_INTERNAL_PATH", `Editing .git internals is not allowed: ${inputPath}`, { path: inputPath })
  const pathExists = await exists(lexical)
  const lexicalInfo = pathExists ? await lstat(lexical) : undefined
  const canonical = pathExists ? await realpath(lexical) : await canonicalFuturePath(lexical)
  if (isInside(lexicalWorkspace, lexical) && !isInside(canonicalWorkspace, canonical)) throw new PatchlineError("SYMLINK_ESCAPE", `Workspace symlink resolves outside the worktree: ${inputPath}`, { path: inputPath })
  const external = !isInside(canonicalWorkspace, canonical) || !isInside(lexicalWorkspace, lexical)
  if (external && !authorizePath) throw new PatchlineError("SYMLINK_ESCAPE", `Path resolves outside the worktree: ${inputPath}`, { path: inputPath, details: { worktree: lexicalWorkspace, canonicalWorktree: canonicalWorkspace, canonicalPath: canonical } })
  if (isGitInternalPath(canonicalWorkspace, canonical)) throw new PatchlineError("GIT_INTERNAL_PATH", `Editing .git internals is not allowed: ${inputPath}`, { path: inputPath })
  if (external) await authorizePath!(canonical)
  return { absolute: canonical, canonical, workspace: canonicalWorkspace, relative: external ? canonical : path.relative(canonicalWorkspace, canonical) || lexicalRelative, exists: pathExists, symlink: lexicalInfo?.isSymbolicLink() === true }
}

export function normalizedIdentity(filePath: string): string {
  return comparePath(filePath)
}
