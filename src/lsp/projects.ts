import { open, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { LSP_SERVERS } from "./registry.js"

export type LspProject = { root: string; server: string; language: string; sample: string; evidence: string[] }
const ignored = new Set([".git", "node_modules", "vendor", "target", "dist", "build", ".venv", "venv", "__pycache__", ".opencode", ".opencode-host", ".agents"])

export async function detectLspProjects(worktree: string, options: { maxEntries?: number; signal?: AbortSignal } = {}): Promise<LspProject[]> {
  const root = await realpath(worktree)
  const directories = new Map<string, Set<string>>()
  const files: string[] = []
  let count = 0
  async function walk(directory: string): Promise<void> {
    options.signal?.throwIfAborted()
    const entries = await readdir(directory, { withFileTypes: true })
    directories.set(directory, new Set(entries.filter((e) => e.isFile()).map((e) => e.name)))
    for (const entry of entries) {
      if (++count > (options.maxEntries ?? 30_000)) throw new Error("LSP project scan limit reached; narrow the project directory.")
      if (entry.isSymbolicLink()) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory() && !ignored.has(entry.name) && !entry.name.startsWith(".")) await walk(file)
      else if (entry.isFile()) files.push(file)
    }
  }
  await walk(root)
  function nearest(file: string, markers: readonly string[]): string | undefined {
    let directory = path.dirname(file)
    while (true) {
      if (markers.some((marker) => directories.get(directory)?.has(marker))) return directory
      if (directory === root) return undefined
      directory = path.dirname(directory)
    }
  }
  const projects = new Map<string, LspProject>()
  const manifestServers: Record<string, string> = { "Cargo.toml": "rust", "go.mod": "gopls", "go.work": "gopls", "pyproject.toml": "pyright", "pyrightconfig.json": "pyright", "tsconfig.json": "typescript", "jsconfig.json": "typescript", "deno.json": "deno", "deno.jsonc": "deno", "pubspec.yaml": "dart", "mix.exs": "elixir-ls", "build.zig": "zls", "Package.swift": "sourcekit-lsp", "composer.json": "php intelephense", "Gemfile": "ruby-lsp", "dune-project": "ocaml-lsp", "deps.edn": "clojure-lsp", "gleam.toml": "gleam", "Project.toml": "julials" }
  for (const file of files.sort()) {
    options.signal?.throwIfAborted()
    const extension = path.extname(file)
    let recipes = LSP_SERVERS.filter((s) => s.extensions.includes(extension))
    if (path.basename(file) === "Dockerfile") recipes = LSP_SERVERS.filter((s) => s.id === "dockerfile")
    const manifestServer = manifestServers[path.basename(file)]
    if (manifestServer && !recipes.some((s) => s.id === manifestServer)) recipes = [...recipes, ...LSP_SERVERS.filter((s) => s.id === manifestServer)]
    if (!extension && recipes.length === 0) {
      const handle = await open(file, "r")
      let prefix: string
      try { const buffer = Buffer.alloc(256); const { bytesRead } = await handle.read(buffer, 0, 256, 0); prefix = buffer.subarray(0, bytesRead).toString("utf8") } finally { await handle.close() }
      const language = /^#![^\r\n]*\b(?:bash|sh|zsh|ksh)\b/.test(prefix) ? "bash" : /^#![^\r\n]*\bpython[\d.]*\b/.test(prefix) ? "pyright" : undefined
      recipes = LSP_SERVERS.filter((s) => s.id === language)
    }
    const denoRoot = nearest(file, ["deno.json", "deno.jsonc"])
    recipes = recipes.filter((s) => s.id !== (denoRoot ? "typescript" : "deno"))
    for (const recipe of recipes) {
      const projectRoot = nearest(file, recipe.markers) ?? (recipe.id === "terraform" ? path.dirname(file) : root)
      const key = `${projectRoot}\0${recipe.id}`
      if (!projects.has(key)) projects.set(key, { root: projectRoot, server: recipe.id, language: recipe.language, sample: file, evidence: [path.basename(file), ...recipe.markers.filter((m) => directories.get(projectRoot)?.has(m))] })
    }
  }
  return [...projects.values()].sort((a, b) => a.root.localeCompare(b.root) || a.server.localeCompare(b.server))
}
