import path from "node:path"
import type { Plugin, PluginModule, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { parseConfig } from "./config.js"
import { EditService, type EditRequest } from "./edit-service.js"
import { errorMessage, PatchlineError } from "./errors.js"
import { looksLikeDirectShellWrite } from "./guards/files.js"
import { ReadService } from "./read-service.js"
import { astSearchFile } from "./search/ast.js"
import { grepWorkspace } from "./search/grep.js"
import { runOpenCodeLspBridge } from "./search/lsp.js"
import { routeSearch } from "./search/router.js"
import { ScopedSnapshotStore } from "./snapshot/store.js"
import { LocalMetrics } from "./telemetry/metrics.js"
import { runDiagnosticCommand } from "./validation/diagnostics.js"
import { validationCommand } from "./validation/router.js"
import { WriteService } from "./write-service.js"
import { resolveWorkspacePath } from "./workspace/paths.js"

const MAX_SEARCH_OUTPUT_CHARS = 20_000
const MAX_PATCH_INPUT_BYTES = 8 * 1024 * 1024

function boundedSearchOutput(output: string): string {
  if (output.length > MAX_SEARCH_OUTPUT_CHARS) {
    throw new PatchlineError("INVALID_ARGUMENT", "Search output exceeds the 20,000-character limit.")
  }
  return output
}

function boundedMutationOutput(output: string): string {
  const suffix = "\n... Output truncated."
  return output.length <= MAX_SEARCH_OUTPUT_CHARS
    ? output
    : `${output.slice(0, MAX_SEARCH_OUTPUT_CHARS - suffix.length)}${suffix}`
}

const POLICY = `PATCHLINE EDITING POLICY
- Locate before broad reads; use LSP for symbols, grep for text, and AST for structure.
- Read the smallest useful source range.
- Existing files require snapshot-anchored edit; never rewrite one for a local change.
- Preserve unrelated code and formatting. If a snapshot is stale, reread before retrying.
- Run relevant diagnostics and proportional validation after edits.`

function scope(context: ToolContext) {
  return { sessionId: context.sessionID, worktree: context.worktree }
}

function toolError(error: unknown): Error {
  if (!(error instanceof PatchlineError)) return error instanceof Error ? error : new Error(String(error))
  return Object.assign(new Error(errorMessage(error)), {
    name: error.name,
    code: error.code,
    path: error.path,
    snapshotId: error.snapshotId,
    retryable: error.retryable,
    writes: error.writes,
    details: error.details,
  })
}

function parseApplyPatchPaths(patchText: string): string[] {
  const paths: string[] = []
  for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) paths.push(match[1]!.trim())
  return paths
}

function splitHashlineSections(patchText: string): Array<{ path: string; tag: string; patch: string }> {
  const headers = [...patchText.matchAll(/^\[([^\]\r\n]+)#([A-Fa-f0-9]{4})\]\s*$/gm)]
  if (headers.length > 0 && patchText.slice(0, headers[0]!.index).trim()) {
    throw new PatchlineError("INVALID_ARGUMENT", "Hashline patch must not contain content before its first section header.")
  }
  return headers.map((header, index) => ({
    path: header[1]!,
    tag: header[2]!,
    patch: patchText.slice(header.index, headers[index + 1]?.index ?? patchText.length).trim(),
  }))
}

function parseNewFilePatch(patchText: string): Array<{ path: string; content: string }> {
  const lines = patchText.replace(/\r\n/g, "\n").split("\n")
  const endIndex = lines.indexOf("*** End Patch")
  if (lines[0] !== "*** Begin Patch" || endIndex === -1 || lines.indexOf("*** End Patch", endIndex + 1) !== -1 || lines.slice(endIndex + 1).some((line) => line.trim())) {
    throw new PatchlineError("INVALID_ARGUMENT", "Classic apply_patch input must contain one complete patch envelope with no trailing content.")
  }
  const files: Array<{ path: string; content: string }> = []
  let index = 1
  while (index <= endIndex) {
    const line = lines[index]!
    if (line === "*** End Patch" || line === "") {
      index++
      continue
    }
    const match = /^\*\*\* Add File: (.+)$/.exec(line)
    if (!match) {
      throw new PatchlineError("FALLBACK_REJECTED", "Only new-file `*** Add File` sections are accepted in classic apply_patch format. Existing files require Hashline sections.")
    }
    const content: string[] = []
    index++
    while (index < endIndex && !lines[index]!.startsWith("*** ")) {
      const body = lines[index]!
      if (!body.startsWith("+")) throw new PatchlineError("INVALID_ARGUMENT", `New-file patch rows must start with '+': ${match[1]}`)
      content.push(body.slice(1))
      index++
    }
    files.push({ path: match[1]!.trim(), content: content.join("\n") })
  }
  return files
}

export const PatchlinePlugin: Plugin = async (input, options) => {
  const config = parseConfig(options ?? {})
  if (config.mode === "disabled") return {}
  const snapshots = new ScopedSnapshotStore({ ttlMs: config.snapshotTtlMs, maxSnapshots: config.maxSnapshots })
  const reads = new ReadService(snapshots, config.maxInitialReadLines)
  const edits = new EditService(snapshots)
  const writes = new WriteService(config)
  const metrics = new LocalMetrics({ enabled: config.telemetry })

  const readTool = tool({
    description: "Read a minimal existing source range and create a Patchline snapshot with stable line anchors.",
    args: {
      filePath: tool.schema.string().describe("Absolute or worktree-relative file path"),
      offset: tool.schema.number().int().min(1).optional().describe("First line, 1-based"),
      limit: tool.schema.number().int().min(1).optional().describe("Maximum lines; defaults to Patchline policy"),
    },
    async execute(args, context) {
      const started = Date.now()
      try {
            await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
            const result = await reads.read({ ...scope(context), ...args })
            const lines = result.kind === "file" ? result.endLine - result.offset + 1 : 0
            metrics.record({ name: "read", path: result.path, lines, bytes: result.output.length, durationMs: Date.now() - started })
            return result.kind === "file"
              ? { title: result.path, output: result.output, metadata: { snapshot: result.snapshot, tag: result.tag, lines } }
              : { title: result.path, output: result.output, metadata: { directory: true, entries: result.totalEntries, truncated: result.truncated } }
      } catch (error) {
        return Promise.reject(toolError(error))
      }
    },
  })

  const editTool = tool({
    description: "Apply a stale-safe edit linked to a snapshot returned by read. Provide exact strings or a Hashline patch.",
    args: {
      filePath: tool.schema.string(),
      snapshot: tool.schema.string().describe("Patchline snapshot ID or Hashline tag from read"),
      oldString: tool.schema.string().optional(),
      newString: tool.schema.string().optional(),
      replaceAll: tool.schema.boolean().optional(),
      hashlinePatch: tool.schema.string().optional(),
    },
    async execute(args, context) {
      const exact = args.hashlinePatch === undefined && args.oldString !== undefined && args.newString !== undefined
        ? { oldString: args.oldString, newString: args.newString, replaceAll: args.replaceAll }
        : undefined
      try {
        await context.ask({ permission: "edit", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
        const result = await edits.edit({ ...scope(context), filePath: args.filePath, snapshot: args.snapshot, exact, hashlinePatch: args.hashlinePatch })
        metrics.record({ name: "edit", path: result.path, added: result.added, deleted: result.deleted })
             const command = validationCommand(result.path, config)
             if (command) {
               await context.ask({ permission: "bash", patterns: [command], always: ["*"], metadata: { command, reason: "post-edit validation" } })
             }
             const diagnostic = command ? await runDiagnosticCommand(command, context.worktree, 120_000, config.maxDiagnostics, context.abort) : undefined
        return {
          title: result.path,
          output: `${result.output}\nDiagnostics: ${diagnostic ? (diagnostic.ok ? "clean" : `failed\n${diagnostic.output}`) : "not configured; OpenCode native diagnostics may run"}`,
          metadata: { added: result.added, deleted: result.deleted, snapshot: result.snapshot, diagnostics: diagnostic?.ok },
        }
      } catch (error) {
        if (error instanceof PatchlineError && error.code === "STALE_SNAPSHOT") metrics.record({ name: "stale_conflict", path: error.path })
        return Promise.reject(toolError(error))
      }
    },
  })

  const writeTool = tool({
    description: "Create a new file. Existing source files are protected and require Patchline edit.",
    args: { filePath: tool.schema.string(), content: tool.schema.string() },
    async execute(args, context) {
      try {
        await context.ask({ permission: "edit", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
        const result = await writes.write({ worktree: context.worktree, ...args })
        metrics.record({ name: "write", path: result.path, bytes: args.content.length })
        return { title: result.path, output: result.output, metadata: { created: result.created } }
      } catch (error) {
        if (error instanceof PatchlineError && error.code === "WRITE_PROTECTED") metrics.record({ name: "write_prevented", path: error.path })
        return Promise.reject(toolError(error))
      }
    },
  })

  return {
    tool: {
      ...(config.mode === "precision" ? {
        read: readTool,
        edit: editTool,
        write: writeTool,
        apply_patch: tool({
        description: "Apply one or more Hashline sections linked to snapshots returned by read. Existing files require [PATH#TAG] and PUT/CUT operations.",
        args: { patchText: tool.schema.string() },
        async execute(args, context) {
          if (Buffer.byteLength(args.patchText, "utf8") > MAX_PATCH_INPUT_BYTES) {
            throw new PatchlineError("INVALID_ARGUMENT", "Patch input exceeds the 8 MiB limit.")
          }
          const sections = splitHashlineSections(args.patchText)
          if (sections.length === 0) {
            if (!config.applyPatchFallback) {
              throw new PatchlineError("FALLBACK_REJECTED", "Classic apply_patch fallback is disabled. Use a snapshot-tagged Hashline section for existing files or enable applyPatchFallback.")
            }
            metrics.record({ name: "fallback" })
            const files = parseNewFilePatch(args.patchText)
            if (files.length === 0) throw new PatchlineError("INVALID_ARGUMENT", "Expected Hashline sections or classic new-file sections.")
            await context.ask({ permission: "edit", patterns: files.map((file) => file.path), always: ["*"], metadata: { paths: files.map((file) => file.path) } })
            const created = await writes.createBatch(files.map((file) => ({ worktree: context.worktree, filePath: file.path, content: file.content })))
            for (const result of created) metrics.record({ name: "write", path: result.path })
            return boundedMutationOutput(created.map((result) => result.output).join("\n"))
          }
          await context.ask({ permission: "edit", patterns: sections.map((section) => section.path), always: ["*"] , metadata: { paths: sections.map((section) => section.path) } })
          const requests: EditRequest[] = sections.map((section) => ({
            ...scope(context),
            filePath: section.path,
            snapshot: section.tag,
            hashlinePatch: section.patch,
          }))
          const results = await edits.editBatch(requests)
          for (const result of results) metrics.record({ name: "edit", path: result.path, added: result.added, deleted: result.deleted })
          return boundedMutationOutput(results.map((result) => result.output).join("\n\n"))
        },
        }),
      } : {}),
      patchline_grep: tool({
        description: "Bounded ripgrep search for literal text. Use native LSP for symbol relationships.",
        args: {
          pattern: tool.schema.string(),
          path: tool.schema.string().optional(),
          include: tool.schema.string().optional(),
          maxResults: tool.schema.number().int().min(1).max(500).optional(),
        },
        async execute(args, context) {
          await context.ask({ permission: "grep", patterns: [args.pattern], always: ["*"] , metadata: { pattern: args.pattern, path: args.path } })
          const result = await grepWorkspace({ worktree: context.worktree, pattern: args.pattern, path: args.path, include: args.include, maxResults: args.maxResults ?? config.maxSearchResults })
          metrics.record({ name: "grep", lines: result.matches.length })
          return result.matches.length === 0
            ? "No matches found."
             : boundedSearchOutput(`${result.matches.map((match) => `${path.relative(context.worktree, match.path)}:${match.line}: ${match.text}`).join("\n")}${result.truncated ? "\nResults truncated." : ""}`)
        },
      }),
      ast_search: tool({
        description: "Find structural syntax patterns in one source file with ast-grep.",
        args: {
          filePath: tool.schema.string(),
          pattern: tool.schema.string(),
          language: tool.schema.string().optional(),
          maxResults: tool.schema.number().int().min(1).max(500).optional(),
        },
        async execute(args, context) {
          await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
          const result = await astSearchFile({ worktree: context.worktree, filePath: args.filePath, pattern: args.pattern, language: args.language, maxResults: args.maxResults ?? config.maxSearchResults })
          metrics.record({ name: "ast_search", lines: result.matches.length })
          return result.matches.length === 0
            ? "No structural matches found."
             : boundedSearchOutput(`${result.matches.map((match) => `${match.path}:${match.startLine}-${match.endLine}: ${match.text}`).join("\n")}${result.truncated ? "\nResults truncated." : ""}`)
        },
      }),
      patchline_route_search: tool({
        description: "Choose the cheapest reliable search mechanism for a discovery request.",
        args: { query: tool.schema.string() },
        async execute(args) {
          return routeSearch(args.query)
        },
      }),
      patchline_lsp: tool({
        description: "Use OpenCode's existing LSP integration for symbols and diagnostics. Navigation operations beyond this bridge require OPENCODE_EXPERIMENTAL_LSP_TOOL=true.",
        args: {
          operation: tool.schema.enum(["workspaceSymbol", "documentSymbol", "diagnostics"]),
          query: tool.schema.string().optional(),
          filePath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          if (args.filePath) await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"], metadata: { path: args.filePath } })
          return runOpenCodeLspBridge({ worktree: context.worktree, operation: args.operation, query: args.query, filePath: args.filePath, signal: context.abort })
        },
      }),
      patchline_edit_batch: tool({
        description: "Preflight and apply several snapshot-anchored exact edits as one recoverable batch.",
        args: {
          edits: tool.schema.array(tool.schema.object({
            filePath: tool.schema.string(),
            snapshot: tool.schema.string(),
            oldString: tool.schema.string(),
            newString: tool.schema.string(),
            replaceAll: tool.schema.boolean().optional(),
          })).min(1).max(500),
        },
        async execute(args, context) {
          await context.ask({ permission: "edit", patterns: args.edits.map((edit) => edit.filePath), always: ["*"] , metadata: { paths: args.edits.map((edit) => edit.filePath) } })
          const requests: EditRequest[] = args.edits.map((edit) => ({
            ...scope(context),
            filePath: edit.filePath,
            snapshot: edit.snapshot,
            exact: { oldString: edit.oldString, newString: edit.newString, replaceAll: edit.replaceAll },
          }))
          const result = await edits.editBatch(requests)
          return boundedMutationOutput(result.map((item) => item.output).join("\n\n"))
        },
      }),
      patchline_diagnostics: tool({
        description: "Run a configured targeted diagnostic command inside the worktree.",
        args: { command: tool.schema.string() },
        async execute(args, context) {
          await context.ask({ permission: "bash", patterns: [args.command], always: ["*"], metadata: { command: args.command, reason: "diagnostics" } })
          const result = await runDiagnosticCommand(args.command, context.worktree, 120_000, config.maxDiagnostics, context.abort)
          metrics.record({ name: "diagnostics", details: { ok: result.ok } })
          return `${result.ok ? "Diagnostics clean." : `Diagnostics failed (${result.exitCode}).`}\n${result.output}`.trim()
        },
      }),
      ...(config.summary ? { patchline_summary: tool({
        description: "Show a compact local Patchline activity summary for this plugin instance.",
        args: {},
        async execute() {
          if (!config.summary) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "Patchline summary is disabled by configuration.")
          const summary = metrics.summary()
          return [
            "Patchline",
            `Reads: ${summary.read}`,
            `Edits: ${summary.edit}`,
            `Writes: ${summary.write}`,
            `Searches: ${summary.grep + summary.ast_search}`,
            `Diagnostics: ${summary.diagnostics}`,
            `Stale conflicts: ${summary.stale_conflict}`,
            `Writes prevented: ${summary.write_prevented}`,
            `Fallbacks: ${summary.fallback}`,
          ].join("\n")
        },
      }) } : {}),
    },
    async "experimental.chat.system.transform"(_hookInput, output) {
      output.system.push(POLICY)
    },
    async "tool.execute.before"(hookInput, output) {
      if (config.mode === "precision" && hookInput.tool === "apply_patch" && typeof output.args?.patchText === "string" && output.args.patchText.includes("*** ")) {
        for (const patchPath of parseApplyPatchPaths(output.args.patchText)) {
          const resolved = await resolveWorkspacePath(input.worktree, patchPath)
          if (resolved.exists) {
            metrics.record({ name: "write_prevented", path: resolved.relative })
            throw new PatchlineError("FALLBACK_REJECTED", `apply_patch cannot modify existing files while Patchline precision mode is active: ${resolved.relative}. Use read and edit.`)
          }
        }
      }
      if (config.mode === "precision" && hookInput.tool === "bash" && config.guardShellWrites && typeof output.args?.command === "string" && looksLikeDirectShellWrite(output.args.command)) {
        throw new PatchlineError("FALLBACK_REJECTED", "Direct shell file writes are blocked in Patchline precision mode. Use write for new files or snapshot-anchored edit for existing files.")
      }
    },
    async dispose() {
      snapshots.clear()
    },
  }
}

const pluginModule: PluginModule = { id: "opencode-patchline", server: PatchlinePlugin }

export default pluginModule
