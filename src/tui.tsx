/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { SyntaxStyle } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { patchlineActivity, type ActivityFile, type ActivityView } from "./visualization/activity.js"

function Disclosure(props: { api: TuiPluginApi; label: string; onToggle: () => void }) {
  const [hover, setHover] = createSignal(false)
  const theme = () => props.api.theme.current
  return <box marginTop={1} paddingLeft={1} paddingRight={1} backgroundColor={hover() ? theme().backgroundMenu : theme().backgroundElement} onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)} onMouseUp={(event) => {
    if (event.button !== 0 || props.api.renderer?.getSelection()?.getSelectedText()) return
    event.stopPropagation()
    props.onToggle()
  }}><text fg={hover() ? theme().text : theme().textMuted}>{props.label}</text></box>
}

function ResultOutput(props: { api: TuiPluginApi; output: string }) {
  const [limit, setLimit] = createSignal(12)
  const lines = createMemo(() => props.output.slice(0, 20_000).split("\n"))
  createEffect(() => { props.output; setLimit(12) })
  return <box marginTop={1} paddingLeft={1} backgroundColor={props.api.theme.current.backgroundElement}>
    <text fg={props.api.theme.current.textMuted}>Result</text>
    <text marginTop={1} fg={props.api.theme.current.text} wrapMode="word">{lines().slice(0, limit()).join("\n")}</text>
    <Show when={lines().length > limit()}><Disclosure api={props.api} label={`Show ${Math.min(12, lines().length - limit())} more lines ↓ (${lines().length - limit()} hidden)`} onToggle={() => setLimit((value) => value + 12)} /></Show>
    <Show when={limit() > 12}><Disclosure api={props.api} label="Show fewer lines ↑" onToggle={() => setLimit(12)} /></Show>
    <Show when={props.output.length > 20_000}><text fg={props.api.theme.current.textMuted}>… result preview truncated</text></Show>
  </box>
}
function FileDiff(props: { file: ActivityFile; expanded: boolean; onToggle: () => void; api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [hunkLimit, setHunkLimit] = createSignal(1)
  const hunks = createMemo(() => props.file.diff.split(/(?=^@@ )/m))
  const visibleDiff = createMemo(() => {
    const header = hunks()[0]?.startsWith("@@ ") ? 0 : 1
    return hunks().slice(0, hunkLimit() + header).join("")
  })
  const hunkCount = createMemo(() => hunks().filter((hunk) => hunk.startsWith("@@ ")).length)
  createEffect(() => { props.file.diff; setHunkLimit(1) })
  const styles = new Set<SyntaxStyle>()
  const syntax = createMemo(() => {
    const value = theme()
    const style = SyntaxStyle.fromStyles({
      default: { fg: value.text }, comment: { fg: value.syntaxComment }, keyword: { fg: value.syntaxKeyword },
      function: { fg: value.syntaxFunction }, variable: { fg: value.syntaxVariable }, string: { fg: value.syntaxString },
      number: { fg: value.syntaxNumber }, type: { fg: value.syntaxType }, operator: { fg: value.syntaxOperator }, punctuation: { fg: value.syntaxPunctuation },
    })
    styles.add(style)
    return style
  })
  onCleanup(() => { void props.api.renderer?.idle().catch(() => {}).finally(() => { for (const style of styles) style.destroy() }) })
  return (
    <box gap={0} marginTop={1}>
      <box flexDirection="row" justifyContent="space-between" gap={1} backgroundColor={theme().backgroundElement} paddingLeft={1} paddingRight={1}>
        <text fg={theme().text} wrapMode="word" flexShrink={1}>{props.file.path}</text>
        <text flexShrink={0}><span style={{ fg: theme().diffAdded }}>+{props.file.additions}</span> <span style={{ fg: theme().diffRemoved }}>−{props.file.deletions}</span></text>
      </box>
      <Show when={props.expanded}>
        <diff
          diff={visibleDiff()}
          view="unified"
          filetype={props.file.filetype}
          syntaxStyle={syntax()}
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
        <Show when={hunkCount() > hunkLimit()}><Disclosure api={props.api} label={`Show next change ↓ (${hunkCount() - hunkLimit()} hidden)`} onToggle={() => setHunkLimit((value) => value + 1)} /></Show>
        <Show when={hunkLimit() > 1}><Disclosure api={props.api} label="Show fewer changes ↑" onToggle={() => setHunkLimit(1)} /></Show>
      </Show>
      <Disclosure api={props.api} label={props.expanded ? "Hide file ↑" : "Show file ↓"} onToggle={props.onToggle} />
    </box>
  )
}
function Summary(props: { activity: ActivityView; api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const confidence = props.activity.confidence
  return <box gap={0}>
    <Show when={props.activity.kind === "mutation"}>
      <Show when={props.activity.strategy}><text fg={theme().textMuted}>Strategy: {props.activity.strategy}{props.activity.requestedStrategy && props.activity.requestedStrategy !== props.activity.strategy ? ` · requested ${props.activity.requestedStrategy}` : ""}</text></Show>
      <Show when={confidence !== undefined && confidence !== null}><text fg={theme().textMuted}>Confidence: {Math.round(confidence! * 100)}%</text></Show>
      <Show when={props.activity.reason}><text fg={theme().textMuted}>Route: {props.activity.reason}</text></Show>
      <Show when={props.activity.recoveryAction}><text fg={theme().textMuted}>Recovery: {props.activity.recoveryAction}</text></Show>
    </Show>
    <Show when={props.activity.kind === "read"}><text fg={theme().textMuted}>{props.activity.lines ?? 0} lines · {props.activity.bytes ?? 0} bytes</text><Show when={props.activity.snapshot}><text fg={theme().textMuted}>Snapshot: {props.activity.snapshot}</text></Show></Show>
    <Show when={props.activity.kind === "search"}><text fg={theme().textMuted}>{props.activity.matchCount ?? 0} matches{props.activity.language ? ` · ${props.activity.language}` : ""}</text><Show when={props.activity.pattern}><text fg={theme().textMuted}>Pattern: {props.activity.pattern}</text></Show></Show>
    <Show when={props.activity.kind === "route"}><text fg={theme().textMuted}>Selected: {props.activity.mechanism ?? "unknown"}</text><Show when={props.activity.query}><text fg={theme().textMuted}>Query: {props.activity.query}</text></Show></Show>
    <Show when={props.activity.kind === "lsp"}><text fg={theme().textMuted}>{props.activity.operation ?? "LSP"}{props.activity.query ? ` · ${props.activity.query}` : ""}</text></Show>
    <Show when={props.activity.kind === "diagnostics"}><text fg={theme().textMuted}>Exit code: {props.activity.exitCode ?? "unknown"}{props.activity.outputLines !== undefined ? ` · ${props.activity.outputLines} lines` : ""}</text></Show>
    <Show when={props.activity.kind === "summary" && props.activity.summary}><For each={Object.entries(props.activity.summary ?? {})}>{([key, value]) => <box flexDirection="row" gap={2}><text width={20} fg={theme().textMuted}>{key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())}</text><text fg={value ? theme().text : theme().textMuted}>{value}</text></box>}</For></Show>
  </box>
}

function Activity(props: { api: TuiPluginApi; session_id?: string; part?: ToolPart }) {
  const spinnerFrames = ["◌", "◍", "◉", "◎"]
  const [spinner, setSpinner] = createSignal(0)
  const [expanded, setExpanded] = createSignal(false)
  const output = createMemo(() => props.part?.state.status === "completed" ? props.part.state.output : "")
  const [collapsedFiles, setCollapsedFiles] = createSignal<Set<string>>(new Set())
  const view = createMemo(() => {
    const messages = props.part ? [] : props.api.state.session.messages(props.session_id!).slice(-80)
    const calls = props.part ? [props.part] : messages.flatMap((message) => props.api.state.part(message.id)).filter((part): part is ToolPart => part.type === "tool")
    return patchlineActivity(calls.map((call) => ({ tool: call.tool, input: call.state.input, state: { status: call.state.status === "pending" ? "running" : call.state.status as "running" | "completed" | "error", metadata: "metadata" in call.state ? call.state.metadata : undefined, error: call.state.status === "error" ? call.state.error : undefined } })))
  })
  const running = createMemo(() => view()?.status === "running")
  createEffect(() => {
    if (!running()) return
    setSpinner(0)
    const timer = setInterval(() => setSpinner((value) => (value + 1) % spinnerFrames.length), 120)
    onCleanup(() => clearInterval(timer))
  })
  const toggleAll = () => { setExpanded((value) => !value); setCollapsedFiles(new Set<string>()) }
  const toggleFile = (path: string) => setCollapsedFiles((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const theme = () => props.api.theme.current
  const statusColor = () => view()?.status === "failed" ? theme().error : view()?.status === "completed" ? theme().success : theme().warning
  return (
    <Show when={view()}>
      {(activity: () => ActivityView) => (
        <box border={["left"]} borderColor={statusColor()} backgroundColor={theme().backgroundPanel} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1} gap={0}>
          <box flexDirection="row" gap={1} marginBottom={1}>
            <text fg={theme().text} wrapMode="word" flexShrink={1}>
              <span style={{ fg: statusColor() }}>{activity().status === "running" ? spinnerFrames[spinner()] : activity().status === "failed" ? "✕" : "✓"}</span> Patchline · {activity().label}
            </text>
          </box>
          <Show when={activity().additions !== undefined || activity().deletions !== undefined || activity().writes !== undefined}>
            <text fg={theme().textMuted}>{activity().totalFiles ?? activity().paths.length} files · <span style={{ fg: theme().diffAdded }}>+{activity().additions ?? 0}</span> <span style={{ fg: theme().diffRemoved }}>−{activity().deletions ?? 0}</span> · {activity().writes ?? 0} writes{activity().strategy ? ` · ${activity().strategy}` : ""}</text>
          </Show>
          <For each={activity().paths.slice(0, 4)}>{(file) => <Show when={!activity().files?.some((item) => item.path === file)}><text fg={theme().text} wrapMode="word">{file}</text></Show>}</For>
          <Show when={activity().kind === "mutation" && (activity().strategy || activity().requestedStrategy || activity().reason)}>
            <Show when={activity().kind === "mutation" && (activity().strategy || activity().requestedStrategy || activity().reason)}><Summary activity={activity()} api={props.api} /></Show>
          <Show when={activity().kind !== "mutation"}><Summary activity={activity()} api={props.api} /></Show>
          </Show>
          <Show when={(activity().hiddenFiles ?? 0) > 0}><text fg={theme().textMuted}>… {activity().hiddenFiles} more files</text></Show>
          <Show when={activity().writes !== undefined || activity().validation !== undefined}><text marginTop={1} fg={activity().validation === "failed" ? theme().error : activity().validation === "passed" ? theme().success : theme().textMuted}>Validation: {activity().validation?.replaceAll("_", " ") ?? "pending"}</text></Show>
          <Show when={activity().status === "failed"}>
            <text fg={theme().error}>{activity().reason}</text>
            <Show when={activity().writes === 0}><text fg={theme().textMuted}>No files changed</text></Show>
            <For each={activity().restored?.slice(0, 4)}>{(file) => <text fg={theme().textMuted}>Restored: {file}</text>}</For>
            <For each={activity().conflicts?.slice(0, 4)}>{(file) => <text fg={theme().error}>Preserved conflict: {file}</text>}</For>
            <Show when={activity().recoveryAction}><text fg={theme().textMuted}>{activity().recoveryAction}</text></Show>
          </Show>
          <Show when={!expanded()}><For each={activity().files?.slice(0, 4)}>{(file) => <text fg={theme().text} wrapMode="word">{file.path}</text>}</For></Show>
          <Show when={expanded()}>
            <For each={activity().files?.slice(0, 4)}>{(file) => <FileDiff api={props.api} file={file} expanded={!collapsedFiles().has(file.path)} onToggle={() => toggleFile(file.path)} />}</For>
            <Show when={output() && !activity().files?.length}><ResultOutput api={props.api} output={output()} /></Show>
          </Show>
          <Show when={activity().files?.length || output()}><Disclosure api={props.api} label={expanded() ? "Hide details ↑" : "Show details ↓"} onToggle={toggleAll} /></Show>
        </box>
      )}
    </Show>
  )
}

export const PatchlineTui: TuiPlugin = async (api) => {
  const slots = Object.fromEntries(["read", "edit", "write", "apply_patch", "patchline_edit_batch", "patchline_grep", "ast_search", "patchline_route_search", "patchline_lsp", "patchline_diagnostics", "patchline_summary"].map((tool) => [`tool_${tool}`, (_context: unknown, props: { part: ToolPart }) => <Activity api={api} part={props.part} />]))
  api.slots.register({ order: 510, slots: { ...slots, sidebar_content(_context, props) {
    return <Activity api={api} session_id={props.session_id} />
  } } })
}

const module: TuiPluginModule = { id: "opencode-patchline-tui", tui: PatchlineTui }
export default module