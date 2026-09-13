import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { resolveWorkspacePath } from "../workspace/paths.js"
import { PatchlineError } from "../errors.js"
import { decodeUtf8 } from "../preservation/text.js"

export type GrepMatch = {
  path: string
  line: number
  text: string
}

export async function grepWorkspace(input: {
  worktree: string
  pattern: string
  path?: string | undefined
  include?: string | undefined
  maxResults: number
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  if (!input.pattern) throw new PatchlineError("INVALID_ARGUMENT", "Search pattern is required.")
  if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 500) {
    throw new PatchlineError("INVALID_ARGUMENT", "Search result limit must be an integer between 1 and 500.")
  }
  const root = await resolveWorkspacePath(input.worktree, input.path ?? ".")
  const matches: GrepMatch[] = []
  let truncated = false
  const include = input.include ? globExpression(input.include) : undefined
  const scanFile = async (absolute: string): Promise<void> => {
    if (truncated) return
    const name = path.basename(absolute)
    const relative = path.relative(root.workspace, absolute).replaceAll("\\", "/")
    if (include && !include.test(relative) && !include.test(name)) return
    let content: string
    try {
      const document = decodeUtf8(await readFile(absolute), relative)
      if (document.text.includes("\0")) return
      content = document.text
    } catch {
      return
    }
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]!.includes(input.pattern)) continue
      if (matches.length >= input.maxResults) {
        truncated = true
        return
      }
      matches.push({ path: absolute, line: index + 1, text: lines[index]! })
    }
  }
  const scan = async (entryPath: string): Promise<void> => {
    if (truncated) return
    const entries = await readdir(entryPath, { withFileTypes: true })
    for (const entry of entries) {
      if (truncated) return
      if (entry.name === ".git" || entry.name === "node_modules") continue
      const absolute = path.join(entryPath, entry.name)
      if (entry.isDirectory()) {
        await scan(absolute)
        continue
      }
      if (!entry.isFile()) continue
      await scanFile(absolute)
    }
  }
  const fileInfo = await stat(root.absolute).catch(() => undefined)
  if (!fileInfo) throw new PatchlineError("FILE_NOT_FOUND", `Search path not found: ${root.relative}`, { path: root.relative })
  if (fileInfo.isDirectory()) await scan(root.absolute)
  else if (fileInfo.isFile()) await scanFile(root.absolute)
  else throw new PatchlineError("INVALID_ARGUMENT", `Search path must be a file or directory: ${root.relative}`)
  return { matches, truncated }
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
