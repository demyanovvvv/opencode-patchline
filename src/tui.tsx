/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { patchlineActivity, type ActivityFile, type ActivityLine, type ActivityView } from "./visualization/activity.js"

function FileDiff(props: { file: ActivityFile; api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  return (
    <box gap={0}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme().text} wrapMode="none">{props.file.path}</text>
        <text fg={theme().textMuted}>+{props.file.additions} −{props.file.deletions}</text>
      </box>
      <For each={props.file.lines}>
        {(line: ActivityLine) => <text fg={line.kind === "added" ? theme().diffHighlightAdded : line.kind === "removed" ? theme().diffHighlightRemoved : line.kind === "hunk" ? theme().diffHunkHeader : theme().textMuted} wrapMode="none">{line.text}</text>}
      </For>
      <Show when={props.file.truncated}><text fg={theme().textMuted}>… preview truncated</text></Show>
    </box>
  )
}

function Activity(props: { api: TuiPluginApi; session_id: string }) {
  const spinnerFrames = ["◌", "◍", "◉", "◎"]
  const [spinner, setSpinner] = createSignal(0)
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
  const theme = () => props.api.theme.current
  return (
    <Show when={view()}>
      {(activity: () => ActivityView) => (
        <box border={["left"]} borderColor={theme().borderSubtle} paddingLeft={1} gap={1}>
          <text fg={activity().status === "failed" ? theme().error : activity().status === "completed" ? theme().success : theme().primary}>
            {activity().status === "running" ? spinnerFrames[spinner()] : activity().status === "failed" ? "✕" : "✓"} Patchline · {activity().label}
          </text>
          <For each={activity().paths.slice(0, 4)}>{(file) => <text fg={theme().textMuted} wrapMode="none">{file}</text>}</For>
          <Show when={(activity().hiddenFiles ?? 0) > 0}><text fg={theme().textMuted}>… {activity().hiddenFiles} more files</text></Show>
          <Show when={activity().writes !== undefined || activity().validation !== undefined}><text fg={theme().textMuted}>Writes: {activity().writes ?? 0}{activity().validation ? ` · Validation: ${activity().validation?.replaceAll("_", " ")}` : ""}</text></Show>
          <Show when={activity().status === "failed"}>
            <text fg={theme().error}>{activity().reason}</text>
            <Show when={activity().writes === 0}><text fg={theme().textMuted}>No files changed</text></Show>
            <For each={activity().restored?.slice(0, 4)}>{(file) => <text fg={theme().textMuted}>Restored: {file}</text>}</For>
            <For each={activity().conflicts?.slice(0, 4)}>{(file) => <text fg={theme().error}>Preserved conflict: {file}</text>}</For>
            <Show when={activity().recoveryAction}><text fg={theme().textMuted}>{activity().recoveryAction}</text></Show>
            <For each={activity().files?.slice(0, 4)}>{(file) => <FileDiff api={props.api} file={file} />}</For>
          </Show>
          <Show when={activity().status === "completed"}>
            <For each={activity().files?.slice(0, 4)}>{(file) => <FileDiff api={props.api} file={file} />}</For>
          </Show>
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