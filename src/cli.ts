#!/usr/bin/env node
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inspectCapabilities } from "./compatibility.js"
import { installPatchline, uninstallPatchline, upgradePatchlineHost, type InstallerOptions } from "./installer.js"
import { installerArguments, installerHelp } from "./installation/arguments.js"
import { DEFAULT_CONFIG, parseConfig } from "./config.js"
import { lspGuide, renderLspGuide } from "./lsp-guide.js"
import { prepareProjectLsp } from "./lsp/manager.js"
import type { PatchlineErrorCode } from "./errors.js"

type Output = (line: string) => void

type CliOptions = {
  stdout?: Output
  stderr?: Output
  inspect?: typeof inspectCapabilities
  installer?: InstallerOptions
}

const errorExplanations: Record<PatchlineErrorCode, { summary: string; action: string }> = {
  OPENCODE_UNSUPPORTED: { summary: "The installed OpenCode version does not support this operation.", action: "Upgrade OpenCode to a supported version and run doctor again." },
  CAPABILITY_UNAVAILABLE: { summary: "A requested optional capability is unavailable.", action: "Check doctor output or use the supported fallback." },
  INVALID_ARGUMENT: { summary: "The tool arguments are invalid.", action: "Correct the arguments and retry." },
  PATH_OUTSIDE_WORKSPACE: { summary: "The path is outside the active worktree.", action: "Use a path inside the OpenCode worktree." },
  SYMLINK_ESCAPE: { summary: "The path resolves through a symlink outside the worktree.", action: "Use a non-escaping path inside the worktree." },
  GIT_INTERNAL_PATH: { summary: "The path targets protected Git internals.", action: "Choose a source path outside .git." },
  FILE_NOT_FOUND: { summary: "The target file no longer exists.", action: "Re-discover the path and read it before retrying." },
  SNAPSHOT_NOT_FOUND: { summary: "The referenced snapshot is unavailable or expired.", action: "Read the target again to create a fresh snapshot." },
  SNAPSHOT_SCOPE_MISMATCH: { summary: "The snapshot belongs to another session or worktree.", action: "Read the file in the current OpenCode session." },
  STALE_SNAPSHOT: { summary: "The file changed after it was read.", action: "Re-read the affected range and retry the edit." },
  INVALID_ANCHOR: { summary: "The requested edit anchor was not found or is ambiguous.", action: "Read the current range and provide a precise anchor." },
  PATCH_PREFLIGHT_FAILED: { summary: "The edit failed preflight without changing files.", action: "Correct the patch and retry from a fresh snapshot." },
  WRITE_PROTECTED: { summary: "An existing file write was blocked by policy.", action: "Use snapshot-anchored edit for existing files." },
  GENERATED_FILE: { summary: "The target is protected generated output.", action: "Update the canonical source or generator instead." },
  ENCODING_UNSUPPORTED: { summary: "The file encoding is not supported for safe editing.", action: "Convert the file to supported UTF-8 text before editing." },
  TRANSACTION_FAILED: { summary: "A multi-file transaction failed.", action: "Inspect the reported conflicts and re-read affected files before retrying." },
  DIAGNOSTICS_UNAVAILABLE: { summary: "Diagnostics could not be run.", action: "Check the configured command and granted permissions." },
  VALIDATION_FAILED: { summary: "Post-edit validation failed.", action: "Inspect diagnostics before making another edit." },
  FALLBACK_REJECTED: { summary: "The requested fallback operation is disabled.", action: "Use a snapshot-tagged operation or enable the fallback explicitly." },
  STANDARD_TOOL_REQUIRED: { summary: "The change is too large for Patchline precision editing.", action: "Use the standard OpenCode edit or apply_patch tool." },
}

function writeJson(output: Output, value: unknown): void {
  output(JSON.stringify(value))
}

function parseConfigArgument(value: string | undefined): Record<string, unknown> {
  if (value === undefined) return {}
  const parsed: unknown = JSON.parse(value)
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Configuration must be a JSON object.")
  return parsed as Record<string, unknown>
}

export async function runCli(args: readonly string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((line) => console.log(line))
  const stderr = options.stderr ?? ((line) => console.error(line))
  const inspect = options.inspect ?? inspectCapabilities
  const command = args[0] ?? "doctor"

  if ((command === "lsp" && ["check", "setup"].includes(args[1] ?? "check") && !options.inspect) || (command === "doctor" && args.includes("--lsp") && !options.inspect)) {
    const directoryIndex = args.indexOf("--directory")
    if (directoryIndex >= 0 && (!args[directoryIndex + 1] || args[directoryIndex + 1]!.startsWith("--"))) { stderr("--directory requires a path"); return 1 }
    const directory = path.resolve(directoryIndex >= 0 ? args[directoryIndex + 1]! : process.cwd())
    try {
      const projects = await prepareProjectLsp(directory, { install: command === "lsp" && args[1] === "setup" })
      const ok = projects.every((project) => ["configured", "native", "custom"].includes(project.status))
      if (args.includes("--json")) writeJson(stdout, { directory, projects, verified: false })
      else {
        stdout("Patchline LSP projects (connection not yet verified)")
        for (const project of projects) stdout(`${path.relative(directory, project.root) || "."}: ${project.language} / ${project.server}: ${project.status} — ${project.detail}`)
        if (projects.length === 0) stdout("No supported language files found.")
      }
      return ok ? 0 : 1
    } catch (error) { stderr(error instanceof Error ? error.message : String(error)); return 1 }
  }

  if (command === "doctor") {
    const checks = await inspect()
    if (args.includes("--lsp")) {
      const guide = lspGuide(checks)
      if (args.includes("--json")) writeJson(stdout, guide)
      else for (const line of renderLspGuide(guide)) stdout(line)
      return guide.status === "ready" ? 0 : 1
    }
    const required = checks.filter((check) => check.severity !== "optional")
    const mode = required.every((check) => check.ok) ? "PRECISION" : "DEGRADED"
    if (args.includes("--json")) {
      writeJson(stdout, { checks, mode })
    } else {
      stdout("Patchline Doctor")
      for (const check of checks) stdout(`${check.ok ? "OK" : "--"} ${check.name}: ${check.detail}`)
      stdout(`Mode: ${mode}`)
    }
    return mode === "PRECISION" ? 0 : 1
  }

  if (command === "lsp" && (args[1] ?? "check") === "check") {
    const checks = await inspect()
    const guide = lspGuide(checks)
    if (args.includes("--json")) writeJson(stdout, guide)
    else for (const line of renderLspGuide(guide)) stdout(line)
    return guide.status === "ready" ? 0 : 1
  }

  if (command === "config") {
    const subcommand = args[1] ?? "show"
    if (subcommand === "show") {
      writeJson(stdout, DEFAULT_CONFIG)
      return 0
    }
    if (subcommand === "validate") {
      try {
        const config = parseConfig(parseConfigArgument(args[2]))
        writeJson(stdout, { valid: true, config })
        return 0
      } catch (error) {
        writeJson(stdout, { valid: false, error: error instanceof Error ? error.message : String(error) })
        return 1
      }
    }
    stderr(`Unknown config command: ${subcommand}`)
    return 1
  }

  if (command === "explain") {
    const code = args[1] as PatchlineErrorCode | undefined
    const explanation = code === undefined ? undefined : errorExplanations[code]
    if (!explanation) {
      stderr(`Unknown error code: ${args[1] ?? ""}`)
      return 1
    }
    stdout(`${code}: ${explanation.summary} ${explanation.action}`)
    return 0
  }

  if (command === "host-upgrade") {
    const values: Record<string, string> = {}
    const hostArgs = args.slice(1).filter((arg) => arg !== "--rebuild")
    let valid = hostArgs.length % 2 === 0 && args.filter((arg) => arg === "--rebuild").length <= 1
    for (let index = 0; index < hostArgs.length; index += 2) {
      const flag = hostArgs[index]!
      const value = hostArgs[index + 1]
      if (!["--opencode-version", "--host-binary", "--expected-host-version"].includes(flag) || values[flag] || !value || value.startsWith("--")) { valid = false; break }
      values[flag] = value
    }
    if (!valid || !/^1\.\d+\.\d+$/.test(values["--opencode-version"] ?? "")) {
      stderr("Usage: opencode-patchline host-upgrade --opencode-version <stable-version> [--host-binary <path>] [--expected-host-version <version>] [--rebuild]")
      return 1
    }
    return await upgradePatchlineHost({ ...options.installer, stdout, stderr, opencodeVersion: values["--opencode-version"]!, rebuildHost: args.includes("--rebuild"), ...(values["--host-binary"] ? { hostBinary: values["--host-binary"] } : {}), ...(values["--expected-host-version"] ? { expectedHostVersion: values["--expected-host-version"] } : {}) })
  }

  if (command === "install" || command === "uninstall") {
    try {
      const parsed = installerArguments(command, args.slice(1))
      if (parsed.help) { stdout(installerHelp(command, parsed.options.language)); return 0 }
      const installerOptions = { ...options.installer, ...parsed.options, stdout, stderr }
      return command === "install" ? await installPatchline(installerOptions) : await uninstallPatchline(installerOptions)
    } catch (error) {
      stderr(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  stderr(`Unknown command: ${command}\nUsage: opencode-patchline <doctor [--lsp]|lsp check|lsp setup|config|explain|install|uninstall> [--directory <project>] [--json] [--global] [--lang ru|en] [--yes] [--dry-run]`)
  return 1
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2))
}
