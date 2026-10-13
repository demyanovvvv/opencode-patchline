import path from "node:path"
import { fileURLToPath } from "node:url"
import type { InstallerOptions } from "../installer.js"

const aliases: Record<string, string> = { "-g": "--global", "-y": "--yes", "-h": "--help", "--language": "--lang" }

export function installerArguments(command: "install" | "uninstall", args: readonly string[]): { options: InstallerOptions; help: boolean } {
  const values = new Set(["--lang", "--cwd", "--host-binary", ...(command === "install" ? ["--package", "--opencode-version"] : [])])
  const switches = new Set(["--project", "--global", "--yes", "--help", "--dry-run", ...(command === "install" ? ["--local", "--no-host", "--no-lsp"] : ["--keep-deps", "--restore-host"])])
  const parsed = new Map<string, string | true>()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const equals = arg.indexOf("=")
    const name = equals < 0 ? arg : arg.slice(0, equals)
    const flag = aliases[name] ?? name
    if (!values.has(flag) && !switches.has(flag)) throw new Error(`Unknown installer option: ${name}`)
    if (parsed.has(flag)) throw new Error(`Repeated installer option: ${flag}`)
    if (switches.has(flag)) {
      if (equals >= 0) throw new Error(`Option does not accept a value: ${flag}`)
      parsed.set(flag, true)
    } else {
      const value = equals < 0 ? args[++index] : arg.slice(equals + 1)
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`)
      parsed.set(flag, value)
    }
  }
  if (parsed.has("--project") && parsed.has("--global")) throw new Error("Conflicting options: --project and --global")
  if (parsed.has("--local") && parsed.has("--package")) throw new Error("Conflicting options: --local and --package")
  if (parsed.has("--no-host") && (parsed.has("--host-binary") || parsed.has("--opencode-version"))) throw new Error("--no-host conflicts with host options")
  const language = parsed.get("--lang")
  if (language !== undefined && language !== "en" && language !== "ru") throw new Error("Unsupported installer language. Use --lang ru or --lang en.")
  const upstream = parsed.get("--opencode-version")
  if (upstream !== undefined && (typeof upstream !== "string" || !/^1\.\d+\.\d+$/.test(upstream))) throw new Error("--opencode-version requires a stable OpenCode 1.x version.")
  const options: InstallerOptions = { global: parsed.has("--global"), yes: parsed.has("--yes"), dryRun: parsed.has("--dry-run") }
  if (language === "en" || language === "ru") options.language = language
  const cwd = parsed.get("--cwd")
  if (typeof cwd === "string") options.cwd = path.resolve(cwd)
  const binary = parsed.get("--host-binary")
  if (typeof binary === "string") options.hostBinary = path.resolve(binary)
  if (typeof upstream === "string") options.opencodeVersion = upstream
  const source = parsed.get("--package")
  if (typeof source === "string") options.packageName = path.resolve(source)
  else if (parsed.has("--local")) options.packageName = fileURLToPath(new URL("../..", import.meta.url))
  if (parsed.has("--no-host")) options.noHost = true
  if (parsed.has("--no-lsp")) options.noLsp = true
  if (parsed.has("--keep-deps")) options.keepDeps = true
  if (parsed.has("--restore-host")) options.restoreHost = true
  return { options, help: parsed.has("--help") }
}

export function installerHelp(command: "install" | "uninstall", language = "en"): string {
  const ru = language === "ru"
  return [
    `${ru ? "Использование" : "Usage"}: opencode-patchline ${command} [options]`,
    `--project                 ${ru ? "Область проекта (по умолчанию)" : "Project scope (default)"}`,
    `--global, -g              ${ru ? "Глобальная область" : "Global scope"}`,
    `--cwd <path>              ${ru ? "Выбрать проект" : "Select a project"}`,
    `--lang, --language en|ru  ${ru ? "Язык сообщений" : "Message language"}`,
    `--yes, -y                 ${ru ? "Подтвердить операции" : "Accept prompts"}`,
    `--dry-run                 ${ru ? "Предпросмотр без изменений" : "Preview without changes"}`,
    `--host-binary <path>      ${ru ? "Исполняемый файл OpenCode" : "OpenCode executable"}`,
    ...(command === "install" ? [
      `--local                   ${ru ? "Пакет рядом с CLI (совместимый алиас)" : "Use the package containing this CLI (compatible alias)"}`,
      `--package <path>          ${ru ? "Явный каталог собранного пакета" : "Use an explicit built package directory"}`,
      `--no-host                 ${ru ? "Пропустить подготовку UI-хоста" : "Skip UI host provisioning"}`,
      `--no-lsp                  ${ru ? "Пропустить установку и настройку LSP" : "Skip LSP installation and configuration"}`,
      `--opencode-version <1.x>  ${ru ? "Явная стабильная upstream-версия" : "Override the stable upstream host version"}`,
    ] : [
      `--keep-deps               ${ru ? "Сохранить зависимости и runtime-дополнения" : "Keep package dependencies and runtime add-ons"}`,
      `--restore-host            ${ru ? "Восстановить исходный OpenCode при отсутствии других владельцев" : "Restore verified original OpenCode if no other owners remain"}`,
    ]),
    `--help, -h                ${ru ? "Показать справку" : "Show this help"}`,
  ].join("\n")
}
