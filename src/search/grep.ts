import { opendir, stat } from "node:fs/promises"
import path from "node:path"
import { resolveWorkspacePath } from "../workspace/paths.js"
import { PatchlineError } from "../errors.js"
import { readBoundedUtf8Bytes } from "../io/bounded-file.js"
import { decodeUtf8 } from "../preservation/text.js"

export type GrepMatch = {
  path: string
  line: number
  text: string
}

const MAX_SEARCH_FILE_BYTES = 8 * 1024 * 1024
const MAX_MATCH_TEXT_CHARS = 2_000
const MAX_DIRECTORY_ENTRIES = 4_096

function matchPreview(line: string): string {
  const suffix = "... [line truncated]"
  return line.length <= MAX_MATCH_TEXT_CHARS ? line : `${line.slice(0, MAX_MATCH_TEXT_CHARS - suffix.length)}${suffix}`
}

export async function grepWorkspace(input: {
  worktree: string
  pattern: string
  path?: string | undefined
  include?: string | undefined
  maxResults: number
}): Promise<{ matches: GrepMatch[]; truncated: boolean; skipped: Array<{ path: string; reason: string }>; skippedCount: number }> {
  if (!input.pattern) throw new PatchlineError("INVALID_ARGUMENT", "Search pattern is required.")
  if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 500) {
    throw new PatchlineError("INVALID_ARGUMENT", "Search result limit must be an integer between 1 and 500.")
  }
  const root = await resolveWorkspacePath(input.worktree, input.path ?? ".")
  const matches: GrepMatch[] = []
  const skipped: Array<{ path: string; reason: string }> = []
  let skippedCount = 0
  let truncated = false
  const include = input.include ? globExpression(input.include) : undefined
  const scanFile = async (absolute: string): Promise<{ matches: GrepMatch[]; skipped?: { path: string; reason: string } }> => {
    const name = path.basename(absolute)
    const relative = path.relative(root.absolute, absolute).replaceAll("\\", "/")
    const displayPath = path.resolve(input.worktree, relative || input.path || ".")
    if (include && !include.test(relative) && !include.test(name)) return { matches: [] }
    try {
      const document = decodeUtf8(await readBoundedUtf8Bytes(absolute, relative, MAX_SEARCH_FILE_BYTES), relative)
      if (document.text.includes("\0")) return { matches: [] }
      const lines = document.text.split(/\r?\n/)
      const fileMatches: GrepMatch[] = []
      for (let index = 0; index < lines.length; index++) {
        if (lines[index]!.includes(input.pattern)) fileMatches.push({ path: displayPath, line: index + 1, text: matchPreview(lines[index]!) })
      }
      return { matches: fileMatches }
    } catch (error) {
      return { matches: [], skipped: { path: path.relative(input.worktree, displayPath).replaceAll("\\", "/"), reason: error instanceof PatchlineError ? error.code : "UNREADABLE" } }
    }
  }
  const files: string[] = []
  const collect = async (entryPath: string): Promise<void> => {
    const directory = await opendir(entryPath)
    const entries: { name: string; absolute: string; isDirectory: boolean; isFile: boolean }[] = []
    let entryCount = 0
    try {
      while (true) {
        const entry = await directory.read()
        if (entry === null) break
        entryCount++
        if (entryCount > MAX_DIRECTORY_ENTRIES) {
          throw new PatchlineError("INVALID_ARGUMENT", `Search directory exceeds the ${MAX_DIRECTORY_ENTRIES}-entry limit: ${path.relative(root.workspace, entryPath)}`, { path: path.relative(root.workspace, entryPath) })
        }
        if (entry.name === ".git" || entry.name === "node_modules") continue
        entries.push({ name: entry.name, absolute: path.join(entryPath, entry.name), isDirectory: entry.isDirectory(), isFile: entry.isFile() })
      }
    } finally {
      await directory.close()
    }
    entries.sort((left, right) => {
      const compare = (value: string): string => value.replace(/[^0-9A-Za-z]/g, " ").replace(/[0-9]/g, "1").replace(/[A-Za-z]/g, "2")
      const leftKey = compare(left.name)
      const rightKey = compare(right.name)
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    })
    for (const entry of entries) {
      if (entry.isDirectory) await collect(entry.absolute)
      else if (entry.isFile) files.push(entry.absolute)
    }
  }
  const sortKey = (value: string): string => Array.from(value).map((character) => {
    if (/[0-9]/.test(character)) return `1${character}`
    if (/[A-Za-z]/.test(character)) return `2${character}`
    return `0${character}`
  }).join("")
  const comparePaths = (left: string, right: string): number => {
    const leftKey = sortKey(path.relative(root.absolute, left).replaceAll("\\", "/"))
    const rightKey = sortKey(path.relative(root.absolute, right).replaceAll("\\", "/"))
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  }
  const fileInfo = await stat(root.absolute).catch(() => undefined)
  if (!fileInfo) throw new PatchlineError("FILE_NOT_FOUND", `Search path not found: ${root.relative}`, { path: root.relative })
  if (fileInfo.isDirectory()) await collect(root.absolute)
  else if (fileInfo.isFile()) files.push(root.absolute)
  else throw new PatchlineError("INVALID_ARGUMENT", `Search path must be a file or directory: ${root.relative}`)
  files.sort(comparePaths)
  const results = new Array<Awaited<ReturnType<typeof scanFile>>>(files.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= files.length) return
      results[index] = await scanFile(files[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, Math.max(1, files.length)) }, () => worker()))
  for (const result of results) {
    if (!result) continue
    if (result.skipped) {
      skippedCount++
      if (skipped.length < 30) skipped.push(result.skipped)
    }
    if (matches.length >= input.maxResults) {
      if (result.matches.length > 0) truncated = true
      continue
    }
    const remaining = input.maxResults - matches.length
    matches.push(...result.matches.slice(0, remaining))
    if (result.matches.length > remaining) truncated = true
  }
  return { matches, truncated, skipped, skippedCount }
}

function globExpression(glob: string): RegExp {
  const normalized = glob.replaceAll("\\", "/")
  let source = ""
  for (let index = 0; index < normalized.length;) {
    const character = normalized[index]
    if (character === "*" && normalized[index + 1] === "*") {
      index += 2
      if (normalized[index] === "/") {
        source += "(?:.*/)?"
        index++
      } else {
        source += ".*"
      }
      continue
    }
    if (character === "*") {
      source += "[^/]*"
      index++
      continue
    }
    source += character!.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    index++
  }
  return new RegExp(`^(?:${source})$`, process.platform === "win32" ? "i" : "")
}
