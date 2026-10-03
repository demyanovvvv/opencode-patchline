export type ActivityStatus = "running" | "completed" | "failed"
export type ActivityKind = "read" | "mutation" | "search" | "route" | "lsp" | "diagnostics" | "summary"

export type ActivityLine = { kind: "hunk" | "added" | "removed" | "context"; text: string }
export type ActivityFile = { path: string; filetype: string; diff: string; additions: number; deletions: number; lines: ActivityLine[]; truncated: boolean }
export type ActivityView = {
  status: ActivityStatus
  kind: ActivityKind
  tool: string
  label: string
  paths: string[]
  totalFiles?: number | undefined
  hiddenFiles?: number | undefined
  writes?: number | undefined
  restored?: string[] | undefined
  conflicts?: string[] | undefined
  additions?: number | undefined
  deletions?: number | undefined
  reason?: string | undefined
  recoveryAction?: string | undefined
  validation?: string | undefined
  lines?: number | undefined
  bytes?: number | undefined
  snapshot?: string | undefined
  matchCount?: number | undefined
  truncated?: boolean | undefined
  query?: string | undefined
  pattern?: string | undefined
  language?: string | undefined
  mechanism?: string | undefined
  operation?: string | undefined
  exitCode?: number | undefined
  outputLines?: number | undefined
  command?: string | undefined
  summary?: Record<string, number> | undefined
  files?: ActivityFile[] | undefined
}

type ToolState = {
  status: "running" | "completed" | "error"
  error?: string | undefined
  metadata?: Record<string, unknown> | undefined
}

type ToolCall = { tool: string; input?: Record<string, unknown>; state: ToolState }


const stageLabels: Record<string, string> = {
  permission: "Waiting for permission",
  preflight: "Checking snapshots",
  validation: "Validating changes",
  committing: "Writing changes",
  rollback: "Restoring changes",
  completed: "Completed",
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function recordValue(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === "number" && Number.isFinite(item)))
  return Object.keys(record).length > 0 ? record : undefined
}

function filetypeFor(filePath: string): string {
  const extension = filePath.toLowerCase().split(".").pop() ?? ""
  const types: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
    json: "json", jsonc: "json", css: "css", scss: "scss", md: "markdown", py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", rb: "ruby", yaml: "yaml", yml: "yaml", sh: "bash",
  }
  return types[extension] ?? "text"
}

function pathsFrom(metadata: Record<string, unknown>): string[] {
  if (Array.isArray(metadata.paths)) return metadata.paths.filter((item): item is string => typeof item === "string")
  const path = stringValue(metadata.path)
  return path ? [path] : []
}

function diffLines(diff: unknown): { lines: ActivityLine[]; truncated: boolean } {
  if (typeof diff !== "string") return { lines: [], truncated: false }
  const lines: ActivityLine[] = []
  let offset = 0
  let inHunk = false
  while (offset < diff.length && lines.length < 12) {
    const end = diff.indexOf("\n", offset)
    const text = diff.slice(offset, end === -1 ? undefined : end)
    offset = end === -1 ? diff.length : end + 1
    if (text.startsWith("@@")) inHunk = true
    if (!inHunk) continue
    const kind = text.startsWith("@@") ? "hunk" : text.startsWith("+") ? "added" : text.startsWith("-") ? "removed" : "context"
    lines.push({ kind, text })
  }
  return { lines, truncated: offset < diff.length }
}

export function patchlineActivity(calls: readonly ToolCall[]): ActivityView | undefined {
  const supported = new Set(["read", "edit", "write", "apply_patch", "patchline_execute", "patchline_edit_batch", "patchline_grep", "ast_search", "patchline_route_search", "patchline_lsp", "patchline_diagnostics", "patchline_summary"])
  let call: ToolCall | undefined
  for (let index = calls.length - 1; index >= 0; index--) {
    const item = calls[index]!
    if (!supported.has(item.tool)) continue
    call ??= item
    if (item.state.status === "running") {
      call = item
      break
    }
  }
  if (!call) return undefined
  const metadata = { ...(call.state.metadata ?? {}) }
  if (call.tool === "edit" && (typeof metadata.diff === "string" || metadata.diffTruncated) && call.input?.filePath && metadata.files === undefined) {
    metadata.files = [{ path: call.input.filePath, diff: metadata.diff, diffTruncated: metadata.diffTruncated, additions: metadata.added, deletions: metadata.deleted }]
  }
  const paths = pathsFrom(metadata)
  if (paths.length === 0 && typeof call.input?.filePath === "string") paths.push(call.input.filePath)
  const totalFiles = Array.isArray(metadata.files) ? metadata.files.length : paths.length
  const hiddenFiles = Math.max(0, totalFiles - 4)
  const files = Array.isArray(metadata.files)
    ? metadata.files.slice(0, 4).flatMap((item): ActivityFile[] => {
        if (!item || typeof item !== "object") return []
        const file = item as Record<string, unknown>
        const path = stringValue(file.path) ?? stringValue(file.relativePath)
        if (!path) return []
        const diff = stringValue(file.diff ?? file.patch) ?? ""
        const parsed = diffLines(diff)
        return [{ path, filetype: filetypeFor(path), diff, additions: numberValue(file.additions) ?? 0, deletions: numberValue(file.deletions) ?? 0, lines: parsed.lines, truncated: parsed.truncated || file.diffTruncated === true }]
      })
    : undefined
  if (paths.length === 0 && files?.length) paths.push(...files.map((file) => file.path))
  const additions = numberValue(metadata.added) ?? files?.reduce((sum, file) => sum + file.additions, 0)
  const deletions = numberValue(metadata.deleted) ?? files?.reduce((sum, file) => sum + file.deletions, 0)
  const writes = numberValue(metadata.writes)
  const mutationTools = new Set(["edit", "write", "apply_patch", "patchline_edit_batch"])
  const kind: ActivityKind = mutationTools.has(call.tool)
    ? "mutation"
    : call.tool === "read" ? "read"
    : call.tool === "patchline_route_search" ? "route"
    : call.tool === "patchline_lsp" ? "lsp"
    : call.tool === "patchline_diagnostics" ? "diagnostics"
    : call.tool === "patchline_summary" ? "summary"
    : "search"
  const common = {
    kind, tool: call.tool, paths, totalFiles, hiddenFiles, writes, additions, deletions, files,
    lines: numberValue(metadata.lines), bytes: numberValue(metadata.bytesRendered), snapshot: stringValue(metadata.snapshot),
    matchCount: numberValue(metadata.resultCount) ?? numberValue(metadata.matches), truncated: booleanValue(metadata.truncated),
    query: stringValue(metadata.query) ?? stringValue(call.input?.query), pattern: stringValue(metadata.pattern) ?? stringValue(call.input?.pattern),
    language: stringValue(metadata.language) ?? stringValue(call.input?.language), mechanism: stringValue(metadata.mechanism), operation: stringValue(metadata.operation) ?? stringValue(call.input?.operation),
    exitCode: numberValue(metadata.exitCode), outputLines: numberValue(metadata.outputLines), command: stringValue(metadata.command), summary: recordValue(metadata.summary) ?? recordValue(metadata),
  }
  if (call.state.status === "running") {
    const stage = stringValue(metadata.stage) ?? "preflight"
    const label = kind === "mutation" ? stageLabels[stage] ?? "Processing changes" : activityLabel(call.tool, metadata, true)
    return { ...common, status: "running", label }
  }
  if (call.state.status === "error" || metadata.validation === "failed" || (kind === "diagnostics" && metadata.ok === false)) {
    const batch = call.tool === "patchline_edit_batch" || call.tool === "apply_patch"
    const rejected = writes === 0 && (metadata.stage === "permission" || metadata.stage === "preflight")
    return {
      ...common,
      status: "failed",
      label: kind === "mutation" ? metadata.validation === "failed" && writes !== undefined && writes > 0 ? "Changes applied · validation failed" : `${batch ? "Batch" : "Edit"} ${rejected ? "rejected" : "failed"}` : activityLabel(call.tool, metadata, false),
      restored: Array.isArray(metadata.restored) ? metadata.restored.filter((item): item is string => typeof item === "string") : undefined,
      conflicts: Array.isArray(metadata.conflicts) ? metadata.conflicts.filter((item): item is string => typeof item === "string") : undefined,
      reason: stringValue(metadata.reason) ?? call.state.error,
      recoveryAction: stringValue(metadata.recoveryAction), validation: stringValue(metadata.validation),
    }
  }
  return { ...common, status: "completed", label: kind === "mutation" ? "Changes applied" : activityLabel(call.tool, metadata, false), validation: stringValue(metadata.validation) }
}

function activityLabel(tool: string, metadata: Record<string, unknown>, running: boolean): string {
  if (tool === "read") return running ? "Reading file" : "Snapshot created"
  if (tool === "patchline_grep") return "Literal search"
  if (tool === "ast_search") return "Structural search"
  if (tool === "patchline_route_search") return "Search route"
  if (tool === "patchline_lsp") {
    const operation = stringValue(metadata.operation)
    return operation === "documentSymbol" ? "Document symbols" : operation === "diagnostics" ? "LSP diagnostics" : "Workspace symbols"
  }
  if (tool === "patchline_diagnostics") return running ? "Running diagnostics" : metadata.exitCode === 0 ? "Diagnostics clean" : "Diagnostics failed"
  if (tool === "patchline_summary") return "Session summary"
  return running ? "Processing" : "Completed"
}