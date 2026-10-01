import { createInterface } from "node:readline/promises"
import path from "node:path"
import { applyEdits, createScanner, findNodeAtLocation, parse, parseTree, type ParseError } from "jsonc-parser"
import { executeCommand, type CommandResult } from "./installation/process.js"
import { backup, commitConfigurations, configurationFiles, globalConfigDirectory, projectDirectory, readSnapshot, removeState, saveState } from "./installation/files.js"
import { configureLsp, removeOwnedLsp, type OwnedLsp } from "./installation/lsp.js"

// jsonc-parser declares SyntaxKind as an ambient const enum, incompatible with verbatimModuleSyntax.
const COMMA_TOKEN = 5

export type InstallerLanguage = "en" | "ru"

type Output = (line: string) => void
type RunCommand = (command: string, args: readonly string[]) => Promise<number>
type HasCommand = (command: string) => Promise<boolean>
type Confirm = (message: string) => Promise<boolean>
type CaptureCommand = (command: string, args: readonly string[]) => Promise<CommandResult>

export type InstallerOptions = {
  cwd?: string
  global?: boolean
  language?: InstallerLanguage
  configDirectory?: string
  stateDirectory?: string
  stateFile?: string
  packageName?: string
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
  packageName?: string
  lspConfig?: OwnedLsp
}

const LSP_PACKAGES = ["typescript", "typescript-language-server"] as const
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
    complete: "Installation complete. Restart OpenCode to load the changes.",
    noConfig: "No OpenCode configuration containing Patchline was found.",
    removing: "Removing Patchline entries from OpenCode configuration.",
    dryRun: "Would remove",
    removed: (count: number) => `Removed ${count} Patchline configuration entr${count === 1 ? "y" : "ies"}.`,
    dependenciesRemoved: "Owned LSP dependencies removed.",
    noDependencies: "No LSP dependencies owned by Patchline were found.",
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
    complete: "Установка завершена. Перезапустите OpenCode для применения изменений.",
    noConfig: "Конфигурация OpenCode с Patchline не найдена.",
    removing: "Удаление записей Patchline из конфигурации OpenCode.",
    dryRun: "Будет удалено",
    removed: (count: number) => `Удалено записей конфигурации Patchline: ${count}.`,
    dependenciesRemoved: "Зависимости LSP, установленные Patchline, удалены.",
    noDependencies: "Зависимости LSP, принадлежащие Patchline, не найдены.",
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
  if (state.lspPackages !== undefined && (!Array.isArray(state.lspPackages) || state.lspPackages.some((item) => !LSP_PACKAGES.includes(item)))) throw new Error("Invalid installer dependency ownership.")
  const result: InstallerState = {}
  if (state.language === "ru" || state.language === "en") result.language = state.language
  if (state.scope === "global" || state.scope === "project") result.scope = state.scope
  if (Array.isArray(state.lspPackages)) result.lspPackages = state.lspPackages as string[]
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
  return typeof specifier === "string" && (specifier === packageName || /^opencode-patchline(?:@[^/]+)?(?:\/(?:plugin|server|tui))?$/.test(specifier))
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
  return { ...options, cwd: options.global ? options.cwd ?? process.cwd() : await projectDirectory(options.cwd ?? process.cwd()) }
}

async function saveInstallationState(options: InstallerOptions, language: InstallerLanguage, lspPackages: string[], lspConfig?: OwnedLsp): Promise<void> {
  await saveState(stateFileOf(options), { language, scope: scopeOf(options), lspPackages, packageName: options.packageName ?? PATCHLINE_PACKAGE, ...(lspConfig ? { lspConfig } : {}) })
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
  if (!options.runCommand || options.captureCommand) {
    const version = await capture(options, "opencode", ["--version"])
    if (version.code !== 0 || !/^1\.(?:18|19|[2-9]\d|\d{3,})\./.test(version.output)) {
      throw new Error(language === "ru" ? "Требуется OpenCode >=1.18.0 и <2. Установите совместимую версию OpenCode." : "OpenCode >=1.18.0 and <2 is required. Install a compatible OpenCode version.")
    }
  }
  const previousConfigs = await configurationFiles(options)
  for (const file of previousConfigs) {
    removePatchlineEntries(file.source, state.packageName ?? PATCHLINE_PACKAGE)
    output(options, text.backup(await backup(file)))
  }
  output(options, text.registering)
  const pluginArgs = ["plugin", packageName]
  if (options.global) pluginArgs.push("--global")
  const pluginCode = await runCommand("opencode", pluginArgs)
  if (pluginCode !== 0) {
    const currentFiles = await configurationFiles(options)
    const restore = []
    for (const previous of previousConfigs) {
      const current = currentFiles.find((file) => file.path === previous.path)
      if (!current || current.source === previous.source) continue
      const stripped = removePatchlineEntries(current.source, packageName).text
      const before = parse(previous.source.replace(/^\uFEFF/, ""), [], { allowTrailingComma: true })
      const after = parse(stripped.replace(/^\uFEFF/, ""), [], { allowTrailingComma: true })
      if (JSON.stringify(before) === JSON.stringify(after)) restore.push({ ...current, text: previous.source })
    }
    await commitConfigurations(restore, (file) => output(options, text.backup(file)))
    errorOutput(options, text.error(language === "ru" ? `Регистрация плагина завершилась с кодом ${pluginCode}.` : `OpenCode plugin registration failed with exit code ${pluginCode}.`))
    return pluginCode
  }
  output(options, text.registered)
  await saveInstallationState(options, language, state.scope === scope ? state.lspPackages ?? [] : [], state.lspConfig)

  const lspAvailable = await hasCommand("typescript-language-server")
  let lspConfig = state.lspConfig
  let ownedPackages = state.scope === scope ? [...(state.lspPackages ?? [])] : []
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
      const dependencyCode = await runCommand("npm", missingPackages.length === 0 && !options.global ? ["install"] : npmArgs)
      if (dependencyCode !== 0) {
        errorOutput(options, text.error(text.lspFailed(dependencyCode)))
        return dependencyCode
      }
      ownedPackages = [...new Set([...ownedPackages, ...missingPackages])]
      await saveInstallationState(options, language, ownedPackages, lspConfig)
      lspConfig = await configureLsp(options, lspConfig, (file) => output(options, text.backup(file)))
      output(options, text.lspInstalled)
    }
  }

  await saveInstallationState(options, language, ownedPackages, lspConfig)
  output(options, text.complete)
  return 0
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
    const ownedPackages = state.scope === scopeOf(options) ? state.lspPackages ?? [] : []
    if (!changes.length) output(options, text.noConfig)
    for (const change of changes) output(options, `${text.dryRun}: ${change.path}`)
    if (ownedPackages.length) output(options, `${text.dryRun}: ${ownedPackages.join(", ")}`)
    else output(options, text.noDependencies)
    if (options.dryRun) return 0
    if (changes.length || ownedPackages.length) {
      const prompt = language === "ru" ? "Удалить перечисленные компоненты Patchline?" : "Remove the listed Patchline components?"
      if (!options.yes && !await (options.confirm ?? confirmPrompt)(prompt)) {
        output(options, language === "ru" ? "Удаление отменено." : "Uninstallation cancelled.")
        return 0
      }
    }
    await commitConfigurations(changes, (file) => output(options, text.backup(file)))
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
    await removeState(stateFileOf(options))
    output(options, text.completeUninstall)
    return 0
  } catch (error) {
    errorOutput(rawOptions, messages[language].error(error instanceof Error ? error.message : String(error)))
    return 1
  }
}