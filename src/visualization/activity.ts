export type ActivityStatus = "running" | "completed" | "failed"

export type ActivityLine = { kind: "hunk" | "added" | "removed" | "context"; text: string }
export type ActivityFile = { path: string; additions: number; deletions: number; lines: ActivityLine[]; truncated: boolean }
export type ActivityView = {
  status: ActivityStatus
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
  let call: ToolCall | undefined
  for (let index = calls.length - 1; index >= 0; index--) {
    const item = calls[index]!
    if (item.tool !== "edit" && item.tool !== "write" && item.tool !== "apply_patch" && item.tool !== "patchline_edit_batch") continue
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
        const parsed = diffLines(file.diff ?? file.patch)
        return [{ path, additions: numberValue(file.additions) ?? 0, deletions: numberValue(file.deletions) ?? 0, lines: parsed.lines, truncated: parsed.truncated || file.diffTruncated === true }]
      })
    : undefined
  if (paths.length === 0 && files?.length) paths.push(...files.map((file) => file.path))
  const additions = numberValue(metadata.added) ?? files?.reduce((sum, file) => sum + file.additions, 0)
  const deletions = numberValue(metadata.deleted) ?? files?.reduce((sum, file) => sum + file.deletions, 0)
  const writes = numberValue(metadata.writes)
  if (call.state.status === "running") {
    const stage = stringValue(metadata.stage) ?? "preflight"
    return { status: "running", label: stageLabels[stage] ?? "Processing changes", paths, totalFiles, hiddenFiles, writes, additions, deletions, files }
  }
  if (call.state.status === "error" || metadata.validation === "failed") {
    const batch = call.tool === "patchline_edit_batch" || call.tool === "apply_patch"
    const rejected = writes === 0 && (metadata.stage === "permission" || metadata.stage === "preflight")
    return {
      status: "failed",
      label: metadata.validation === "failed" && writes !== undefined && writes > 0 ? "Changes applied · validation failed" : `${batch ? "Batch" : "Edit"} ${rejected ? "rejected" : "failed"}`,
      paths, writes, additions, deletions, files,
      restored: Array.isArray(metadata.restored) ? metadata.restored.filter((item): item is string => typeof item === "string") : undefined,
      conflicts: Array.isArray(metadata.conflicts) ? metadata.conflicts.filter((item): item is string => typeof item === "string") : undefined,
      reason: stringValue(metadata.reason) ?? call.state.error,
      recoveryAction: stringValue(metadata.recoveryAction), validation: stringValue(metadata.validation), totalFiles, hiddenFiles,
    }
  }
  return { status: "completed", label: "Changes applied", paths, validation: stringValue(metadata.validation), totalFiles, hiddenFiles, writes, additions, deletions, files }
}