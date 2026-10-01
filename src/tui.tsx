/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { patchlineActivity, type ActivityFile, type ActivityView } from "./visualization/activity.js"

function FileDiff(props: { file: ActivityFile; expanded: boolean; onToggle: () => void; api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  return (
    <box gap={0} border={["left"]} borderColor={props.expanded ? theme().borderActive : theme().borderSubtle} paddingLeft={1}>
      <box flexDirection="row" justifyContent="space-between" onMouseUp={(event) => { if (event.button === 0) { event.stopPropagation(); props.onToggle() } }} focusable={true}>
        <text fg={props.expanded ? theme().text : theme().textMuted} wrapMode="none">{props.expanded ? "▾" : "▸"} {props.file.path}</text>
        <text fg={theme().textMuted}>+{props.file.additions} −{props.file.deletions}</text>
      </box>
      <Show when={props.expanded}>
        <diff
          diff={props.file.diff}
          view="unified"
          filetype={props.file.filetype}
          showLineNumbers={true}
          wrapMode="none"
          lineNumberFg={theme().diffLineNumber}
          lineNumberBg={theme().backgroundPanel}
          addedBg={theme().diffAddedBg}
          removedBg={theme().diffRemovedBg}
          contextBg={theme().diffContextBg}
          addedContentBg={theme().diffAddedBg}
          removedContentBg={theme().diffRemovedBg}
          contextContentBg={theme().diffContextBg}
          addedSignColor={theme().diffAdded}
          removedSignColor={theme().diffRemoved}
          addedLineNumberBg={theme().diffAddedLineNumberBg}
          removedLineNumberBg={theme().diffRemovedLineNumberBg}
          flexGrow={1}
        />
        <Show when={props.file.truncated}><text fg={theme().textMuted}>… diff preview truncated</text></Show>
      </Show>
    </box>
  )
}
function Summary(props: { activity: ActivityView; api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  return <box gap={0}>
    <Show when={props.activity.kind === "read"}><text fg={theme().textMuted}>{props.activity.lines ?? 0} lines · {props.activity.bytes ?? 0} bytes</text><Show when={props.activity.snapshot}><text fg={theme().textMuted}>Snapshot: {props.activity.snapshot}</text></Show></Show>
    <Show when={props.activity.kind === "search"}><text fg={theme().textMuted}>{props.activity.matchCount ?? 0} matches{props.activity.language ? ` · ${props.activity.language}` : ""}</text><Show when={props.activity.pattern}><text fg={theme().textMuted}>Pattern: {props.activity.pattern}</text></Show></Show>
    <Show when={props.activity.kind === "route"}><text fg={theme().textMuted}>Selected: {props.activity.mechanism ?? "unknown"}</text><Show when={props.activity.query}><text fg={theme().textMuted}>Query: {props.activity.query}</text></Show></Show>
    <Show when={props.activity.kind === "lsp"}><text fg={theme().textMuted}>{props.activity.operation ?? "LSP"}{props.activity.query ? ` · ${props.activity.query}` : ""}</text></Show>
    <Show when={props.activity.kind === "diagnostics"}><text fg={theme().textMuted}>Exit code: {props.activity.exitCode ?? "unknown"}{props.activity.outputLines !== undefined ? ` · ${props.activity.outputLines} lines` : ""}</text></Show>
    <Show when={props.activity.kind === "summary" && props.activity.summary}><For each={Object.entries(props.activity.summary ?? {})}>{([key, value]) => <text fg={theme().textMuted}>{key}: {value}</text>}</For></Show>
  </box>
}

function Activity(props: { api: TuiPluginApi; session_id: string }) {
  const spinnerFrames = ["◌", "◍", "◉", "◎"]
  const [spinner, setSpinner] = createSignal(0)
  const [expanded, setExpanded] = createSignal(false)
  const [expandedFiles, setExpandedFiles] = createSignal<Set<string>>(new Set())
  const view = createMemo(() => {
    const messages = props.api.state.session.messages(props.session_id).slice(-80)
    const calls = messages.flatMap((message) => props.api.state.part(message.id)).filter((part): part is ToolPart => part.type === "tool")
    return patchlineActivity(calls.filter((call) => call.state.status !== "pending").map((call) => ({ tool: call.tool, input: call.state.input, state: { status: call.state.status as "running" | "completed" | "error", metadata: "metadata" in call.state ? call.state.metadata : undefined, error: call.state.status === "error" ? call.state.error : undefined } })))
  })
  const running = createMemo(() => view()?.status === "running")
  createEffect(() => {
    if (!running()) return
    setSpinner(0)
    const timer = setInterval(() => setSpinner((value) => (value + 1) % spinnerFrames.length), 120)
    onCleanup(() => clearInterval(timer))
  })
  const toggleAll = () => setExpanded((value) => !value)
  const toggleFile = (path: string) => setExpandedFiles((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const theme = () => props.api.theme.current
  return (
    <Show when={view()}>
      {(activity: () => ActivityView) => (
        <box border={["left"]} borderColor={expanded() ? theme().borderActive : theme().borderSubtle} paddingLeft={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between" onMouseUp={(event) => { if (event.button === 0) toggleAll() }} focusable={true}>
            <text fg={activity().status === "failed" ? theme().error : activity().status === "completed" ? theme().success : theme().primary} wrapMode="none">
              {activity().status === "running" ? spinnerFrames[spinner()] : activity().status === "failed" ? "✕" : "✓"} Patchline · {activity().label}
            </text>
            <text fg={theme().textMuted}>{expanded() ? "▾" : "▸"}</text>
          </box>
          <Show when={activity().additions !== undefined || activity().deletions !== undefined || activity().writes !== undefined}>
            <text fg={theme().textMuted}>{activity().totalFiles ?? activity().paths.length} files · +{activity().additions ?? 0} −{activity().deletions ?? 0} · {activity().writes ?? 0} writes</text>
          </Show>
          <Summary activity={activity()} api={props.api} />
          <For each={activity().paths.slice(0, 4)}>{(file) => <Show when={!activity().files?.some((item) => item.path === file)}><text fg={theme().textMuted} wrapMode="none">{file}</text></Show>}</For>
          <Show when={(activity().hiddenFiles ?? 0) > 0}><text fg={theme().textMuted}>… {activity().hiddenFiles} more files</text></Show>
          <Show when={activity().writes !== undefined || activity().validation !== undefined}><text fg={theme().textMuted}>Validation: {activity().validation?.replaceAll("_", " ") ?? "pending"}</text></Show>
          <Show when={activity().status === "failed"}>
            <text fg={theme().error}>{activity().reason}</text>
            <Show when={activity().writes === 0}><text fg={theme().textMuted}>No files changed</text></Show>
            <For each={activity().restored?.slice(0, 4)}>{(file) => <text fg={theme().textMuted}>Restored: {file}</text>}</For>
            <For each={activity().conflicts?.slice(0, 4)}>{(file) => <text fg={theme().error}>Preserved conflict: {file}</text>}</For>
            <Show when={activity().recoveryAction}><text fg={theme().textMuted}>{activity().recoveryAction}</text></Show>
          </Show>
          <Show when={activity().files && (expanded() || activity().status === "failed")}>
            <For each={activity().files?.slice(0, 4)}>{(file) => <FileDiff api={props.api} file={file} expanded={expandedFiles().has(file.path) || expanded()} onToggle={() => toggleFile(file.path)} />}</For>
          </Show>
          <Show when={activity().files?.length && !expanded() && activity().status === "completed"}><text fg={theme().textMuted}>Click to view changes</text></Show>
        </box>
      )}
    </Show>
  )
}

export const PatchlineTui: TuiPlugin = async (api) => {
  api.slots.register({ order: 510, slots: { sidebar_content(_context, props) {
    return <Activity api={api} session_id={props.session_id} />
  } } })
}

const module: TuiPluginModule = { id: "opencode-patchline-tui", tui: PatchlineTui }
export default module