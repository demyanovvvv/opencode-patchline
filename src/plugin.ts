import path from "node:path"
import { realpath } from "node:fs/promises"
import { diffPreview, DIFF_PREVIEW_BUDGET } from "./visualization/diff-preview.js"
import { diffStats } from "./editing/diff.js"
import { editFiles } from "./visualization/edit-files.js"
import type { Hooks, Plugin, PluginModule, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { parseConfig } from "./config.js"
import { EditService, type EditRequest } from "./edit-service.js"
import { routeEdit } from "./editing/router.js"
import { parseHashlinePatch } from "./editing/hashline-adapter.js"
import { errorMessage, PatchlineError } from "./errors.js"
import { looksLikeDirectShellWrite } from "./guards/files.js"
import { ReadService } from "./read-service.js"
import { astSearchFile } from "./search/ast.js"
import { grepWorkspace } from "./search/grep.js"
import { runOpenCodeLspBridge, runOpenCodeLspClient } from "./search/lsp.js"
import { configureProjectLsp, prepareProjectLsp, fingerprintLspReports, type LspConfiguration, type LspReport } from "./lsp/manager.js"
import { routeSearch } from "./search/router.js"
import { ScopedSnapshotStore } from "./snapshot/store.js"
import { LocalMetrics } from "./telemetry/metrics.js"
import { runDiagnosticCommand } from "./validation/diagnostics.js"
import { validationCommand } from "./validation/router.js"
import { WriteService } from "./write-service.js"
import { resolveWorkspacePath } from "./workspace/paths.js"

const MAX_SEARCH_OUTPUT_CHARS = 20_000
const MAX_PATCH_INPUT_BYTES = 8 * 1024 * 1024

function compactEditOutput(result: { output: string; diff: string; diffTruncated: boolean }): string {
  // Reuse the display-only preview; never clip a hunk or recompute a safety diff.
  if (result.diffTruncated || result.diff.length > 2_000) return `${result.output}\nDiff preview omitted: exceeds compact budget; inspect metadata or read a narrow range if needed.`
  return result.diff ? `${result.output}\n${result.diff}` : result.output
}

function compactEditsOutput(results: { output: string; diff: string; diffTruncated: boolean }[], validationFailed: boolean): string {
  const summaries = results.map((result) => result.output).join("\n\n")
  const previews = results.map(compactEditOutput).join("\n\n")
  // Leave room for diagnostics and never let the aggregate limiter split a hunk.
  return validationFailed || previews.length > 19_000
    ? `${summaries}\nDiff preview omitted: aggregate budget or failed validation; inspect metadata if needed.`
    : previews
}

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
- When the exact path is known, read that file directly using the smallest useful range; skip discovery searches.
- Locate only when the path or target is unknown; use available LSP for symbols, grep for text, and AST for structure.
- Read the smallest useful source range; when a unique literal target is known, use read with anchor and limit instead of grep followed by read. Do not combine anchor with offset; resolve ambiguous candidates before editing.
- Existing files edited through Patchline require a snapshot; preserve unrelated code.
- Use patchline_apply_patch for Hashline: [PATH#TAG] followed by PUT N.=M: and +TEXT payload rows, CUT N.=M, or PUT <N:/PUT >N: insertions.
- Select the editing tool by change scope, representation, and supported operations. File size alone does not select the editing tool; use ordinary apply_patch for changes beyond Patchline's limits or unsupported operations. Native patches do not require a Patchline snapshot.
- After a native patch, read changed files again before using Patchline snapshots.
- If native apply_patch reports "Failed to find expected lines", re-read the smallest affected range and rebuild the patch from the exact current lines, including line breaks. Do not repeat the same patch, guess context, or overwrite the file to bypass rejection.
- Line numbers refer to the original snapshot; every section requires the tag returned by read.
- Preserve unrelated code and formatting. If a snapshot is stale, reread before retrying.
- Call tools using JSON arguments, not prose or XML. Omit unused optional fields; newString: "" is an intentional deletion.
- Copy filePath and snapshot from the latest read; never invent a snapshot or tag. Use only the lines shown by read.
- Exact example (replace placeholders with the latest read): {"strategy":"exact","operations":[{"filePath":"src/example.ts","snapshot":"<snapshot from read>","oldString":"<observed text>","newString":"<replacement text>"}]}.
- Hashline example: patchline_apply_patch({"patchText":"[src/example.ts#<tag from read>]\\nPUT 1.=1:\\n+replacement"}). Choose an observed line number; the example is not a reusable anchor.
- Native apply_patch uses *** Begin Patch / *** Update File: path / @@ / -old / +new / *** End Patch, not Hashline PUT/CUT sections.
- Inspect tool results before the next call. On stale or invalid anchors, read again; on fallback_required, use the reported nextTool. Never bypass rejected edits with shell writes.
- Run relevant diagnostics and proportional validation after edits.`

function scope(context: ToolContext, permission = "edit") {
  return { sessionId: context.sessionID, worktree: context.worktree, authorizePath: async (filePath: string) => {
    const relative = path.relative(context.worktree, filePath)
    const external = path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)
    if (external) await context.ask({ permission: "external_directory", patterns: [filePath], always: [filePath], metadata: { path: filePath, worktree: context.worktree } })
    const pattern = external ? filePath : relative
    await context.ask({ permission, patterns: [pattern], always: [pattern], metadata: { path: filePath } })
  } }
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

function nativePatchContextMismatch(event: unknown): boolean {
  if (!event || typeof event !== "object") return false
  const value = event as { type?: unknown; properties?: { part?: { type?: unknown; tool?: unknown; state?: { status?: unknown; error?: unknown } } } }
  const part = value.properties?.part
  return value.type === "message.part.updated" && part?.type === "tool" && part.tool === "apply_patch" && part.state?.status === "error" && typeof part.state.error === "string" && /failed to find expected lines|context does not match/i.test(part.state.error)
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
  const policy = config.toolProfile === "compact" ? `PATCHLINE EDITING POLICY
- Known path: read directly; skip discovery. Otherwise use available LSP for symbols, grep for text, AST for structure.
- Read only needed lines. Use read with anchor for unique literal text: read({"filePath":"src/main.ts","anchor":"function main","limit":40}) replaces grep then read; omit offset. Resolve ambiguity first. Always supply filePath; omit unused fields.
- Preserve unrelated code/formatting. Patchline edits require the latest read snapshot and observed lines; never invent tags. If stale, reread.
- Choose tools by scope and supported operations. File size alone does not select the editing tool. Native apply_patch needs no Patchline snapshot; reread after native changes before Patchline edits.
- On native "Failed to find expected lines", reread the affected range and rebuild exact context/line breaks. Never repeat the same patch, guess, or overwrite to bypass rejection.
- Use JSON tool arguments. newString: "" intentionally deletes text.
- Run relevant diagnostics and proportional validation after edits.
${config.mode === "precision" ? '- Use edit with filePath, snapshot, oldString, newString; patchline_edit_batch for related edits.' : '- Use standard edit for local changes in compatibility mode.'}` : POLICY
  const snapshots = new ScopedSnapshotStore({ ttlMs: config.snapshotTtlMs, maxSnapshots: config.maxSnapshots, maxBytes: config.maxSnapshotBytes })
  const reads = new ReadService(snapshots, config.maxInitialReadLines)
  const edits = new EditService(snapshots, config)
  const writes = new WriteService(config)
  const metrics = new LocalMetrics({ enabled: config.telemetry })
  const nativeFailureCalls = new Set<string>()
  let lspConfiguration: LspConfiguration = {}
  let lspReports: LspReport[] = []
  let lspToolchainFingerprint = "[]"
  let lspConfigurationGeneration = 0
  let lspConfigurationContent = JSON.stringify(lspConfiguration.lsp)
  const supportsLspOperation = (operation: string) => lspReports.some((report) => report.verified && (
    operation === "documentSymbol" ? report.capabilities?.documentSymbolProvider :
      operation === "workspaceSymbol" ? report.capabilities?.workspaceSymbolProvider : false
  ))
  const lspOptions = { install: config.lspAutoInstall, maxEntries: config.lspMaxEntries, ...(config.lspStorageDirectory ? { storage: config.lspStorageDirectory } : {}) }

  async function validateMutation(context: ToolContext, paths: readonly string[]) {
    const commands = [...new Set(paths.map((filePath) => validationCommand(filePath, config)).filter((command): command is string => command !== undefined))]
    if (commands.length === 0) return { validation: "not_configured", diagnostics: undefined, reason: undefined }
    let ok = true
    const failures: string[] = []
    for (const command of commands) {
      await context.ask({ permission: "bash", patterns: [command], always: ["*"], metadata: { command, reason: "post-edit validation" } })
      const diagnostic = await runDiagnosticCommand(command, context.worktree, 120_000, config.maxDiagnostics, context.abort)
      if (!diagnostic.ok) {
        ok = false
        failures.push(`${command}: ${diagnostic.timedOut ? "timed out" : `exit ${diagnostic.exitCode ?? "unknown"}`}${diagnostic.output ? `\n${diagnostic.output}` : " (no output)"}`)
      }
    }
    return { validation: ok ? "passed" : "failed", diagnostics: ok, reason: ok ? undefined : boundedMutationOutput(`Validation failed: ${failures.join("\n")}`) }
  }

  const readTool = tool({
    description: 'Read a minimal existing source range and create a Patchline snapshot with stable line anchors. Always provide filePath. Choose offset OR anchor, never both. Example: {"filePath":"src/main.ts","offset":1,"limit":80}. Anchor example: {"filePath":"src/main.ts","anchor":"function main","limit":40}. Omit unused properties entirely.',
    args: {
      filePath: tool.schema.string().describe("Absolute or worktree-relative file path"),
      offset: tool.schema.number().int().min(1).optional().describe("First line, 1-based. Omit this property entirely when using anchor; do not supply a default offset."),
      anchor: tool.schema.string().min(1).optional().describe("Unique nonempty literal text; start at its line (LF-normalized). Omit this property entirely when using offset; do not supply an empty placeholder."),
      limit: tool.schema.number().int().min(1).optional().describe("Maximum lines; defaults to Patchline policy"),
    },
    async execute(args, context) {
      const started = Date.now()
      try {
            if (typeof args?.filePath !== "string" || !args.filePath.trim()) {
              throw new PatchlineError("INVALID_ARGUMENT", "Read requires a nonempty filePath string.")
            }
            progress(context, "permission", args.filePath, { kind: "read", path: args.filePath })
            await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
            progress(context, "reading", args.filePath, { kind: "read", path: args.filePath })
            const result = await reads.read({ ...scope(context, "read"), ...args })
            const lines = result.kind === "file" ? Math.max(0, result.endLine - result.offset + 1) : 0
            metrics.record({ name: "read", path: result.path, lines, bytes: result.output.length, durationMs: Date.now() - started, details: { totalLines: result.kind === "file" ? result.totalLines : result.totalEntries, selectedLines: lines, ...(result.kind === "file" ? { lineIndexReused: result.lineIndexReused } : {}) } })
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
                    requestedLimit: result.requestedLimit, nextOffset: result.nextOffset, truncated: result.truncated, endLine: result.endLine,
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
        failure(context, error, "reading", args?.filePath, { kind: "read", writes: 0 })
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
      if (config.toolProfile === "compact" && args.hashlinePatch !== undefined) throw new PatchlineError("INVALID_ARGUMENT", "Compact edit accepts exact strings only; use oldString and newString.")
      const hashlinePatch = args.hashlinePatch?.trim() ? args.hashlinePatch : undefined
      const exact = args.oldString !== undefined && args.newString !== undefined && !(hashlinePatch && args.oldString === "" && args.newString === "")
        ? { oldString: args.oldString, newString: args.newString, replaceAll: args.replaceAll }
        : undefined
      let stage = "permission"
      let applied: Record<string, unknown> = {}
      try {
        progress(context, stage, args.filePath, { path: args.filePath })
        await context.ask({ permission: "edit", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
        stage = "preflight"
        progress(context, stage, args.filePath, { path: args.filePath })
        const result = await edits.edit({ ...scope(context), filePath: args.filePath, snapshot: args.snapshot, exact, hashlinePatch }, (nextStage) => {
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
          output: config.toolProfile === "compact"
            ? boundedMutationOutput(`${validation.reason ? `${validation.reason}\n` : ""}${compactEditsOutput([result], !!validation.reason)}\nDiagnostics: ${validation.validation === "not_configured" ? "not configured; OpenCode native diagnostics may run" : validation.validation}`)
            : `${result.output}\nDiagnostics: ${validation.validation === "not_configured" ? "not configured; OpenCode native diagnostics may run" : validation.reason ?? "clean"}`,
          metadata: {
            ...applied,
            status: "applied",
            stage: "completed",
            recoveryAction: result.snapshot ? "Use the returned snapshot for the next edit." : "Changes applied without a retained snapshot. Re-read before the next edit.",
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
        const result = await writes.write({ ...scope(context), ...args }, context.abort)
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

  const hooks: Hooks = {
    async "tool.definition"(hookInput, output) {
      if (hookInput.toolID !== "read" || config.mode !== "precision") return
      const definition = output as typeof output & { jsonSchema?: Record<string, unknown> }
      if (definition.jsonSchema) {
        const schema = definition.jsonSchema
        const exclusion = { not: { required: ["anchor", "offset"] } }
        definition.jsonSchema = "not" in schema
          ? { allOf: [schema, exclusion] }
          : { ...schema, ...exclusion }
      }
    },
    async config(openCodeConfig) {
      const generation = ++lspConfigurationGeneration
      lspConfiguration = openCodeConfig as LspConfiguration
      lspConfigurationContent = JSON.stringify(lspConfiguration.lsp)
      lspReports = []
      if (lspConfiguration.lsp === false || config.toolProfile === "compact") {
        delete hooks.tool!.patchline_lsp
        delete hooks.tool!.patchline_lsp_status
      } else Object.assign(hooks.tool!, lspTools)
      if (lspConfiguration.lsp === false) return
      if (!config.lspAutoSetup) {
        if (config.toolProfile === "compact") delete hooks.tool!.patchline_lsp
        return
      }
      let reports: LspReport[]
      try { reports = await configureProjectLsp(input.worktree, lspConfiguration, lspOptions) }
      catch (error) {
        // A bounded scan or optional preparation failure must not prevent OpenCode startup.
        reports = [{ root: input.directory, server: "discovery", language: "unknown", sample: "", evidence: [], status: "failed", verified: false, detail: errorMessage(error) }]
      }
      if (generation !== lspConfigurationGeneration) return
      lspConfigurationContent = JSON.stringify(lspConfiguration.lsp)
      const preparedConfigurationContent = lspConfigurationContent
      const fingerprint = await fingerprintLspReports(reports)
      if (generation !== lspConfigurationGeneration || JSON.stringify(lspConfiguration.lsp) !== preparedConfigurationContent) return
      lspReports = reports
      lspToolchainFingerprint = fingerprint
      if (config.toolProfile === "compact") {
        const operations = (["workspaceSymbol", "documentSymbol"] as const).filter(supportsLspOperation)
        if (operations.length === 0) delete hooks.tool!.patchline_lsp
        else {
          const definition = lspTools.patchline_lsp!
          hooks.tool!.patchline_lsp = { ...definition, args: { ...definition.args, operation: tool.schema.enum(operations as [typeof operations[number], ...typeof operations[number][]]) } }
        }
      }
    },
    tool: {
      patchline_lsp_status: tool({
        description: "Show detected languages and LSP preparation state. Installed/configured does not mean a connection has been verified.",
        args: {},
        async execute(_args, context) {
          if (lspConfiguration.lsp === false) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "OpenCode LSP is disabled by configuration.")
          await context.ask({ permission: "read", patterns: ["**/*"], always: ["*"], metadata: { reason: "LSP project discovery" } })
          let generation = lspConfigurationGeneration
          const configuration = lspConfiguration
          const configurationContent = JSON.stringify(configuration.lsp)
          if (configuration.lsp === false) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "LSP is disabled in OpenCode configuration.")
          const sameRoot = await realpath(context.worktree) === await realpath(input.worktree)
          if (sameRoot && generation === lspConfigurationGeneration) {
            generation = ++lspConfigurationGeneration
            lspReports = []
          }
          const reports = await prepareProjectLsp(context.worktree, { ...lspOptions, install: false, configuration, signal: context.abort })
          context.abort.throwIfAborted()
          if (generation !== lspConfigurationGeneration || JSON.stringify(configuration.lsp) !== configurationContent) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "LSP configuration changed or status refresh was superseded. Retry status with the current configuration.")
          if (sameRoot && generation === lspConfigurationGeneration) {
            const fingerprint = await fingerprintLspReports(reports)
            context.abort.throwIfAborted()
            if (generation !== lspConfigurationGeneration || JSON.stringify(configuration.lsp) !== configurationContent) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "LSP configuration changed during refresh. Retry with the current configuration.")
            lspReports = reports
            lspToolchainFingerprint = fingerprint
            lspConfigurationContent = JSON.stringify(configuration.lsp)
            if (config.toolProfile === "compact") {
              const operations = (["workspaceSymbol", "documentSymbol"] as const).filter(supportsLspOperation)
              if (operations.length === 0) delete hooks.tool!.patchline_lsp
              else {
                const definition = lspTools.patchline_lsp!
                hooks.tool!.patchline_lsp = { ...definition, args: { ...definition.args, operation: tool.schema.enum(operations as [typeof operations[number], ...typeof operations[number][]]) } }
              }
            }
          }
          return JSON.stringify({ projects: reports, autoSetup: config.lspAutoSetup, autoInstall: config.lspAutoInstall }, null, 2)
        },
      }),
      ...(config.mode === "precision" ? {
        patchline_execute: tool({
          description: "Execute snapshot-safe edits with automatic exact, Hashline, batch, or standard-tool fallback selection.",
          args: {
            strategy: tool.schema.enum(["auto", "exact", "hashline", "batch", "standard"]).optional(),
            operations: tool.schema.array(tool.schema.object({
              filePath: tool.schema.string(),
              snapshot: tool.schema.string().describe("Snapshot ID or Hashline tag returned by read"),
              oldString: tool.schema.string().optional(),
              newString: tool.schema.string().optional(),
              replaceAll: tool.schema.boolean().optional(),
              hashlinePatch: tool.schema.string().optional(),
            })).min(1).max(500),
          },
          async execute(args, context) {
            if (args.strategy === "standard") return {
              title: "Patchline · standard tool required",
              output: "Use the ordinary apply_patch tool with a classic *** Begin Patch payload.",
              metadata: { status: "fallback_required", stage: "fallback", strategy: "standard", nextTool: "apply_patch", requestedStrategy: "standard", paths: [...new Set(args.operations.map((operation) => operation.filePath))], writes: 0, recoveryAction: "Use ordinary apply_patch, then re-read changed files before further Patchline edits." },
            }
            const operations = args.operations.map((operation) => {
              const hashlinePatch = operation.hashlinePatch?.trim() ? operation.hashlinePatch : undefined
              const unusedExact = hashlinePatch !== undefined && operation.oldString === "" && operation.newString === ""
              return { ...operation, hashlinePatch, oldString: unusedExact ? undefined : operation.oldString, newString: unusedExact ? undefined : operation.newString }
            })
            if (operations.some((operation) => operation.snapshot === undefined || operation.snapshot.length === 0)) {
              throw new PatchlineError("INVALID_ARGUMENT", "Each adaptive mutation operation requires the snapshot returned by read.")
            }
            const paths = [...new Set(operations.map((operation) => operation.filePath))]
            const exactOperations = operations.filter((operation) => operation.oldString !== undefined && operation.newString !== undefined)
            const hashlineOperations = operations.filter((operation) => operation.hashlinePatch !== undefined)
            if (operations.some((operation) => {
              const hasExactField = operation.oldString !== undefined || operation.newString !== undefined
              const hasExact = operation.oldString !== undefined && operation.newString !== undefined
              const hasHashline = operation.hashlinePatch !== undefined
              return hasExactField !== hasExact || hasExact === hasHashline
            })) {
              const error = new PatchlineError("INVALID_ARGUMENT", "Provide oldString/newString OR hashlinePatch, never both. Omit unused fields; an empty newString is a valid deletion.")
              failure(context, error, "preflight", paths[0], { paths, writes: 0 })
              throw toolError(error)
            }
            if (hashlineOperations.length > 0 && hashlineOperations.length !== operations.length) {
              throw new PatchlineError("INVALID_ARGUMENT", "Adaptive execution cannot mix exact and Hashline operations.")
            }
            if (String(args.strategy) === "patch") {
              throw new PatchlineError("INVALID_ARGUMENT", "Adaptive patch strategy is not supported; use apply_patch directly.")
            }
            const routingSnapshots = new Map<string, { text: string; totalLines: number }>()
            let changedLines = 0
            for (const operation of exactOperations) {
              const resolved = await resolveWorkspacePath(context.worktree, operation.filePath, scope(context).authorizePath)
              const snapshot = snapshots.get(scope(context), resolved.canonical, operation.snapshot!)
              if (!snapshot) continue
              routingSnapshots.set(resolved.canonical, { text: snapshot.text, totalLines: snapshot.lineIndex.totalLines })
              const oldString = operation.oldString!.replace(/\r\n?/g, "\n")
              const newString = operation.newString!.replace(/\r\n?/g, "\n")
              const projected = operation.replaceAll
                ? snapshot.text.split(oldString).join(newString)
                : snapshot.text.replace(oldString, () => newString)
              try {
                const stats = diffStats(snapshot.text, projected)
                changedLines += Math.max(stats.added, stats.deleted)
              } catch (error) {
                if (!(error instanceof PatchlineError) || error.code !== "STANDARD_TOOL_REQUIRED") throw error
                changedLines = Number.MAX_SAFE_INTEGER
                break
              }
            }
            const route = routeEdit({
              fileCount: paths.length,
              operationCount: operations.length,
              hasExact: exactOperations.length === operations.length,
              hasHashline: hashlineOperations.length > 0,
              hasPatch: false,
              requiresAtomicBatch: paths.length > 1,
              changedLines,
              totalLines: paths.length === 1 ? [...routingSnapshots.values()][0]?.totalLines ?? 0 : 0,
              payloadBytes: Buffer.byteLength(JSON.stringify(operations), "utf8"),
            })
            const selected = args.strategy === "auto" || args.strategy === undefined ? route.strategy : args.strategy
            progress(context, "planning", "Patchline · planning", { paths, strategy: selected, requestedStrategy: args.strategy ?? "auto", routeReason: route.reason, confidence: route.confidence })
            if (selected === "standard" || route.strategy === "standard") {
              if (args.strategy !== undefined && args.strategy !== "auto" && String(args.strategy) !== "standard") {
                throw new PatchlineError("STANDARD_TOOL_REQUIRED", "This change is too large for Patchline precision editing.", { details: { strategy: route.strategy, routeReason: route.reason, paths } })
              }
              return {
                title: "Patchline · standard tool required",
                output: "This operation exceeds Patchline precision limits. Use the ordinary apply_patch tool with a classic *** Begin Patch payload.",
                metadata: { status: "fallback_required", stage: "fallback", strategy: "standard", nextTool: "apply_patch", requestedStrategy: args.strategy ?? "auto", confidence: route.confidence, routeReason: route.reason, paths, writes: 0, recoveryAction: "Use ordinary apply_patch, then re-read changed files before further Patchline edits." },
              }
            }
            if (selected === "hashline") {
              if (hashlineOperations.length !== 1 || operations.length !== 1) throw new PatchlineError("INVALID_ARGUMENT", "Hashline adaptive execution currently accepts exactly one hashlinePatch operation.")
              let stage = "permission"
              try {
                const operation = hashlineOperations[0]!
                const sections = await splitHashlineSections(operation.hashlinePatch!)
                const declared = await resolveWorkspacePath(context.worktree, operation.filePath, scope(context).authorizePath)
                const declaredSnapshot = snapshots.get(scope(context), declared.canonical, operation.snapshot)
                for (const section of sections) {
                  const target = await resolveWorkspacePath(context.worktree, section.path, scope(context).authorizePath)
                  const targetSnapshot = snapshots.get(scope(context), target.canonical, section.tag)
                  if (!declaredSnapshot || declaredSnapshot !== targetSnapshot || declared.canonical !== target.canonical) throw new PatchlineError("INVALID_ARGUMENT", "Adaptive Hashline sections must match the declared filePath and snapshot. Use patchline_apply_patch for multiple files.", { path: section.path })
                }
                const actualPaths = [...new Set(sections.flatMap((section) => [section.path, ...(section.fileOp?.kind === "move" ? [section.fileOp.dest] : [])]))]
                await context.ask({ permission: "edit", patterns: actualPaths, always: ["*"], metadata: { paths: actualPaths, strategy: selected } })
                await context.ask({ permission: "edit", patterns: paths, always: ["*"], metadata: { paths, strategy: selected } })
                const result = await edits.applyHashline(scope(context), hashlineOperations[0]!.hashlinePatch!, (nextStage) => {
                  stage = nextStage
                  progress(context, stage, "Patchline · adaptive Hashline", { paths, strategy: selected })
                }, context.abort)
                const files = editFiles(result, context.worktree, "diff")
                const validation = await validateMutation(context, result.map((item) => item.path))
                return { title: "Patchline · adaptive Hashline", output: boundedMutationOutput(`${validation.reason ? `${validation.reason}\n` : ""}${result.map((item) => item.output).join("\n\n")}`), metadata: { status: "applied", stage: "completed", strategy: selected, confidence: route.confidence, routeReason: route.reason, writes: result.length, files, paths: result.map((item) => item.path), ...validation } }
              } catch (error) {
                failure(context, error, stage, paths[0], { paths, strategy: selected })
                throw toolError(error)
              }
            }
            if (exactOperations.length !== operations.length) throw new PatchlineError("INVALID_ARGUMENT", "Adaptive exact execution requires oldString and newString for every operation.")
            const requests: EditRequest[] = exactOperations.map((operation) => ({
              ...scope(context),
              filePath: operation.filePath,
              snapshot: operation.snapshot!,
              exact: { oldString: operation.oldString!, newString: operation.newString!, replaceAll: operation.replaceAll },
            }))
            let stage = "permission"
            try {
              await context.ask({ permission: "edit", patterns: paths, always: ["*"], metadata: { paths, strategy: selected } })
              stage = "preflight"
              const result = await edits.editBatch(requests, (nextStage) => {
                stage = nextStage
                progress(context, stage, `Patchline · adaptive ${selected}`, { paths, strategy: selected })
              }, context.abort)
              const files = editFiles(result, context.worktree, "diff")
              const validation = await validateMutation(context, paths)
              return { title: `Patchline · adaptive ${selected}`, output: boundedMutationOutput(`${validation.reason ? `${validation.reason}\n` : ""}${result.map((item) => item.output).join("\n\n")}`), metadata: { status: "applied", stage: "completed", strategy: selected, confidence: route.confidence, routeReason: route.reason, writes: result.length, paths, added: result.reduce((sum, item) => sum + item.added, 0), deleted: result.reduce((sum, item) => sum + item.deleted, 0), files, ...validation } }
            } catch (error) {
              failure(context, error, stage, paths.length === 1 ? paths[0] : undefined, { paths, strategy: selected })
              throw toolError(error)
            }
          },
        }),
        read: readTool,
        edit: editTool,
        write: writeTool,
        patchline_apply_patch: tool({
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
            const created = await writes.createBatch(files.map((file) => ({ ...scope(context), filePath: file.path, content: file.content })), observe, context.abort)
            for (const result of created) metrics.record({ name: "write", path: result.path })
            applied = { writes: created.length, files: previews, added: previews.reduce((sum, file) => sum + file.additions, 0), deleted: 0 }
            stage = "validation"
            progress(context, stage, "Patchline · validation", { paths, ...applied })
            const validation = await validateMutation(context, paths)
            return { title: `Patchline · ${created.length} created`, output: boundedMutationOutput(`${validation.reason ? `${validation.reason}\n` : ""}${created.map((result) => result.output).join("\n")}`), metadata: { status: "applied", stage: "completed", paths, ...applied, ...validation } }
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
          return { title: `Patchline · ${results.length} patched`, output: boundedMutationOutput(`${validation.reason ? `${validation.reason}\n` : ""}${results.map((result) => result.output).join("\n\n")}`), metadata: { status: "applied", stage: "completed", ...applied, ...validation } }
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
          const started = Date.now()
          try {
            progress(context, "permission", "Patchline · literal search", { kind: "search", pattern: args.pattern, path: args.path })
            await context.ask({ permission: "grep", patterns: [args.pattern], always: ["*"] , metadata: { pattern: args.pattern, path: args.path } })
            progress(context, "searching", "Patchline · literal search", { kind: "search", pattern: args.pattern, path: args.path })
            const result = await grepWorkspace({ ...scope(context, "read"), pattern: args.pattern, path: args.path, include: args.include, maxResults: args.maxResults ?? config.maxSearchResults, signal: context.abort })
            metrics.record({ name: "grep", lines: result.matches.length, durationMs: Date.now() - started, details: { skipped: result.skippedCount, truncated: result.truncated } })
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
          const started = Date.now()
          try {
            progress(context, "permission", "Patchline · structural search", { kind: "search", pattern: args.pattern, path: args.filePath })
            await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"] , metadata: { path: args.filePath } })
            progress(context, "searching", "Patchline · structural search", { kind: "search", pattern: args.pattern, path: args.filePath })
            const result = await astSearchFile({ ...scope(context, "read"), filePath: args.filePath, pattern: args.pattern, language: args.language, maxResults: args.maxResults ?? config.maxSearchResults, signal: context.abort })
            metrics.record({ name: "ast_search", lines: result.matches.length, durationMs: Date.now() - started, details: { truncated: result.truncated } })
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
          const generation = lspConfigurationGeneration
          const assertCurrent = async () => {
            context.abort.throwIfAborted()
            const fingerprint = await fingerprintLspReports(lspReports)
            context.abort.throwIfAborted()
            if (generation !== lspConfigurationGeneration) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "LSP configuration changed. Retry with the current capabilities.")
            if (fingerprint !== lspToolchainFingerprint) {
              lspConfigurationGeneration++
              lspReports = []
              lspToolchainFingerprint = "[]"
              if (config.toolProfile === "compact") delete hooks.tool!.patchline_lsp
              throw new PatchlineError("CAPABILITY_UNAVAILABLE", "LSP toolchain changed. Refresh capabilities before retrying.")
            }
            if (JSON.stringify(lspConfiguration.lsp) !== lspConfigurationContent) {
              lspConfigurationContent = JSON.stringify(lspConfiguration.lsp)
              lspConfigurationGeneration++
              lspReports = []
              if (config.toolProfile === "compact") delete hooks.tool!.patchline_lsp
            }
            if (generation !== lspConfigurationGeneration) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "LSP configuration changed. Retry with the current capabilities.")
          }
          try {
            await assertCurrent()
            if (lspConfiguration.lsp === false) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "OpenCode LSP is disabled by configuration.")
            if (config.toolProfile === "compact" && !supportsLspOperation(args.operation)) throw new PatchlineError("CAPABILITY_UNAVAILABLE", `No verified capability for LSP ${args.operation}; use available text/AST tools or configured diagnostics.`)
            progress(context, "permission", "Patchline · LSP", details)
            const resolvedFile = args.filePath ? await resolveWorkspacePath(context.worktree, args.filePath, scope(context, "read").authorizePath) : undefined
            if (config.toolProfile === "compact" && args.operation === "documentSymbol") {
              const projects = await Promise.all(lspReports.filter((report) => report.verified && report.capabilities?.documentSymbolProvider).map(async (report) => {
                try {
                  const root = await realpath(report.root)
                  const relative = resolvedFile ? path.relative(root, resolvedFile.canonical) : undefined
                  return relative !== undefined && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
                } catch { return false }
              }))
              if (!projects.some(Boolean)) throw new PatchlineError("CAPABILITY_UNAVAILABLE", "No verified document-symbol capability for this file's project; use available text/AST tools.")
            }
            if (args.filePath) await context.ask({ permission: "read", patterns: [args.filePath], always: ["*"], metadata: { path: args.filePath } })
            await assertCurrent()
            progress(context, "searching", "Patchline · LSP", details)
            let output: string | undefined
            if (args.operation === "workspaceSymbol" && args.query !== undefined) {
              try { output = await runOpenCodeLspClient(input.client, { worktree: context.worktree, query: args.query, signal: context.abort }) } catch (error) {
                if (!(error instanceof PatchlineError) || error.code !== "CAPABILITY_UNAVAILABLE") throw error
              }
            }
            try {
              await assertCurrent()
              output ??= await runOpenCodeLspBridge({ worktree: context.worktree, operation: args.operation, query: args.query, filePath: resolvedFile?.canonical, signal: context.abort, configuration: lspConfiguration })
            } catch (error) {
              if (config.toolProfile === "compact" && generation === lspConfigurationGeneration && error instanceof PatchlineError && error.code === "CAPABILITY_UNAVAILABLE" && await realpath(context.worktree) === await realpath(input.worktree)) {
                if (generation === lspConfigurationGeneration) {
                  lspReports = []
                  delete hooks.tool!.patchline_lsp
                }
              }
              throw error
            }
            await assertCurrent()
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
            return { title: `Patchline · ${result.length} files`, output: boundedMutationOutput(`${validation.reason ? `${validation.reason}\n` : ""}${config.toolProfile === "compact" ? compactEditsOutput(result, !!validation.reason) : result.map((item) => item.output).join("\n\n")}`), metadata: { status: "applied", stage: "completed", paths, ...applied, ...validation } }
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
            return { title: result.ok ? "Patchline · diagnostics clean" : result.timedOut ? "Patchline · diagnostics timed out" : "Patchline · diagnostics failed", output: `${result.ok ? "Diagnostics clean." : result.timedOut ? "Diagnostics incomplete: timeout." : `Diagnostics failed (${result.exitCode}).`}\n${result.output}`.trim(), metadata: { kind: "diagnostics", stage: "completed", status: "observed", command: args.command, exitCode: result.exitCode, ok: result.ok, timedOut: result.timedOut, outputLines: result.output ? result.output.split("\n").length : 0 } }
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
          const counters = { reads: summary.read, edits: summary.edit, writes: summary.write, searches: summary.grep + summary.ast_search, diagnostics: summary.diagnostics, staleConflicts: summary.stale_conflict, writesPrevented: summary.write_prevented, fallbacks: summary.fallback, nativePatchContextMismatches: summary.native_patch_context_mismatch }
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
      if (!output.system.includes(policy)) output.system.push(policy)
    },
    async "tool.execute.before"(hookInput, output) {
      if (hookInput.tool === "apply_patch") snapshots.clear()
      if (config.mode === "precision" && hookInput.tool === "bash" && config.guardShellWrites && typeof output.args?.command === "string" && looksLikeDirectShellWrite(output.args.command)) {
        throw new PatchlineError("FALLBACK_REJECTED", "Direct shell file writes are blocked in Patchline precision mode. Use write for new files or snapshot-anchored edit for existing files.")
      }
    },
    async "tool.execute.after"(hookInput) {
      if (hookInput.tool === "apply_patch") snapshots.clear()
    },
    async event(input) {
      if (!nativePatchContextMismatch(input.event)) return
      const event = input.event as { properties: { part: { sessionID: string; callID: string; id: string } } }
      const part = event.properties.part
      if (typeof part.sessionID !== "string" || typeof (part.callID ?? part.id) !== "string") return
      const key = `${part.sessionID}\0${part.callID ?? part.id}`
      if (nativeFailureCalls.has(key)) return
      nativeFailureCalls.add(key)
      while (nativeFailureCalls.size > 1000) nativeFailureCalls.delete(nativeFailureCalls.values().next().value!)
      metrics.record({ name: "native_patch_context_mismatch", details: { tool: "apply_patch" } })
    },
    async dispose() {
      snapshots.clear()
      nativeFailureCalls.clear()
    },
  }
  if (config.toolProfile === "compact") {
    if (hooks.tool!.edit === editTool) {
      const args = { ...editTool.args }
      delete (args as Partial<typeof args>).hashlinePatch
      hooks.tool!.edit = { ...editTool, description: "Apply a stale-safe exact string edit linked to a snapshot returned by read.", args }
    }
    for (const name of ["patchline_execute", "patchline_apply_patch", "patchline_route_search", "patchline_lsp_status", "patchline_summary"]) delete hooks.tool![name]
  }
  const lspTools = Object.fromEntries(["patchline_lsp", "patchline_lsp_status"].flatMap((name) => hooks.tool![name] ? [[name, hooks.tool![name]!]] : []))
  return hooks
}

const pluginModule: PluginModule = { id: "opencode-patchline", server: PatchlinePlugin }

export default pluginModule
