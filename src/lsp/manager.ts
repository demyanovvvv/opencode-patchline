import { createRequire } from "node:module"
import path from "node:path"
import { detectLspProjects, type LspProject } from "./projects.js"
import { LSP_SERVERS, type ServerRecipe } from "./registry.js"
import { findExecutable, runLspCommand } from "./process.js"
import { installNpmServer, lspStorageDirectory } from "./store.js"
import { verifyLspServer } from "./health.js"

export type LspEntry = { disabled?: boolean; command?: string[]; extensions?: string[]; initialization?: Record<string, unknown>; env?: Record<string, string> }
export type LspConfiguration = { lsp?: false | true | Record<string, LspEntry> }
export type LspReport = LspProject & { status: "disabled" | "custom" | "configured" | "native" | "missing" | "missing-toolchain" | "unsupported" | "failed"; verified: boolean; detail: string; command?: string[]; capabilities?: Record<string, unknown> }
export type LspEnvironment = {
  find(command: string, root: string): Promise<string[] | undefined>
  npm(packages: string[], recipe: ServerRecipe, signal?: AbortSignal): Promise<string[]>
  run(command: string[], args: string[], root: string, signal?: AbortSignal): Promise<void>
}
export type PrepareOptions = { environment?: LspEnvironment; install?: boolean; storage?: string; signal?: AbortSignal; configuration?: LspConfiguration; maxEntries?: number }

function environment(storage: string): LspEnvironment {
  return {
    async find(command, root) {
      const found = await findExecutable(command)
      if (!found) return undefined
      // rustup proxies may exist without an installed component.
      if (command === "rust-analyzer") {
        try { await runLspCommand(found, ["--version"], root, undefined, 10_000) } catch { return undefined }
      }
      return found
    },
    async npm(_packages, recipe, signal) { return installNpmServer(recipe, storage, signal) },
    async run(command, args, root, signal) { await runLspCommand(command, args, root, signal) },
  }
}

export async function prepareProjectLsp(worktree: string, options: PrepareOptions = {}): Promise<LspReport[]> {
  if (options.configuration?.lsp === false) return []
  const configurationContent = JSON.stringify(options.configuration?.lsp)
  const configurationChanged = () => JSON.stringify(options.configuration?.lsp) !== configurationContent
  const projects = await detectLspProjects(worktree, { ...(options.maxEntries ? { maxEntries: options.maxEntries } : {}), ...(options.signal ? { signal: options.signal } : {}) })
  if (configurationChanged()) return []
  const env = options.environment ?? environment(options.storage ?? lspStorageDirectory())
  const install = options.install !== false && process.env.OPENCODE_DISABLE_LSP_DOWNLOAD !== "true"
  const results: LspReport[] = []
  const prepared = new Map<string, Promise<string[]>>()
  for (const project of projects) {
    options.signal?.throwIfAborted()
    if (configurationChanged()) return []
    const recipe = LSP_SERVERS.find((s) => s.id === project.server)!
    const entry = typeof options.configuration?.lsp === "object" ? options.configuration.lsp[recipe.id] : undefined
    const report = (status: LspReport["status"], detail: string, command?: string[], verified = false, capabilities?: Record<string, unknown>): LspReport => ({ ...project, status, detail, verified, ...(command ? { command } : {}), ...(capabilities ? { capabilities } : {}) })
    if (entry?.disabled) { results.push(report("disabled", "Disabled in OpenCode configuration")); continue }
    const custom = typeof options.configuration?.lsp === "object" && Object.values(options.configuration.lsp).find((value) => !value.disabled && value.command && value.extensions?.includes(path.extname(project.sample)))
    if (entry?.command || custom) { results.push(report("custom", "Using user-defined OpenCode server")); continue }
    try {
      const existing = await env.find(recipe.binary, project.root)
      options.signal?.throwIfAborted()
      if (configurationChanged()) return []
      if (existing && recipe.id !== "julials" && recipe.id !== "r-languageserver") {
        const command = [...existing, ...recipe.args]
        try { const health = await verifyLspServer(command, project.root, { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: 15_000 }); results.push(report("configured", "Executable found and LSP initialize succeeded", command, health.verified, health.capabilities)) }
        catch { options.signal?.throwIfAborted(); results.push(report("configured", "Executable found; connection not yet verified", command)) }
        continue
      }
      if (recipe.id === "typescript") {
        const require = createRequire(path.join(project.root, "package.json"))
        let localTypescript = false
        try { require.resolve("typescript/lib/tsserver.js"); localTypescript = true } catch { /* managed fallback */ }
        if (localTypescript) { results.push(report("native", "Project TypeScript found; OpenCode prepares the language server on first file access")); continue }
      }
      if (recipe.runtime) {
        const runtime = await env.find(recipe.runtime, project.root)
        options.signal?.throwIfAborted()
        if (configurationChanged()) return []
        if (!runtime) { results.push(report("missing-toolchain", `${recipe.runtime} is required; install its toolchain to enable ${recipe.language}`)); continue }
      }
      if (recipe.id === "rust") {
        const rustup = await env.find("rustup", project.root)
        options.signal?.throwIfAborted()
        if (configurationChanged()) return []
        if (install && rustup) {
          await env.run(rustup, ["component", "add", "rust-analyzer"], project.root, options.signal)
          options.signal?.throwIfAborted()
          if (configurationChanged()) return []
          const analyzer = await env.find("rust-analyzer", project.root)
          options.signal?.throwIfAborted()
          if (configurationChanged()) return []
          if (!analyzer) throw new Error("rust-analyzer component installed but executable verification failed")
          const command = [...analyzer]
          if (path.isAbsolute(command[0]!)) {
            try { const health = await verifyLspServer(command, project.root, { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: 15_000 }); results.push(report("configured", "rust-analyzer installed and LSP initialize succeeded", command, health.verified, health.capabilities)) }
            catch { options.signal?.throwIfAborted(); results.push(report("configured", "rust-analyzer component installed; connection not yet verified", command)) }
          } else results.push(report("configured", "rust-analyzer component installed; connection not yet verified", command))
          continue
        }
        results.push(report("missing", "rust-analyzer unavailable; rustup component add rust-analyzer is required")); continue
      }
      if (recipe.npm && (recipe.id === "typescript" || !recipe.native || recipe.nativeInstall === false)) {
        if (!install) { results.push(report("missing", "Managed installation disabled; language server missing")); continue }
        let preparation = prepared.get(recipe.id)
        if (!preparation) { preparation = env.npm(recipe.npm.packages, recipe, options.signal); prepared.set(recipe.id, preparation) }
        const command = await preparation
        options.signal?.throwIfAborted()
        if (configurationChanged()) return []
        try { const health = await verifyLspServer(command, project.root, { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: 15_000 }); results.push(report("configured", "Installed and LSP initialize succeeded", command, health.verified, health.capabilities)) }
        catch { options.signal?.throwIfAborted(); results.push(report("configured", "Installed in managed storage; connection not yet verified", command)) }
        continue
      }
      if (recipe.native && recipe.nativeInstall !== false) { results.push(report(install ? "native" : "missing", install ? "OpenCode prepares this server on first file access; connection not yet verified" : "Server missing and downloads disabled")); continue }
      results.push(report("unsupported", `No automatic installation recipe for ${recipe.binary}; configure a custom server`))
    } catch (error) {
      options.signal?.throwIfAborted()
      results.push(report("failed", error instanceof Error ? error.message : String(error)))
    }
  }
  return configurationChanged() ? [] : results
}

export async function configureProjectLsp(worktree: string, configuration: LspConfiguration, options: Omit<PrepareOptions, "configuration"> = {}): Promise<LspReport[]> {
  if (configuration.lsp === false) return []
  const initial = configuration.lsp
  const initialContent = JSON.stringify(initial)
  const reports = await prepareProjectLsp(worktree, { ...options, configuration })
  options.signal?.throwIfAborted()
  if (configuration.lsp !== initial || JSON.stringify(configuration.lsp) !== initialContent) return []
  const servers = typeof configuration.lsp === "object" ? configuration.lsp : {}
  for (const report of reports) {
    if (!report.command || servers[report.server]?.disabled || servers[report.server]?.command) continue
    const recipe = LSP_SERVERS.find((s) => s.id === report.server)!
    // Native root selection and environment handling must remain owned by OpenCode.
    if (recipe.native && !recipe.npm && recipe.id !== "rust") continue
    servers[report.server] = { ...servers[report.server], command: report.command, extensions: recipe.extensions }
  }
  configuration.lsp = servers
  return reports
}
