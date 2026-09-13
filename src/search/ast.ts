import { readFile } from "node:fs/promises"
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
    const document = decodeUtf8(await readFile(resolved.absolute), resolved.relative)
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
          text: node.text(),
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
