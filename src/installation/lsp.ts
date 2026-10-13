import path from "node:path"
import { applyEdits, findNodeAtLocation, modify, parse, parseTree, type ParseError } from "jsonc-parser"
import { commitConfigurations, configurationFiles, type FileSnapshot } from "./files.js"

export type OwnedLsp = { file: string; value: { command: string[]; extensions: string[]; initialization?: Record<string, unknown> } }
const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]

export function removeOwnedLsp(source: string, owned: OwnedLsp): string {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : ""
  const text = source.slice(bom.length)
  const config = parse(text, [], { allowTrailingComma: true }) as Record<string, unknown>
  const lsp = config.lsp
  if (!lsp || typeof lsp !== "object" || JSON.stringify((lsp as Record<string, unknown>).typescript) !== JSON.stringify(owned.value)) return source
  const edited = applyEdits(text, modify(text, ["lsp", "typescript"], undefined, {}))
  const errors: ParseError[] = []
  parse(edited, errors, { allowTrailingComma: true })
  if (errors.length) throw new Error("Invalid LSP configuration edit.")
  return bom + edited
}

export async function configureLsp(options: { cwd: string; global?: boolean; configDirectory?: string }, previous: OwnedLsp | undefined, log: (file: string) => void): Promise<OwnedLsp | undefined> {
  const files = await configurationFiles(options)
  const candidate: FileSnapshot | undefined = files.find((file) => file.path.includes(`${path.sep}.opencode${path.sep}`) && /opencode\.jsonc?$/.test(file.path))
    ?? files.find((file) => /opencode\.jsonc?$/.test(file.path))
  if (!candidate) return previous
  const bom = candidate.source.startsWith("\uFEFF") ? "\uFEFF" : ""
  const text = candidate.source.slice(bom.length)
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { allowTrailingComma: true })
  if (errors.length || !tree || tree.type !== "object") throw new Error("Invalid OpenCode configuration.")
  const lsp = findNodeAtLocation(tree, ["lsp"])
  if (lsp && lsp.type !== "object") return previous
  if (findNodeAtLocation(tree, ["lsp", "typescript"])) return previous
  // OpenCode 1.19+ owns the TypeScript server lifecycle and resolves the
  // project TypeScript plus its tsserver initialization itself. A static
  // global override starts the server without that initialization and can
  // terminate with EPIPE on Windows. Keep the installer compatible with
  // older OpenCode releases by only writing the legacy override when the
  // caller explicitly supplies a project-local command.
  if (options.global) return previous
  const command = options.global
    ? ["typescript-language-server", "--stdio"]
    : [process.execPath, path.join(options.cwd, "node_modules", "typescript-language-server", "lib", "cli.mjs"), "--stdio"]
  const value = { command, extensions }
  const edited = applyEdits(text, modify(text, ["lsp", "typescript"], value, {
    formattingOptions: { tabSize: 2, insertSpaces: true, eol: text.includes("\r\n") ? "\r\n" : "\n" },
  }))
  await commitConfigurations([{ ...candidate, text: bom + edited }], log)
  return { file: candidate.path, value }
}
