import { open } from "node:fs/promises"
import path from "node:path"
import { Lang, parse, pattern as compilePattern } from "@ast-grep/napi"
import { PatchlineError } from "../errors.js"
import { decodeUtf8 } from "../preservation/text.js"
import { resolveWorkspacePath } from "../workspace/paths.js"

const languages: Record<string, Lang> = {
  css: Lang.Css,
  html: Lang.Html,
  js: Lang.JavaScript,
  jsx: Lang.JavaScript,
  ts: Lang.TypeScript,
  tsx: Lang.Tsx,
}

const MAX_AST_FILE_BYTES = 8 * 1024 * 1024
const MAX_MATCH_TEXT_CHARS = 2_000

async function readAstSource(absolute: string, relative: string): Promise<Buffer> {
  const handle = await open(absolute, "r")
  try {
    const info = await handle.stat()
    if (info.size > MAX_AST_FILE_BYTES) {
      throw new PatchlineError("INVALID_ARGUMENT", `AST source exceeds the 8 MiB limit: ${relative}`, { path: relative })
    }
    const bytes = Buffer.allocUnsafe(MAX_AST_FILE_BYTES + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > MAX_AST_FILE_BYTES) {
      throw new PatchlineError("INVALID_ARGUMENT", `AST source exceeds the 8 MiB limit: ${relative}`, { path: relative })
    }
    return bytes.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

function matchPreview(text: string): string {
  const suffix = "... [node truncated]"
  return text.length <= MAX_MATCH_TEXT_CHARS ? text : `${text.slice(0, MAX_MATCH_TEXT_CHARS - suffix.length)}${suffix}`
}

export type AstMatch = {
  path: string
  startLine: number
  endLine: number
  text: string
}

export async function astSearchFile(input: {
  worktree: string
  filePath: string
  pattern: string
  language?: string | undefined
  maxResults: number
}): Promise<{ matches: AstMatch[]; truncated: boolean }> {
  if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 500) {
    throw new PatchlineError("INVALID_ARGUMENT", "Search result limit must be an integer between 1 and 500.")
  }
  const resolved = await resolveWorkspacePath(input.worktree, input.filePath)
  if (!resolved.exists) throw new PatchlineError("FILE_NOT_FOUND", `File not found: ${input.filePath}`, { path: input.filePath })
  const languageName = input.language?.toLowerCase() ?? path.extname(resolved.absolute).slice(1).toLowerCase()
  const language = languages[languageName]
  if (!language) {
    throw new PatchlineError("CAPABILITY_UNAVAILABLE", `AST language is not supported by the bundled parser: ${languageName}`)
  }
  try {
    const document = decodeUtf8(await readAstSource(resolved.absolute, resolved.relative), resolved.relative)
    const root = parse(language, document.text)
    const matcher = compilePattern(language, input.pattern)
    const found = root.root().findAll(matcher)
    const truncated = found.length > input.maxResults
    return {
      matches: found.slice(0, input.maxResults).map((node) => {
        const range = node.range()
        return {
          path: resolved.relative,
          startLine: range.start.line + 1,
          endLine: range.end.line + 1,
          text: matchPreview(node.text()),
        }
      }),
      truncated,
    }
  } catch (cause) {
    if (cause instanceof PatchlineError) throw cause
    throw new PatchlineError("INVALID_ARGUMENT", `AST pattern or source could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    })
  }
}
