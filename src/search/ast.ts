import path from "node:path"
import type { Lang } from "@ast-grep/napi"
import { PatchlineError } from "../errors.js"
import { decodeUtf8 } from "../preservation/text.js"
import { resolveWorkspacePath } from "../workspace/paths.js"
import { readBoundedUtf8Bytes } from "../io/bounded-file.js"

const languages: Record<string, keyof typeof Lang> = {
  css: "Css",
  html: "Html",
  js: "JavaScript",
  jsx: "JavaScript",
  ts: "TypeScript",
  tsx: "Tsx",
}

const MAX_AST_FILE_BYTES = 8 * 1024 * 1024
const MAX_MATCH_TEXT_CHARS = 2_000

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

export type AstTraversalNode = {
  children(): readonly AstTraversalNode[]
  matches(matcher: unknown): boolean
}

export function collectBoundedAstMatches<T extends AstTraversalNode>(
  root: T,
  matcher: unknown,
  maxResults: number,
  signal?: AbortSignal,
): { matches: T[]; truncated: boolean } {
  const matches: T[] = []
  const pending: AstTraversalNode[] = [root]
  let visited = 0
  while (pending.length > 0) {
    if (++visited > 100_000) throw new PatchlineError("INVALID_ARGUMENT", "AST traversal exceeds the 100,000-node budget; narrow the file or use LSP.")
    signal?.throwIfAborted()
    const node = pending.pop()!
    if (node.matches(matcher)) {
      if (matches.length === maxResults) return { matches, truncated: true }
      matches.push(node as T)
    }
    const children = node.children()
    if (pending.length + children.length > 100_000) throw new PatchlineError("INVALID_ARGUMENT", "AST pending nodes exceed the traversal memory budget.")
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!)
  }
  return { matches, truncated: false }
}

export async function astSearchFile(input: {
  worktree: string
  filePath: string
  pattern: string
  language?: string | undefined
  maxResults: number
  signal?: AbortSignal | undefined
  authorizePath?: ((path: string) => Promise<void>) | undefined
}): Promise<{ matches: AstMatch[]; truncated: boolean }> {
  input.signal?.throwIfAborted()
  if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 500) {
    throw new PatchlineError("INVALID_ARGUMENT", "Search result limit must be an integer between 1 and 500.")
  }
  const resolved = await resolveWorkspacePath(input.worktree, input.filePath, input.authorizePath)
  if (!resolved.exists) throw new PatchlineError("FILE_NOT_FOUND", `File not found: ${input.filePath}`, { path: input.filePath })
  const languageName = input.language?.toLowerCase() ?? path.extname(resolved.absolute).slice(1).toLowerCase()
  const languageKey = languages[languageName]
  if (!languageKey) {
    throw new PatchlineError("CAPABILITY_UNAVAILABLE", `AST language is not supported by the bundled parser: ${languageName}`)
  }
  try {
    const document = decodeUtf8(await readBoundedUtf8Bytes(resolved.absolute, resolved.relative, MAX_AST_FILE_BYTES), resolved.relative)
    input.signal?.throwIfAborted()
    const { Lang, parse, pattern: compilePattern } = await import("@ast-grep/napi")
    input.signal?.throwIfAborted()
    const language = Lang[languageKey]
    const root = parse(language, document.text)
    input.signal?.throwIfAborted()
    const matcher = compilePattern(language, input.pattern)
    const found = collectBoundedAstMatches(root.root(), matcher, input.maxResults, input.signal)
    return {
      matches: found.matches.map((node) => {
        const range = node.range()
        return {
          path: resolved.relative,
          startLine: range.start.line + 1,
          endLine: range.end.line + 1,
          text: matchPreview(node.text()),
        }
      }),
      truncated: found.truncated,
    }
  } catch (cause) {
    input.signal?.throwIfAborted()
    if (cause instanceof PatchlineError) throw cause
    throw new PatchlineError("INVALID_ARGUMENT", `AST pattern or source could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    })
  }
}
