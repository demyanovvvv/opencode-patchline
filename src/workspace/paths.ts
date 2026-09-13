import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { PatchlineError } from "../errors.js"

export type ResolvedPath = {
  absolute: string
  canonical: string
  workspace: string
  relative: string
  exists: boolean
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

export async function resolveWorkspacePath(worktree: string, inputPath: string): Promise<ResolvedPath> {
  if (!inputPath.trim()) throw new PatchlineError("INVALID_ARGUMENT", "Path must not be empty.")
  const absoluteWorkspace = path.resolve(worktree)
  const canonicalWorkspace = await realpath(absoluteWorkspace)
  const absolute = path.resolve(absoluteWorkspace, inputPath)
  if (!isInside(absoluteWorkspace, absolute)) {
    throw new PatchlineError("PATH_OUTSIDE_WORKSPACE", `Path is outside the worktree: ${inputPath}`, { path: inputPath })
  }
  const relative = path.relative(absoluteWorkspace, absolute)
  if (isGitInternalPath(absoluteWorkspace, absolute)) {
    throw new PatchlineError("GIT_INTERNAL_PATH", `Editing .git internals is not allowed: ${inputPath}`, { path: inputPath })
  }
  const pathExists = await exists(absolute)
  const canonical = pathExists ? await realpath(absolute) : await canonicalFuturePath(absolute)
  if (!isInside(canonicalWorkspace, canonical)) {
    throw new PatchlineError("SYMLINK_ESCAPE", `Path resolves outside the worktree: ${inputPath}`, { path: inputPath })
  }
  if (isGitInternalPath(canonicalWorkspace, canonical)) {
    throw new PatchlineError("GIT_INTERNAL_PATH", `Editing .git internals is not allowed: ${inputPath}`, { path: inputPath })
  }
  return { absolute, canonical, workspace: canonicalWorkspace, relative, exists: pathExists }
}

export function normalizedIdentity(filePath: string): string {
  return comparePath(filePath)
}
