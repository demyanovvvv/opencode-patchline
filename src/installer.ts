import { createInterface } from "node:readline/promises"
import path from "node:path"
import { access, mkdir, realpath, readFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { applyEdits, createScanner, findNodeAtLocation, modify, parse, parseTree, type ParseError } from "jsonc-parser"
import { executeCommand, type CommandResult } from "./installation/process.js"
import { assertCurrent, backup, commitConfigurations, configurationFiles, globalConfigDirectory, installHostBinary, projectDirectory, readSnapshot, removeState, saveState, type FileChange, type FileSnapshot } from "./installation/files.js"
import { configureLsp, removeOwnedLsp, type OwnedLsp } from "./installation/lsp.js"

// jsonc-parser declares SyntaxKind as an ambient const enum, incompatible with verbatimModuleSyntax.
const COMMA_TOKEN = 5

export type InstallerLanguage = "en" | "ru"

type Output = (line: string) => void
type RunCommand = (command: string, args: readonly string[]) => Promise<number>
type HasCommand = (command: string) => Promise<boolean>
type Confirm = (message: string) => Promise<boolean>
type CaptureCommand = (command: string, args: readonly string[]) => Promise<CommandResult>
type InstalledPackageSet = { packages: readonly string[]; global: boolean }
type PackageFileSnapshot = { path: string; source: string | undefined }

export function patchHostToolSelection(source: string): string {
  const patchFilter = "if (tool.id === ApplyPatchTool.id) return usePatch"
  const editFilter = "if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch"
  const patchedPatch = "if (tool.id === ApplyPatchTool.id) return true"
  const patchedEdit = "if (tool.id === EditTool.id || tool.id === WriteTool.id) return true"
  if (source.includes(patchedPatch) && source.includes(patchedEdit)) return source
  if (!source.includes(patchFilter) || !source.includes(editFilter)) throw new Error("Unsupported OpenCode tool selection; host not changed.")
  return source.replace(patchFilter, patchedPatch).replace(editFilter, patchedEdit)
}
export type InstallerOptions = {
  cwd?: string
  global?: boolean
  language?: InstallerLanguage
  configDirectory?: string
  stateDirectory?: string
  stateFile?: string
  packageName?: string
  opencodeVersion?: string
  yes?: boolean
  dryRun?: boolean
  stdout?: Output
  stderr?: Output
  confirm?: Confirm
  hasCommand?: HasCommand
  runCommand?: RunCommand
  captureCommand?: CaptureCommand
}

type InstallerState = {
  language?: InstallerLanguage
  scope?: "global" | "project"
  lspPackages?: string[]
  addonPackages?: string[]
  packageName?: string
  lspConfig?: OwnedLsp
}

const LSP_PACKAGES = ["typescript", "typescript-language-server"] as const
const ADDON_PACKAGES = ["bun"] as const
const PATCHLINE_PACKAGE = "opencode-patchline"

const messages = {
  en: {
    starting: (name: string) => `Installing ${name}`,
    scope: (scope: string) => `Scope: ${scope}`,
    registering: "Registering the Patchline server and TUI plugin with OpenCode.",
    registered: "Patchline was registered with OpenCode.",
    lspMissing: "TypeScript Language Server is not available.",
    lspPrompt: "Install TypeScript and typescript-language-server?",
    lspDeclined: "LSP dependencies were not installed.",
    lspInstalled: "LSP dependencies installed.",
    lspFailed: (code: number) => `LSP dependency installation failed with exit code ${code}.`,
    runtimeMissing: "Bun is not available for the full native Hashline runtime.",
    runtimePrompt: "Install Bun for the full native Hashline runtime?",
    runtimeDeclined: "Bun was not installed; Patchline will use the supported fallback where needed.",
    runtimeInstalled: "Bun runtime installed.",
    runtimeFailed: (code: number) => `Bun installation failed with exit code ${code}.`,
    complete: "Installation complete. Restart OpenCode to load the changes.",
    noConfig: "No OpenCode configuration containing Patchline was found.",
    removing: "Removing Patchline entries from OpenCode configuration.",
    dryRun: "Would remove",
    removed: (count: number) => `Removed ${count} Patchline configuration entr${count === 1 ? "y" : "ies"}.`,
    dependenciesRemoved: "Owned LSP dependencies removed.",
    addonsRemoved: "Owned runtime add-ons removed.",
    noDependencies: "No installer-owned dependencies or runtime add-ons were found.",
    completeUninstall: "Uninstallation complete. Restart OpenCode to apply the changes.",
    backup: (file: string) => `Backup created: ${file}`,
    error: (reason: string) => `Installer error: ${reason}`,
    nonInteractive: "Confirmation is required to install missing dependencies; rerun in an interactive terminal or pass --yes.",
  },
  ru: {
    starting: (name: string) => `Установка ${name}`,
    scope: (scope: string) => `Область: ${scope === "global" ? "глобальная" : "проект"}`,
    registering: "Регистрация серверного и TUI-плагина Patchline в OpenCode.",
    registered: "Patchline зарегистрирован в OpenCode.",
    lspMissing: "TypeScript Language Server не найден.",
    lspPrompt: "Установить TypeScript и typescript-language-server?",
    lspDeclined: "Зависимости LSP не установлены.",
    lspInstalled: "Зависимости LSP установлены.",
    lspFailed: (code: number) => `Установка зависимостей LSP завершилась с кодом ${code}.`,
    runtimeMissing: "Bun не найден; без него недоступен полный native Hashline runtime.",
    runtimePrompt: "Установить Bun для полного native Hashline runtime?",
    runtimeDeclined: "Bun не установлен; Patchline продолжит использовать поддерживаемый fallback, где это необходимо.",
    runtimeInstalled: "Среда Bun установлена.",
    runtimeFailed: (code: number) => `Установка Bun завершилась с кодом ${code}.`,
    complete: "Установка завершена. Перезапустите OpenCode для применения изменений.",
    noConfig: "Конфигурация OpenCode с Patchline не найдена.",
    removing: "Удаление записей Patchline из конфигурации OpenCode.",
    dryRun: "Будет удалено",
    removed: (count: number) => `Удалено записей конфигурации Patchline: ${count}.`,
    dependenciesRemoved: "Зависимости LSP, установленные Patchline, удалены.",
    addonsRemoved: "Дополнения среды, установленные Patchline, удалены.",
    noDependencies: "Зависимости и дополнения, установленные Patchline, не найдены.",
    completeUninstall: "Удаление завершено. Перезапустите OpenCode для применения изменений.",
    backup: (file: string) => `Создана резервная копия: ${file}`,
    error: (reason: string) => `Ошибка установщика: ${reason}`,
    nonInteractive: "Для установки недостающих зависимостей требуется подтверждение; запустите команду в интерактивном терминале или передайте --yes.",
  },
} as const

function output(options: InstallerOptions, line: string): void {
  ;(options.stdout ?? console.log)(line)
}

function errorOutput(options: InstallerOptions, line: string): void {
  ;(options.stderr ?? console.error)(line)
}

function languageOf(options: InstallerOptions, state?: InstallerState): InstallerLanguage {
  return options.language ?? state?.language ?? "en"
}

function scopeOf(options: InstallerOptions): "global" | "project" {
  return options.global === true ? "global" : "project"
}

function configDirectoryOf(options: InstallerOptions): string {
  return options.configDirectory ?? (options.global ? globalConfigDirectory() : options.cwd ?? process.cwd())
}

function stateFileOf(options: InstallerOptions): string {
  return options.stateFile ?? path.join(options.stateDirectory ?? configDirectoryOf(options), ".opencode-patchline-state.json")
}

async function readState(filePath: string): Promise<InstallerState> {
  const snapshot = await readSnapshot(filePath)
  if (!snapshot) return {}
  const value: unknown = JSON.parse(snapshot.source)
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid installer state.")
  const state = value as Record<string, unknown>
  if (state.schemaVersion !== undefined && state.schemaVersion !== 1) throw new Error("Unsupported installer state version.")
  if (state.lspPackages !== undefined && (!Array.isArray(state.lspPackages) || state.lspPackages.some((item) => !LSP_PACKAGES.includes(item)))) throw new Error("Invalid installer dependency ownership.")
  if (state.addonPackages !== undefined && (!Array.isArray(state.addonPackages) || state.addonPackages.some((item) => !ADDON_PACKAGES.includes(item)))) throw new Error("Invalid installer add-on ownership.")
  const result: InstallerState = {}
  if (state.language === "ru" || state.language === "en") result.language = state.language
  if (state.scope === "global" || state.scope === "project") result.scope = state.scope
  if (Array.isArray(state.lspPackages)) result.lspPackages = state.lspPackages as string[]
  if (Array.isArray(state.addonPackages)) result.addonPackages = state.addonPackages as string[]
  if (typeof state.packageName === "string") result.packageName = state.packageName
  if (state.lspConfig && typeof state.lspConfig === "object") {
    const config = state.lspConfig as Partial<OwnedLsp>
    if (typeof config.file !== "string" || !config.value || !Array.isArray(config.value.command) || !Array.isArray(config.value.extensions)) throw new Error("Invalid LSP ownership state.")
    result.lspConfig = config as OwnedLsp
  }
  return result
}

async function capture(options: InstallerOptions, command: string, args: readonly string[]): Promise<CommandResult> {
  return await (options.captureCommand ?? ((name, values) => executeCommand(name, values, options.cwd ?? process.cwd())))(command, args)
}

async function run(options: InstallerOptions, command: string, args: readonly string[]): Promise<number> {
  return await (options.runCommand ?? (async (name, values) => (await executeCommand(name, values, options.cwd ?? process.cwd(), true)).code))(command, args)
}

async function commandAvailable(options: InstallerOptions, command: string): Promise<boolean> {
  if (options.hasCommand) return options.hasCommand(command)
  try {
    if (command === "typescript-language-server" && !options.global) {
      const cli = path.join(options.cwd ?? process.cwd(), "node_modules", command, "lib", "cli.mjs")
      if (await readSnapshot(cli)) return true
    }
    return (await capture(options, command, ["--version"])).code === 0
  } catch { return false }
}

async function presentPackages(options: InstallerOptions): Promise<Set<string>> {
  if (options.global) {
    if (options.runCommand && !options.captureCommand) return new Set()
    const result = await capture(options, "npm", ["ls", "--global", "--depth=0", "--json"])
    const list = JSON.parse(result.output) as { dependencies?: Record<string, unknown> }
    return new Set(Object.keys(list.dependencies ?? {}))
  }
  const snapshot = await readSnapshot(path.join(options.cwd ?? process.cwd(), "package.json"))
  if (!snapshot) return new Set()
  const manifest = JSON.parse(snapshot.source) as Record<string, unknown>
  const packages = new Set<string>()
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = manifest[field]
    if (dependencies && typeof dependencies === "object" && !Array.isArray(dependencies)) for (const name of Object.keys(dependencies)) packages.add(name)
  }
  return packages
}

async function confirmPrompt(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await readline.question(`${message} [y/N] `)
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    readline.close()
  }
}

function isPatchlineValue(value: unknown, packageName: string): boolean {
  const specifier = Array.isArray(value) ? value[0] : value
  return typeof specifier === "string" && (specifier === packageName || /^opencode-patchline(?:@[^/]+)?(?:\/(?:plugin|server|tui))?$/.test(specifier) || /(?:^|[\\/])opencode-patchline(?:[\\/](?:dist[\\/])?(?:plugin|server|tui)(?:\.js)?)?[\\/]*$/.test(specifier))
}

export function removePatchlineEntries(source: string, packageName = PATCHLINE_PACKAGE): { text: string; removed: number } {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : ""
  const text = source.slice(bom.length)
  const errors: ParseError[] = []
  const config: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid OpenCode JSON/JSONC configuration.")
  const plugin = (config as Record<string, unknown>).plugin
  if (plugin === undefined) return { text: source, removed: 0 }
  if (!Array.isArray(plugin)) throw new Error("OpenCode plugin must be an array.")
  const tree = parseTree(text, [], { allowTrailingComma: true })
  const pluginNode = tree ? findNodeAtLocation(tree, ["plugin"]) : undefined
  if (!pluginNode || pluginNode.type !== "array" || !pluginNode.children) return { text: source, removed: 0 }
  const removals = pluginNode.children.filter((node) => {
    const value = parse(text.slice(node.offset, node.offset + node.length), [], { allowTrailingComma: true })
    return isPatchlineValue(value, packageName)
  })
  let result = text
  for (let index = pluginNode.children.length - 1; index >= 0; index -= 1) {
    if (!removals.includes(pluginNode.children[index]!)) continue
    const currentTree = parseTree(result, [], { allowTrailingComma: true })!
    const children = findNodeAtLocation(currentTree, ["plugin"])!.children!
    const node = children[index]!
    const edits = [{ offset: node.offset, length: node.length, content: "" }]
    const scanner = createScanner(result, true)
    scanner.setPosition(node.offset + node.length)
    if (scanner.scan() === COMMA_TOKEN) {
      edits.push({ offset: scanner.getTokenOffset(), length: scanner.getTokenLength(), content: "" })
    } else if (index > 0) {
      const previous = children[index - 1]!
      scanner.setPosition(previous.offset + previous.length)
      if (scanner.scan() !== COMMA_TOKEN) throw new Error("Invalid plugin separator.")
      edits.push({ offset: scanner.getTokenOffset(), length: scanner.getTokenLength(), content: "" })
    }
    result = applyEdits(result, edits)
  }
  return { text: bom + result, removed: removals.length }
}

async function normalizeOptions(options: InstallerOptions): Promise<InstallerOptions & { cwd: string }> {
  const cwd = await realpath(options.cwd ?? process.cwd())
  return { ...options, cwd: options.global ? cwd : await projectDirectory(cwd) }
}

async function saveInstallationState(options: InstallerOptions, language: InstallerLanguage, lspPackages: string[], addonPackages: string[], lspConfig?: OwnedLsp): Promise<void> {
  await saveState(stateFileOf(options), { schemaVersion: 1, language, scope: scopeOf(options), lspPackages, addonPackages, packageName: options.packageName ?? PATCHLINE_PACKAGE, ...(lspConfig ? { lspConfig } : {}) })
}

async function rollbackPluginRegistration(options: InstallerOptions, previousConfigs: Awaited<ReturnType<typeof configurationFiles>>, packageName: string, log: Output, addedLsp?: OwnedLsp): Promise<void> {
  const currentFiles = await configurationFiles({ cwd: options.cwd!, ...(options.configDirectory ? { configDirectory: options.configDirectory } : {}), ...(options.global !== undefined ? { global: options.global } : {}) })
  const previousPaths = new Set(previousConfigs.map((file) => file.path))
  const restore = []
  for (const previous of previousConfigs) {
    const current = currentFiles.find((file) => file.path === previous.path)
    if (!current || current.source === previous.source) continue
    const removedPlugin = removePatchlineEntries(current.source, packageName).text
    const stripped = addedLsp ? removeOwnedLsp(removedPlugin, addedLsp) : removedPlugin
    const previousStripped = removePatchlineEntries(previous.source, packageName).text
    const before = parse(previousStripped.replace(/^\uFEFF/, ""), [], { allowTrailingComma: true })
    const after = parse(stripped.replace(/^\uFEFF/, ""), [], { allowTrailingComma: true })
    if (JSON.stringify(before) === JSON.stringify(after)) restore.push({ ...current, text: previous.source })
  }
  await commitConfigurations(restore, log)
  for (const current of currentFiles) {
    if (previousPaths.has(current.path)) continue
    const removedPlugin = removePatchlineEntries(current.source, packageName).text
    const removed = addedLsp ? removeOwnedLsp(removedPlugin, addedLsp) : removedPlugin
    if (removed !== current.source) {
      const remaining = parse(removed.replace(/^\uFEFF/, ""), [], { allowTrailingComma: true })
      if (Array.isArray(remaining?.plugin) && remaining.plugin.length === 0 && Object.keys(remaining).every((key) => key === "plugin")) {
        await assertCurrent(current)
        await rm(current.path)
      } else {
        await commitConfigurations([{ ...current, text: removed }], log)
      }
    }
  }
}

async function rollbackInstalledPackages(sets: readonly InstalledPackageSet[], runCommand: RunCommand, log: Output): Promise<void> {
  for (const set of sets) {
    if (set.packages.length === 0) continue
    const args = ["uninstall", ...(set.global ? ["--global"] : ["--save-dev"]), ...set.packages]
    const code = await runCommand("npm", args)
    if (code !== 0) { log(`Rollback warning: npm uninstall exited with code ${code}.`); throw new Error(`Dependency cleanup failed with exit code ${code}.`) }
  }
}

async function capturePackageFiles(options: InstallerOptions): Promise<PackageFileSnapshot[]> {
  if (options.global) return []
  const directory = options.cwd ?? process.cwd()
  const names = ["package.json", "package-lock.json", "npm-shrinkwrap.json"]
  return await Promise.all(names.map(async (name) => {
    const pathName = path.join(directory, name)
    const file = await readSnapshot(pathName)
    return { path: pathName, source: file?.source }
  }))
}

async function rollbackPackageFiles(snapshots: readonly PackageFileSnapshot[], expected: readonly FileSnapshot[], log: Output): Promise<void> {
  const restores: FileChange[] = []
  for (const snapshot of snapshots) {
    const current = await readSnapshot(snapshot.path)
    if (current?.source === snapshot.source) continue
    const owned = expected.find((item) => item.path === snapshot.path)
    if (!owned) throw new Error(`Rollback conflict: package file ownership is unknown: ${snapshot.path}`)
    await assertCurrent(owned)
    if (snapshot.source === undefined) await rm(owned.path)
    else restores.push({ ...owned, text: snapshot.source })
  }
  if (restores.length) await commitConfigurations(restores, log)
}

async function performInstall(rawOptions: InstallerOptions = {}): Promise<number> {
  const options = await normalizeOptions(rawOptions)
  const state = await readState(stateFileOf(options))
  const language = languageOf(options, state)
  const text = messages[language]
  const scope = scopeOf(options)
  const packageName = options.packageName ?? PATCHLINE_PACKAGE
  const runCommand = (command: string, args: readonly string[]) => run(options, command, args)
  const hasCommand = (command: string) => commandAvailable(options, command)

  output(options, text.starting(packageName))
  output(options, text.scope(scope))
  let rollbackVisualHost: (() => Promise<void>) | undefined
  if (!options.runCommand) rollbackVisualHost = await ensureVisualHost(options)
  if (!options.runCommand || options.captureCommand) {
    const version = await capture(options, "opencode", ["--version"])
    if (version.code !== 0 || !/^1\.(?:18|19|[2-9]\d|\d{3,})\./.test(version.output)) {
      throw new Error(language === "ru" ? "Требуется OpenCode >=1.18.0 и <2. Установите совместимую версию OpenCode." : "OpenCode >=1.18.0 and <2 is required. Install a compatible OpenCode version.")
    }
  }
  const previousConfigs = await configurationFiles({ cwd: options.cwd!, ...(options.configDirectory ? { configDirectory: options.configDirectory } : {}), ...(options.global !== undefined ? { global: options.global } : {}) })
  const previousStateSnapshot = await readSnapshot(stateFileOf(options))
  const previousPackageFiles = await capturePackageFiles(options)
  let expectedPackageFiles: FileSnapshot[] = []
  let expectedState = previousStateSnapshot
  const saveOwnedState = async (language: InstallerLanguage, packages: string[], addons: string[], lsp?: OwnedLsp): Promise<void> => {
    if (expectedState) await assertCurrent(expectedState)
    else if (await readSnapshot(stateFileOf(options))) throw new Error("Rollback conflict: installer state appeared externally.")
    await saveInstallationState(options, language, packages, addons, lsp)
    expectedState = await readSnapshot(stateFileOf(options))
  }
  const runDependencyInstall = async (args: readonly string[]): Promise<number> => {
    try { return await runCommand("npm", args) }
    finally {
      expectedPackageFiles = []
      for (const item of previousPackageFiles) {
        const current = await readSnapshot(item.path)
        if (current) expectedPackageFiles.push(current)
      }
    }
  }
  const installedPackages: InstalledPackageSet[] = []
  let configuredLsp: OwnedLsp | undefined
  let pluginRegistered = false
  let rollbackStarted = false
  const rollback = async (): Promise<void> => {
    if (rollbackStarted) return
    rollbackStarted = true
    const conflicts: string[] = []
    const attempt = async (operation: () => Promise<void>): Promise<void> => {
      try { await operation() } catch (error) { conflicts.push(error instanceof Error ? error.message : String(error)) }
    }
    if (configuredLsp || pluginRegistered) await attempt(() => rollbackPluginRegistration(options, previousConfigs, packageName, (file) => output(options, text.backup(file)), configuredLsp))
    let dependenciesRestored = false
    await attempt(async () => {
      for (const expected of expectedPackageFiles) await assertCurrent(expected)
      await rollbackInstalledPackages(installedPackages, runCommand, (line) => output(options, line))
      for (const expected of expectedPackageFiles) {
        const current = await readSnapshot(expected.path)
        if (current) Object.assign(expected, current)
      }
      await rollbackPackageFiles(previousPackageFiles, expectedPackageFiles, (file) => output(options, text.backup(file)))
      dependenciesRestored = true
    })
    await attempt(async () => {
      if (!dependenciesRestored && installedPackages.length) throw new Error("Installer ownership state retained for dependency recovery.")
      if (expectedState) await assertCurrent(expectedState)
      else if (await readSnapshot(stateFileOf(options))) throw new Error("Installer state appeared externally.")
      if (previousStateSnapshot && expectedState) await commitConfigurations([{ ...expectedState, text: previousStateSnapshot.source }], (file) => output(options, text.backup(file)))
      else if (expectedState) await removeState(stateFileOf(options))
    })
    await attempt(async () => { await rollbackVisualHost?.() })
    if (conflicts.length) throw new Error(`Rollback conflicts: ${conflicts.join("; ")}`)
  }
  try {
  for (const file of previousConfigs) {
    removePatchlineEntries(file.source, state.packageName ?? PATCHLINE_PACKAGE)
    output(options, text.backup(await backup(file)))
  }
  output(options, text.registering)
  const pluginArgs = ["plugin", packageName]
  if (previousConfigs.some((file) => removePatchlineEntries(file.source, state.packageName ?? PATCHLINE_PACKAGE).removed > 0)) pluginArgs.push("--force")
  if (options.global) pluginArgs.push("--global")
  const pluginCode = await runCommand("opencode", pluginArgs)
  if (pluginCode !== 0) {
    await rollbackPluginRegistration(options, previousConfigs, packageName, (file) => output(options, text.backup(file)))
    errorOutput(options, text.error(language === "ru" ? `Регистрация плагина завершилась с кодом ${pluginCode}.` : `OpenCode plugin registration failed with exit code ${pluginCode}.`))
    return pluginCode
  }
  pluginRegistered = true
  const deduplicated = (await configurationFiles(options)).flatMap((file) => {
    const config = parse(file.source.replace(/^\uFEFF/, ""), [], { allowTrailingComma: true })
    const plugins = config.plugin as unknown[] | undefined
    if (!plugins?.some((entry) => isPatchlineValue(entry, packageName))) return []
    const preferred = plugins.find((entry) => isPatchlineValue(entry, packageName) && Array.isArray(entry))
    let kept = false
    const entries = plugins.flatMap((entry) => {
      if (!isPatchlineValue(entry, packageName)) return [entry]
      if (kept) return []
      kept = true
      return [Array.isArray(preferred) ? [packageName, preferred[1]] : packageName]
    })
    const bom = file.source.startsWith("\uFEFF") ? "\uFEFF" : ""
    const source = file.source.slice(bom.length)
    const updated = bom + applyEdits(source, modify(source, ["plugin"], entries, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: source.includes("\r\n") ? "\r\n" : "\n" } }))
    return updated === file.source ? [] : [{ ...file, text: updated }]
  })
  await commitConfigurations(deduplicated, (file) => output(options, text.backup(file)))
  output(options, text.registered)
  const sameScope = state.scope === scope
  let lspConfig = state.lspConfig
  let ownedPackages = sameScope ? [...(state.lspPackages ?? [])] : []
  let ownedAddons = sameScope ? [...(state.addonPackages ?? [])] : []
  await saveOwnedState(language, ownedPackages, ownedAddons, lspConfig)

  const lspAvailable = await hasCommand("typescript-language-server")
  if (!lspAvailable) {
    output(options, text.lspMissing)
    const confirmed = options.yes === true || await (options.confirm ?? confirmPrompt)(text.lspPrompt)
    if (!confirmed) {
      if (options.yes !== true && !process.stdin.isTTY && !options.confirm) output(options, text.nonInteractive)
      output(options, text.lspDeclined)
    } else {
      const existingPackages = await presentPackages(options)
      const missingPackages = LSP_PACKAGES.filter((item) => !existingPackages.has(item))
      const npmArgs = options.global
        ? ["install", "--global", ...missingPackages]
        : ["install", "--save-dev", ...missingPackages]
      installedPackages.push({ packages: missingPackages, global: Boolean(options.global) })
      const dependencyCode = await runDependencyInstall(missingPackages.length === 0 && !options.global ? ["install"] : npmArgs)
      if (dependencyCode !== 0) {
        await rollback()
        errorOutput(options, text.error(text.lspFailed(dependencyCode)))
        return dependencyCode
      }
      ownedPackages = [...new Set([...ownedPackages, ...missingPackages])]
      await saveOwnedState(language, ownedPackages, ownedAddons, lspConfig)
      lspConfig = await configureLsp(options, lspConfig, (file) => output(options, text.backup(file)))
      configuredLsp = lspConfig
      output(options, text.lspInstalled)
    }
  }

  if (!(await hasCommand("bun"))) {
    output(options, text.runtimeMissing)
    const confirmed = options.yes === true || await (options.confirm ?? confirmPrompt)(text.runtimePrompt)
    if (!confirmed) {
      if (options.yes !== true && !process.stdin.isTTY && !options.confirm) output(options, text.nonInteractive)
      output(options, text.runtimeDeclined)
    } else {
      const existingPackages = await presentPackages({ ...options, global: true })
      const missingAddons = ADDON_PACKAGES.filter((item) => !existingPackages.has(item))
      if (missingAddons.length === 0) {
        output(options, text.runtimeInstalled)
      } else {
        const addonCode = await runCommand("npm", ["install", "--global", ...missingAddons])
        installedPackages.push({ packages: missingAddons, global: true })
        if (addonCode !== 0) {
          await rollback()
          errorOutput(options, text.error(text.runtimeFailed(addonCode)))
          return addonCode
        }
        ownedAddons = [...new Set([...ownedAddons, ...missingAddons])]
        await saveOwnedState(language, ownedPackages, ownedAddons, lspConfig)
        output(options, text.runtimeInstalled)
      }
    }
  }

  await saveOwnedState(language, ownedPackages, ownedAddons, lspConfig)
  output(options, text.complete)
  return 0
  } catch (error) {
    try { await rollback() } catch (rollbackError) {
      throw new Error(`Installation failed and rollback was incomplete: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error })
    }
    throw error
  }
}


export async function installPatchline(rawOptions: InstallerOptions = {}): Promise<number> {
  try { return await performInstall(rawOptions) }
  catch (error) {
    const language = rawOptions.language ?? "en"
    errorOutput(rawOptions, messages[language].error(error instanceof Error ? error.message : String(error)))
    return 1
  }
}

export async function uninstallPatchline(rawOptions: InstallerOptions = {}): Promise<number> {
  let language = rawOptions.language ?? "en"
  try {
    const options = await normalizeOptions(rawOptions)
    const state = await readState(stateFileOf(options))
    language = languageOf(options, state)
    const text = messages[language]
    const files = await configurationFiles(options)
    const changes = files.map((file) => {
      const removed = removePatchlineEntries(file.source, state.packageName ?? PATCHLINE_PACKAGE)
      const text = state.lspConfig?.file === file.path ? removeOwnedLsp(removed.text, state.lspConfig) : removed.text
      return { ...file, ...removed, text }
    }).filter((file) => file.text !== file.source)
    const packageDirectories = new Set([configDirectoryOf(options)])
    if (!options.global) packageDirectories.add(path.join(options.cwd!, ".opencode"))
    const packageFiles = []
    for (const directory of packageDirectories) {
      const snapshot = await readSnapshot(path.join(directory, "package.json"))
      if (!snapshot) continue
      const manifest: unknown = JSON.parse(snapshot.source.replace(/^\uFEFF/, ""))
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`Invalid package manifest: ${snapshot.path}`)
      const record = manifest as Record<string, unknown>
      if (["dependencies", "devDependencies", "optionalDependencies"].some((key) => {
        const dependencies = record[key]
        return dependencies && typeof dependencies === "object" && Object.hasOwn(dependencies, PATCHLINE_PACKAGE)
      })) packageFiles.push(snapshot)
    }
    const sameScope = state.scope === scopeOf(options)
    const ownedPackages = sameScope ? state.lspPackages ?? [] : []
    const ownedAddons = sameScope ? state.addonPackages ?? [] : []
    if (!changes.length) output(options, text.noConfig)
    for (const change of changes) output(options, `${text.dryRun}: ${change.path}`)
    if (ownedPackages.length) output(options, `${text.dryRun}: ${ownedPackages.join(", ")}`)
    if (ownedAddons.length) output(options, `${text.dryRun}: ${ownedAddons.join(", ")}`)
    for (const file of packageFiles) output(options, `${text.dryRun}: ${file.path} (${PATCHLINE_PACKAGE})`)
    if (!ownedPackages.length && !ownedAddons.length) output(options, text.noDependencies)
    if (options.dryRun) return 0
    if (changes.length || ownedPackages.length || ownedAddons.length || packageFiles.length) {
      const prompt = language === "ru" ? "Удалить перечисленные компоненты Patchline?" : "Remove the listed Patchline components?"
      if (!options.yes && !await (options.confirm ?? confirmPrompt)(prompt)) {
        output(options, language === "ru" ? "Удаление отменено." : "Uninstallation cancelled.")
        return 0
      }
    }
    for (const file of packageFiles) await assertCurrent(file)
    await commitConfigurations(changes, (file) => output(options, text.backup(file)))
    for (const file of packageFiles) {
      await assertCurrent(file)
      const code = await run(options, "npm", ["uninstall", "--prefix", path.dirname(file.path), "--ignore-scripts", PATCHLINE_PACKAGE])
      if (code !== 0) {
        errorOutput(options, text.error(`npm uninstall ${PATCHLINE_PACKAGE}: ${code}`))
        return code
      }
    }
    output(options, text.removed(changes.reduce((total, item) => total + item.removed, 0)))
    if (ownedPackages.length) {
      const args = ["uninstall", options.global ? "--global" : "--save-dev", ...ownedPackages]
      const code = await run(options, "npm", args)
      if (code !== 0) {
        errorOutput(options, text.error(language === "ru" ? `Удаление LSP завершилось с кодом ${code}.` : `LSP removal failed with exit code ${code}.`))
        return code
      }
      output(options, text.dependenciesRemoved)
    }
    if (ownedAddons.length) {
      const code = await run(options, "npm", ["uninstall", "--global", ...ownedAddons])
      if (code !== 0) {
        errorOutput(options, text.error(language === "ru" ? `Удаление дополнений среды завершилось с кодом ${code}.` : `Runtime add-on removal failed with exit code ${code}.`))
        return code
      }
      output(options, text.addonsRemoved)
    }
    await removeState(stateFileOf(options))
    output(options, text.completeUninstall)
    return 0
  } catch (error) {
    errorOutput(rawOptions, messages[language].error(error instanceof Error ? error.message : String(error)))
    return 1
  }
}

export async function protectVisualHostUpdates(file: string, onRollback?: (restore: () => Promise<void>) => void): Promise<void> {
  const snapshot = await readSnapshot(file)
  if (!snapshot) throw new Error(`OpenCode global configuration not found: ${file}`)
  const bom = snapshot.source.startsWith("\uFEFF") ? "\uFEFF" : ""
  const source = snapshot.source.slice(bom.length)
  const errors: ParseError[] = []
  const config: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid OpenCode JSON/JSONC configuration.")
  const preference = (config as Record<string, unknown>).autoupdate
  if (preference === false || preference === "notify") return
  const text = bom + applyEdits(source, modify(source, ["autoupdate"], "notify", { formattingOptions: { insertSpaces: true, tabSize: 2, eol: source.includes("\r\n") ? "\r\n" : "\n" } }))
  await commitConfigurations([{ ...snapshot, text }], () => {})
  const landed = await readSnapshot(file)
  if (!landed) throw new Error("Visual host configuration snapshot unavailable.")
  onRollback?.(async () => {
    await assertCurrent(landed)
    await commitConfigurations([{ ...landed, text: snapshot.source }], () => {})
  })
}

export function integratedHostVersion(upstream: string, plugin: string): string {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
  const packageVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  if (!stable.test(upstream) || !packageVersion.test(plugin)) throw new Error("Invalid upstream or Patchline version.")
  return `${upstream}+patchline.${plugin}.tools1`
}

export function patchHostUpdates(source: string, cli: string): string {
  const marker = "// Patchline coordinated upgrade"
  if (source.includes(marker)) {
    return source.includes('if (InstallationVersion.includes("+patchline."))') ? source : source.replace(`${marker}${source.includes("\r\n") ? "\r\n" : "\n"}`, `${marker}${source.includes("\r\n") ? "\r\n" : "\n"}        if (InstallationVersion.includes("+patchline.")) {${source.includes("\r\n") ? "\r\n" : "\n"}`).replace(/        return\r?\n(?=        let upgradeResult)/, `        return${source.includes("\r\n") ? "\r\n" : "\n"}        }${source.includes("\r\n") ? "\r\n" : "\n"}`)
  }
  const anchor = 'upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {'
  if (!source.includes(anchor)) throw new Error("Unsupported OpenCode upgrade API.")
  const newline = source.includes("\r\n") ? "\r\n" : "\n"
  const block = [
    `        ${marker}`,
    '        if (InstallationVersion.includes("+patchline.")) {',
    `        const coordinated = yield* run(["node", ${JSON.stringify(cli)}, "install", "--local", "--global", "--yes", "--opencode-version", target])`,
    '        if (coordinated.code !== 0) return yield* Effect.fail(new UpgradeFailedError({ stderr: coordinated.stderr || coordinated.stdout }))',
    '        return',
    '        }',
  ].join(newline)
  return source.replace(anchor, `${anchor}${newline}${block}`)
}

async function ensureVisualHost(options: InstallerOptions): Promise<(() => Promise<void>) | undefined> {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Automatic conversation UI host installation currently requires Windows x64.")
  const globalFiles = await configurationFiles({ ...options, cwd: options.cwd!, global: true })
  const serverConfig = globalFiles.find((file) => /^opencode\.jsonc?$/.test(path.basename(file.path)))
  if (!serverConfig) throw new Error("An OpenCode global configuration is required to protect the custom UI host from automatic replacement.")
  let rollbackVisualConfig: (() => Promise<void>) | undefined
  await protectVisualHostUpdates(serverConfig.path, (restore) => { rollbackVisualConfig = restore })
  let rollbackHost: (() => Promise<void>) | undefined
  try {
  const version = await executeCommand("opencode", ["--version"], options.cwd!)
  const packageRoot = fileURLToPath(new URL("..", import.meta.url))
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version: string }
  const latest = options.opencodeVersion ? undefined : await executeCommand("npm", ["view", "opencode-ai", "version"], options.cwd!)
  if (latest && latest.code !== 0) throw new Error("Could not resolve the upstream OpenCode version; existing host retained.")
  const upstream = options.opencodeVersion ?? latest!.output.trim()
  const desiredVersion = integratedHostVersion(upstream, manifest.version)
  if (version.code === 0 && version.output.trim() === desiredVersion) return undefined
  if (!options.yes && !await (options.confirm ?? confirmPrompt)("Install the Patchline-compatible OpenCode UI host and replace the opencode executable (with a backup)?")) throw new Error("Conversation UI host installation was declined; installation is incomplete.")
  if ((await executeCommand("bun", ["--version"], options.cwd!).catch(() => ({ code: 1, output: "" }))).code !== 0) {
    if ((await executeCommand("npm", ["install", "--global", "bun"], options.cwd!, true)).code !== 0) throw new Error("Bun is required to build the UI host.")
  }
  let host = path.join(packageRoot, ".opencode-host")
  try {
    await access(path.join(host, "packages", "tui", "src", "routes", "session", "index.tsx"))
    const tag = await executeCommand("git", ["describe", "--tags", "--exact-match", "HEAD"], host)
    if (tag.code !== 0 || tag.output.trim() !== `v${upstream}`) throw new Error("Host checkout version mismatch.")
  }
  catch {
    host = path.join(globalConfigDirectory(), `patchline-host-source-${upstream}`)
    await mkdir(path.dirname(host), { recursive: true })
    try { await access(path.join(host, "package.json")) }
    catch { if ((await executeCommand("git", ["clone", "--depth", "1", "--branch", `v${upstream}`, "https://github.com/anomalyco/opencode.git", host], options.cwd!, true)).code !== 0) throw new Error("Could not prepare the OpenCode UI host.") }
  }
  const session = await readSnapshot(path.join(host, "packages", "tui", "src", "routes", "session", "index.tsx"))
  if (!session) throw new Error("Missing OpenCode session renderer.")
  if (!session.source.includes('name={`tool_${props.part.tool}`}')) {
    const original = 'function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {'
    const start = session.source.indexOf(original)
    const end = session.source.indexOf("type ToolProps =", start)
    if (start < 0 || end < 0) throw new Error("Unsupported OpenCode tool renderer; UI host not changed.")
    const block = session.source.slice(start, end)
    const newline = session.source.includes("\r\n") ? "\r\n" : "\n"
    const replaced = block.replace("  const ctx = use()", `  const ctx = use()${newline}  const pluginRuntime = usePluginRuntime()`)
      .replace("      <Switch>", `      <pluginRuntime.Slot name={\`tool_\${props.part.tool}\`} mode="replace" part={props.part} message={props.message} last={props.last}>${newline}      <Switch>`)
      .replace("      </Switch>", `      </Switch>${newline}      </pluginRuntime.Slot>`)
    await commitConfigurations([{ ...session, text: session.source.slice(0, start) + replaced + session.source.slice(end) }], (file) => output(options, `Backup: ${file}`))
  }
  const registry = await readSnapshot(path.join(host, "packages", "opencode", "src", "tool", "registry.ts"))
  if (!registry) throw new Error("Missing OpenCode tool registry.")
  const registryText = patchHostToolSelection(registry.source)
  if (registryText !== registry.source) await commitConfigurations([{ ...registry, text: registryText }], (file) => output(options, `Backup: ${file}`))
  output(options, "Installing/updating the OpenCode conversation UI host (this may take several minutes).")
  const upgradeFile = await readSnapshot(path.join(host, "packages", "opencode", "src", "installation", "index.ts"))
  if (!upgradeFile) throw new Error("Missing OpenCode upgrade adapter.")
  const upgradeText = patchHostUpdates(upgradeFile.source, path.join(packageRoot, "dist", "cli.js"))
  if (upgradeText !== upgradeFile.source) await commitConfigurations([{ ...upgradeFile, text: upgradeText }], () => {})
  const startupFile = await readSnapshot(path.join(host, "packages", "opencode", "src", "cli", "upgrade.ts"))
  if (!startupFile) throw new Error("Missing OpenCode startup update policy.")
  const policyText = startupFile.source.replace('if (InstallationVersion === latest) return', 'if (InstallationVersion.split("+")[0] === latest) return')
  if (policyText !== startupFile.source) await commitConfigurations([{ ...startupFile, text: policyText }], () => {})
  if ((await executeCommand("bun", ["install", "--ignore-scripts"], host, true)).code !== 0) throw new Error("UI host dependencies failed to install.")
  const buildDirectory = path.join(host, "packages", "opencode")
  if ((await executeCommand("bun", ["run", "script/build.ts", "--single", "--skip-install", "--skip-embed-web-ui"], buildDirectory, true, { OPENCODE_VERSION: desiredVersion })).code !== 0) throw new Error("UI host build failed.")
  const binary = path.join(buildDirectory, "dist", "opencode-windows-x64", "bin", "opencode.exe")
  const target = await resolveInstalledOpenCode()
  const previous = await installHostBinary(binary, target, (restore) => { rollbackHost = restore })
  output(options, `OpenCode UI host installed. Backup: ${previous}`)
  const installed = await executeCommand("opencode", ["--version"], options.cwd!)
  if (installed.code !== 0 || installed.output.trim() !== desiredVersion) throw new Error("The opencode command does not resolve to the installed UI host.")
  return async () => {
    await rollbackHost?.()
    await rollbackVisualConfig?.()
  }
  } catch (error) {
    try { await rollbackHost?.() } finally { await rollbackVisualConfig?.() }
    throw error
  }
}

export async function resolveInstalledOpenCode(searchPath = process.env.PATH ?? ""): Promise<string> {
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const target of [path.join(directory, "opencode.exe"), path.join(directory, "node_modules", "opencode-ai", "bin", "opencode.exe")]) {
      try { await access(target); return await realpath(target) } catch { /* try the next launcher */ }
    }
  }
  throw new Error("Could not locate the installed OpenCode binary.")
}
