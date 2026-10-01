import path from "node:path"
import { diffPreview, DIFF_PREVIEW_BUDGET } from "./visualization/diff-preview.js"
import { diffStats } from "./editing/diff.js"
import { editFiles } from "./visualization/edit-files.js"
import type { Plugin, PluginModule, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { parseConfig } from "./config.js"
import { EditService, type EditRequest } from "./edit-service.js"
import { parseHashlinePatch } from "./editing/hashline-adapter.js"
import { errorMessage, PatchlineError } from "./errors.js"
import { looksLikeDirectShellWrite } from "./guards/files.js"
import { ReadService } from "./read-service.js"
import { astSearchFile } from "./search/ast.js"
import { grepWorkspace } from "./search/grep.js"
import { runOpenCodeLspBridge, runOpenCodeLspClient } from "./search/lsp.js"
import { routeSearch } from "./search/router.js"
import { ScopedSnapshotStore } from "./snapshot/store.js"
import { LocalMetrics } from "./telemetry/metrics.js"
import { runDiagnosticCommand } from "./validation/diagnostics.js"
import { validationCommand } from "./validation/router.js"
import { WriteService } from "./write-service.js"
import { resolveWorkspacePath } from "./workspace/paths.js"

const MAX_SEARCH_OUTPUT_CHARS = 20_000
const MAX_PATCH_INPUT_BYTES = 8 * 1024 * 1024

function boundedSearchOutput(output: string, notice = ""): string {
  const complete = `${output}${notice}`
  if (complete.length <= MAX_SEARCH_OUTPUT_CHARS) return complete
  const suffix = `\nResults truncated. Narrow path, include, or maxResults.${notice}`
  const limit = MAX_SEARCH_OUTPUT_CHARS - suffix.length
  const end = output.lastIndexOf("\n", limit)
  return `${end >= 0 ? output.slice(0, end) : ""}${suffix}`
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
- Use Hashline sections: [PATH#TAG], PUT ranges or blocks, PUT gaps, CUT, registers, REM, and MV.
- Line numbers refer to the original snapshot; every section requires the tag returned by read.
- Preserve unrelated code and formatting. If a snapshot is stale, reread before retrying.
- Run relevant diagnostics and proportional validation after edits.`

function scope(context: ToolContext) {
  return { sessionId: context.sessionID, worktree: context.worktree }
}

function publishMetadata(context: ToolContext, update: Parameters<ToolContext["metadata"]>[0]): void {
  try {
    context.metadata(update)
  } catch {
    // Presentation must never change a tool's outcome.
  }
}

function progress(context: ToolContext, stage: string, title: string, details: Record<string, unknown> = {}): void {
  publishMetadata(context, { title, metadata: { stage, status: "running", ...details } })
}

function failure(context: ToolContext, error: unknown, stage: string, filePath?: string, details: Record<string, unknown> = {}): void {
  const issue = error instanceof PatchlineError ? error : undefined
  publishMetadata(context, {
    title: filePath ?? issue?.path ?? "Patchline",
    metadata: {
      status: "failed", stage, code: issue?.code ?? "UNEXPECTED_ERROR", path: issue?.path ?? filePath,
      reason: issue?.message ?? errorMessage(error), recoveryAction: issue?.recoveryAction,
      writes: stage === "permission" || stage === "preflight" ? 0 : issue && issue.writes > 0 ? issue.writes : undefined,
      restored: issue?.details?.restored, conflicts: issue?.details?.conflicts, retryable: issue?.retryable,
      ...details,
    },
  })
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
    recoveryAction: error.recoveryAction,
  })
}

function parseApplyPatchPaths(patchText: string): string[] {
  const paths: string[] = []
  for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) paths.push(match[1]!.trim())
  return paths
}

async function splitHashlineSections(patchText: string) {
  if (!/^\[/m.test(patchText)) return []
  if (patchText.trimStart()[0] !== "[") throw new PatchlineError("INVALID_ARGUMENT", "Hashline patch must not contain content before its first section header.")
  return parseHashlinePatch(patchText)
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
  const snapshots = new ScopedSnapshotStore({ ttlMs: config.snapshotTtlMs, maxSnapshots: config.maxSnapshots, maxBytes: config.maxSnapshotBytes })
  const reads = new ReadService(snapshots, config.maxInitialReadLines)
  const edits = new EditService(snapshots, config)
  const writes = new WriteService(config)
  const metrics = new LocalMetrics({ enabled: config.telemetry })

  async function validateMutation(context: ToolContext, paths: readonly string[]) {
    const commands = [...new Set(paths.map((filePath) => validationCommand(filePath, config)).filter((command): command is string => command !== undefined))]
    if (commands.length === 0) return { validation: "not_configured", diagnostics: undefined, reason: undefined }
    let ok = true
    const failures: string[] = []
    for (const command of commands) {
      await context.ask({ permission: "bash", patterns: [command], always: ["*"], metadata: { command, reason: "post-edit validation" } })
      const diagnostic = await runDiagnosticCommand(command, context.worktree, 120_000, config.maxDiagnostics, context.abort)
      if (!diagnostic.ok) { ok = false; failures.push(diagnostic.output) }
    }
    return { validation: ok ? "passed" : "failed", diagnostics: ok, reason: ok ? undefined : boundedMutationOutput(`Validation failed: ${failures.join("\n")}`) }
  }

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
            progress(context, "permission", args.filePath, { kind: "read", path: args.filePath })
            await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
            progress(context, "reading", args.filePath, { kind: "read", path: args.filePath })
            const result = await reads.read({ ...scope(context), ...args })
            const lines = result.kind === "file" ? Math.max(0, result.endLine - result.offset + 1) : 0
            metrics.record({ name: "read", path: result.path, lines, bytes: result.output.length, durationMs: Date.now() - started })
            return result.kind === "file"
              ? {
                  title: result.path,
                  output: result.output,
                  metadata: {
                    kind: "read", stage: "completed", path: result.path, offset: result.kind === "file" ? result.offset : undefined,
                    status: "observed",
                    recoveryAction: "Use the returned snapshot for an edit.",
                    snapshot: result.snapshot,
                    tag: result.tag,
                    lines,
                    bytesRendered: Buffer.byteLength(result.output, "utf8"),
                  },
                }
              : {
                  title: result.path,
                  output: result.output,
                  metadata: {
                    kind: "read", stage: "completed", path: result.path,
                    status: "observed",
                    recoveryAction: "Read a file entry to create a snapshot before editing.",
                    directory: true,
                    entries: result.totalEntries,
                    truncated: result.truncated,
                    bytesRendered: Buffer.byteLength(result.output, "utf8"),
                  },
                }
      } catch (error) {
        failure(context, error, "reading", args.filePath, { kind: "read", writes: 0 })
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
      let stage = "permission"
      let applied: Record<string, unknown> = {}
      try {
        progress(context, stage, args.filePath, { path: args.filePath })
        await context.ask({ permission: "edit", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
        stage = "preflight"
        progress(context, stage, args.filePath, { path: args.filePath })
        const result = await edits.edit({ ...scope(context), filePath: args.filePath, snapshot: args.snapshot, exact, hashlinePatch: args.hashlinePatch }, (nextStage) => {
          stage = nextStage
          progress(context, stage, args.filePath, { path: args.filePath })
        }, context.abort)
        applied = { path: result.path, writes: 1, diff: result.diff, diffTruncated: result.diffTruncated, added: result.added, deleted: result.deleted, snapshot: result.snapshot, bytesWritten: result.bytesWritten }
        stage = "validation"
        progress(context, stage, result.path, applied)
        metrics.record({ name: "edit", path: result.path, added: result.added, deleted: result.deleted })
        const validation = await validateMutation(context, [result.path])
        return {
          title: result.path,
          output: `${result.output}\nDiagnostics: ${validation.validation === "not_configured" ? "not configured; OpenCode native diagnostics may run" : validation.reason ?? "clean"}`,
          metadata: {
            ...applied,
            status: "applied",
            stage: "completed",
            recoveryAction: "Use the returned snapshot for the next edit.",
            ...validation,
          },
        }
      } catch (error) {
        if (error instanceof PatchlineError && error.code === "STALE_SNAPSHOT") metrics.record({ name: "stale_conflict", path: error.path })
        failure(context, error, stage, args.filePath, { ...applied, ...(stage === "validation" ? { validation: "failed", recoveryAction: "Changes were applied. Inspect diagnostics and re-read before retrying." } : {}) })
        return Promise.reject(toolError(error))
      }
    },
  })

  const writeTool = tool({
    description: "Create a new file. Existing source files are protected and require Patchline edit.",
    args: { filePath: tool.schema.string(), content: tool.schema.string() },
    async execute(args, context) {
      let stage = "permission"
      try {
        progress(context, stage, args.filePath, { path: args.filePath })
        await context.ask({ permission: "edit", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
        stage = "preflight"
        progress(context, stage, args.filePath, { path: args.filePath })
        const result = await writes.write({ worktree: context.worktree, ...args }, context.abort)
        metrics.record({ name: "write", path: result.path, bytes: result.bytesWritten })
        stage = "validation"
        progress(context, stage, result.path, { writes: 1, path: result.path })
        const validation = await validateMutation(context, [result.path])
        return {
          title: result.path,
          output: `${result.output}${validation.reason ? `\n${validation.reason}` : ""}`,
          metadata: {
            status: "applied", stage: "completed", writes: 1, path: result.path, paths: [result.path],
            ...validation,
            recoveryAction: "Read the new file before editing it.",
            created: result.created,
            bytesWritten: result.bytesWritten,
          },
        }
      } catch (error) {
        if (error instanceof PatchlineError && error.code === "WRITE_PROTECTED") metrics.record({ name: "write_prevented", path: error.path })
        if (error instanceof PatchlineError && error.writes > 0) stage = "rollback"
        failure(context, error, stage, args.filePath, { paths: [args.filePath], ...(stage === "validation" ? { writes: 1, status: "applied", validation: "failed", recoveryAction: "Changes were applied. Inspect diagnostics and re-read before retrying." } : {}) })
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
        description: "Apply one or more upstream Hashline sections linked to snapshots returned by read. Supports PUT ranges/gaps/structural blocks, CUT and named registers, same-path merges, REM, and MV. Existing files require [PATH#TAG]; line numbers refer to the original snapshot.",
        args: { patchText: tool.schema.string() },
        async execute(args, context) {
          let stage = "preflight"
          let paths: string[] = []
          let applied: Record<string, unknown> = {}
          const observe = (nextStage: string) => {
            stage = nextStage
            progress(context, stage, "Patchline · patch", { paths })
          }
          try {
            progress(context, stage, "Patchline · patch")
          if (Buffer.byteLength(args.patchText, "utf8") > MAX_PATCH_INPUT_BYTES) {
            throw new PatchlineError("INVALID_ARGUMENT", "Patch input exceeds the 8 MiB limit.")
          }
          const sections = await splitHashlineSections(args.patchText)
          if (sections.length === 0) {
            if (!config.applyPatchFallback) {
              throw new PatchlineError("FALLBACK_REJECTED", "Classic apply_patch fallback is disabled. Use a snapshot-tagged Hashline section for existing files or enable applyPatchFallback.")
            }
            metrics.record({ name: "fallback" })
            const files = parseNewFilePatch(args.patchText)
            paths = files.map((file) => file.path)
            if (files.length === 0) throw new PatchlineError("INVALID_ARGUMENT", "Expected Hashline sections or classic new-file sections.")
            stage = "permission"
            progress(context, stage, `Patchline · ${files.length} new files`, { paths: files.map((file) => file.path) })
            await context.ask({ permission: "edit", patterns: files.map((file) => file.path), always: ["*"], metadata: { paths: files.map((file) => file.path) } })
            stage = "preflight"
            progress(context, stage, `Patchline · ${files.length} new files`, { paths: files.map((file) => file.path) })
            let remaining = DIFF_PREVIEW_BUDGET
            const previews = files.map((file) => {
              const preview = remaining > 0 ? diffPreview("/dev/null", `b/${file.path}`, "", file.content, remaining) : { patch: "", truncated: true }
              remaining -= preview.patch.length
              return { type: "add", path: file.path, relativePath: file.path, filePath: path.resolve(context.worktree, file.path), patch: preview.patch, diffTruncated: preview.truncated, additions: diffStats("", file.content).added, deletions: 0 }
            })
            const created = await writes.createBatch(files.map((file) => ({ worktree: context.worktree, filePath: file.path, content: file.content })), observe, context.abort)
            for (const result of created) metrics.record({ name: "write", path: result.path })
            applied = { writes: created.length, files: previews, added: previews.reduce((sum, file) => sum + file.additions, 0), deleted: 0 }
            stage = "validation"
            progress(context, stage, "Patchline · validation", { paths, ...applied })
            const validation = await validateMutation(context, paths)
            return { title: `Patchline · ${created.length} created`, output: boundedMutationOutput(`${created.map((result) => result.output).join("\n")}${validation.reason ? `\n${validation.reason}` : ""}`), metadata: { status: "applied", stage: "completed", paths, ...applied, ...validation } }
          }
          paths = [...new Set(sections.flatMap((section) => [section.path, ...(section.fileOp?.kind === "move" ? [section.fileOp.dest] : [])]))]
          stage = "permission"
          progress(context, stage, `Patchline · ${sections.length} sections`, { paths })
          await context.ask({ permission: "edit", patterns: paths, always: ["*"], metadata: { paths } })
          stage = "preflight"
          progress(context, stage, `Patchline · ${sections.length} sections`, { paths })
          const results = await edits.applyHashline(scope(context), args.patchText, observe, context.abort)
          for (const result of results) metrics.record({ name: "edit", path: result.path, added: result.added, deleted: result.deleted })
          const files = editFiles(results, context.worktree, "patch")
          applied = { writes: results.length, paths, files, added: results.reduce((sum, item) => sum + item.added, 0), deleted: results.reduce((sum, item) => sum + item.deleted, 0) }
          stage = "validation"
          progress(context, stage, "Patchline · validation", applied)
          const validation = await validateMutation(context, paths)
          return { title: `Patchline · ${results.length} patched`, output: boundedMutationOutput(`${results.map((result) => result.output).join("\n\n")}${validation.reason ? `\n${validation.reason}` : ""}`), metadata: { status: "applied", stage: "completed", ...applied, ...validation } }
          } catch (error) {
            failure(context, error, stage, undefined, { paths: [...new Set(paths)], ...applied, ...(stage === "validation" ? { status: "applied", validation: "failed", recoveryAction: "Changes were applied. Inspect diagnostics and re-read before retrying." } : {}) })
            throw toolError(error)
          }
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
          try {
            progress(context, "permission", "Patchline · literal search", { kind: "search", pattern: args.pattern, path: args.path })
            await context.ask({ permission: "grep", patterns: [args.pattern], always: ["*"] , metadata: { pattern: args.pattern, path: args.path } })
            progress(context, "searching", "Patchline · literal search", { kind: "search", pattern: args.pattern, path: args.path })
            const result = await grepWorkspace({ worktree: context.worktree, pattern: args.pattern, path: args.path, include: args.include, maxResults: args.maxResults ?? config.maxSearchResults })
            metrics.record({ name: "grep", lines: result.matches.length })
            const skipped = result.skippedCount > 0 ? `\nSkipped ${result.skippedCount} file(s): ${[...new Set(result.skipped.map((item) => item.reason))].join(", ")}.` : ""
            const output = boundedSearchOutput(result.matches.length === 0 ? "No matches found." : `${result.matches.map((match) => `${path.relative(context.worktree, match.path)}:${match.line}: ${match.text}`).join("\n")}${result.truncated ? "\nResults truncated." : ""}`, skipped)
            return { title: `Patchline · ${result.matches.length} matches`, output, metadata: { kind: "search", status: "observed", stage: "completed", pattern: args.pattern, path: args.path, resultCount: result.matches.length, skippedCount: result.skippedCount, truncated: result.truncated || output.includes("Results truncated") } }
          } catch (error) {
            failure(context, error, "searching", args.path, { kind: "search", writes: 0 })
            throw toolError(error)
          }
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
          try {
            progress(context, "permission", "Patchline · structural search", { kind: "search", pattern: args.pattern, path: args.filePath })
            await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
            progress(context, "searching", "Patchline · structural search", { kind: "search", pattern: args.pattern, path: args.filePath })
            const result = await astSearchFile({ worktree: context.worktree, filePath: args.filePath, pattern: args.pattern, language: args.language, maxResults: args.maxResults ?? config.maxSearchResults })
            metrics.record({ name: "ast_search", lines: result.matches.length })
            const output = result.matches.length === 0 ? "No structural matches found." : boundedSearchOutput(`${result.matches.map((match) => `${match.path}:${match.startLine}-${match.endLine}: ${match.text}`).join("\n")}${result.truncated ? "\nResults truncated." : ""}`)
            return { title: `Patchline · ${result.matches.length} structural matches`, output, metadata: { kind: "search", status: "observed", stage: "completed", path: args.filePath, pattern: args.pattern, language: args.language, resultCount: result.matches.length, truncated: result.truncated || output.includes("Results truncated") } }
          } catch (error) {
            failure(context, error, "searching", args.filePath, { kind: "search", writes: 0 })
            throw toolError(error)
          }
        },
      }),
      patchline_route_search: tool({
        description: "Choose the cheapest reliable search mechanism for a discovery request.",
        args: { query: tool.schema.string() },
        async execute(args) {
          const mechanism = routeSearch(args.query)
          return { title: `Patchline · ${mechanism.toUpperCase()}`, output: mechanism, metadata: { kind: "route", status: "observed", stage: "completed", mechanism, query: args.query } }
        },
      }),
      patchline_lsp: tool({
         description: "Use OpenCode's existing LSP integration for symbols and diagnostics. If unavailable, follow the capability instructions and use ast_search for structure or patchline_grep for literal text.",
        args: {
          operation: tool.schema.enum(["workspaceSymbol", "documentSymbol", "diagnostics"]),
          query: tool.schema.string().optional(),
          filePath: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const details = { kind: "lsp", operation: args.operation, query: args.query, path: args.filePath }
          try {
            progress(context, "permission", "Patchline · LSP", details)
            if (args.filePath) await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"], metadata: { path: args.filePath } })
            progress(context, "searching", "Patchline · LSP", details)
            let output: string | undefined
            if (args.operation === "workspaceSymbol" && args.query !== undefined) {
              try { output = await runOpenCodeLspClient(input.client, { worktree: context.worktree, query: args.query }) } catch (error) {
                if (!(error instanceof PatchlineError) || error.code !== "CAPABILITY_UNAVAILABLE") throw error
              }
            }
            output ??= await runOpenCodeLspBridge({ worktree: context.worktree, operation: args.operation, query: args.query, filePath: args.filePath, signal: context.abort })
            return { title: `Patchline · ${args.operation}`, output, metadata: { ...details, status: "observed", stage: "completed" } }
          } catch (error) {
            failure(context, error, "searching", args.filePath, { ...details, writes: 0 })
            throw toolError(error)
          }
        },
      }),
      ...(config.mode === "precision" ? { patchline_edit_batch: tool({
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
          const paths = args.edits.map((edit) => edit.filePath)
          let stage = "permission"
          let applied: Record<string, unknown> = {}
          try {
            progress(context, stage, `Patchline · ${paths.length} files`, { paths, total: paths.length })
            await context.ask({ permission: "edit", patterns: paths, always: ["*"], metadata: { paths } })
            stage = "preflight"
            progress(context, stage, `Patchline · ${paths.length} files`, { paths, total: paths.length })
            const requests: EditRequest[] = args.edits.map((edit) => ({
              ...scope(context),
              filePath: edit.filePath,
              snapshot: edit.snapshot,
              exact: { oldString: edit.oldString, newString: edit.newString, replaceAll: edit.replaceAll },
            }))
            const result = await edits.editBatch(requests, (nextStage) => {
              stage = nextStage
              progress(context, stage, `Patchline · ${paths.length} files`, { paths, total: paths.length })
            }, context.abort)
            const files = editFiles(result, context.worktree, "diff")
            applied = { writes: result.length, files, added: result.reduce((sum, item) => sum + item.added, 0), deleted: result.reduce((sum, item) => sum + item.deleted, 0) }
            stage = "validation"
            progress(context, stage, `Patchline · ${paths.length} files`, { paths, ...applied })
            const validation = await validateMutation(context, paths)
            return { title: `Patchline · ${result.length} files`, output: boundedMutationOutput(`${result.map((item) => item.output).join("\n\n")}${validation.reason ? `\n${validation.reason}` : ""}`), metadata: { status: "applied", stage: "completed", paths, ...applied, ...validation } }
          } catch (error) {
            failure(context, error, stage, paths.length === 1 ? paths[0] : undefined, { paths: [...new Set(paths)], ...applied, ...(stage === "validation" ? { status: "applied", validation: "failed", recoveryAction: "Changes were applied. Inspect diagnostics and re-read before retrying." } : {}) })
            throw toolError(error)
          }
        },
      }) } : {}),
      patchline_diagnostics: tool({
        description: "Run a configured targeted diagnostic command inside the worktree.",
        args: { command: tool.schema.string() },
        async execute(args, context) {
          try {
            progress(context, "permission", "Patchline · diagnostics", { kind: "diagnostics", command: args.command })
            await context.ask({ permission: "bash", patterns: [args.command], always: ["*"], metadata: { command: args.command, reason: "diagnostics" } })
            progress(context, "diagnostics", "Patchline · diagnostics", { kind: "diagnostics", command: args.command })
            const result = await runDiagnosticCommand(args.command, context.worktree, 120_000, config.maxDiagnostics, context.abort)
            metrics.record({ name: "diagnostics", details: { ok: result.ok } })
            return { title: result.ok ? "Patchline · diagnostics clean" : "Patchline · diagnostics failed", output: `${result.ok ? "Diagnostics clean." : `Diagnostics failed (${result.exitCode}).`}\n${result.output}`.trim(), metadata: { kind: "diagnostics", stage: "completed", status: "observed", command: args.command, exitCode: result.exitCode, ok: result.ok, outputLines: result.output ? result.output.split("\n").length : 0 } }
          } catch (error) {
            failure(context, error, "diagnostics", undefined, { kind: "diagnostics", command: args.command, writes: 0 })
            throw toolError(error)
          }
        },
      }),
      ...(config.summary ? { patchline_summary: tool({
        description: "Show a compact local Patchline activity summary for this plugin instance.",
        args: {},
        async execute() {
          if (!config.summary) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "Patchline summary is disabled by configuration.")
          const summary = metrics.summary()
          const counters = { reads: summary.read, edits: summary.edit, writes: summary.write, searches: summary.grep + summary.ast_search, diagnostics: summary.diagnostics, staleConflicts: summary.stale_conflict, writesPrevented: summary.write_prevented, fallbacks: summary.fallback }
          return { title: "Patchline · session summary", metadata: { kind: "summary", status: "observed", stage: "completed", summary: counters }, output: [
            "Patchline",
            `Reads: ${summary.read}`,
            `Edits: ${summary.edit}`,
            `Writes: ${summary.write}`,
            `Searches: ${summary.grep + summary.ast_search}`,
            `Diagnostics: ${summary.diagnostics}`,
            `Stale conflicts: ${summary.stale_conflict}`,
            `Writes prevented: ${summary.write_prevented}`,
            `Fallbacks: ${summary.fallback}`,
          ].join("\n") }
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
