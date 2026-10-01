import assert from "node:assert/strict"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { PatchlineTui } from "../dist/tui.js"

const [parts, setParts] = createSignal([])
let slot
const api = {
  state: { session: { messages: () => [{ id: "message" }] }, part: () => parts() },
  theme: { current: Object.fromEntries(["text", "textMuted", "primary", "success", "error", "borderSubtle", "diffHighlightAdded", "diffHighlightRemoved", "diffHunkHeader"].map((key) => [key, "#ffffff"])) },
  slots: { register: (registration) => { slot = registration.slots.sidebar_content } },
}
await PatchlineTui(api)
const screen = await testRender(() => slot({}, { session_id: "session" }), { width: 100, height: 40 })
try {
  await screen.renderOnce()
  assert.doesNotMatch(screen.captureCharFrame(), /Patchline/)
  setParts([{ type: "tool", tool: "edit", state: { status: "running", input: { filePath: "src/example.ts" }, metadata: { stage: "preflight" } } }])
  await screen.renderOnce()
  assert.match(screen.captureCharFrame(), /Checking snapshots/)
  const runningFrame = screen.captureCharFrame()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await screen.renderOnce()
  assert.notEqual(screen.captureCharFrame(), runningFrame, "running indicator should animate")
  setParts([{ type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "src/example.ts" }, metadata: { status: "applied", writes: 1, added: 1, deleted: 1, diff: "@@ -1 +1 @@\n-old\n+new" } } }])
  await screen.renderOnce()
  assert.match(screen.captureCharFrame(), /Changes applied/)
  assert.match(screen.captureCharFrame(), /\+new/)
  assert.match(screen.captureCharFrame(), /Writes: 1/)
  setParts([{ type: "tool", tool: "write", state: { status: "completed", input: { filePath: "created.ts" }, metadata: { writes: 1, validation: "not_configured", paths: ["created.ts"] } } }])
  await screen.renderOnce()
  assert.match(screen.captureCharFrame(), /created.ts/)
  assert.match(screen.captureCharFrame(), /Validation: not configured/)
  setParts([{ type: "tool", tool: "edit", state: { status: "error", input: { filePath: "src/example.ts" }, error: "validation denied", metadata: { stage: "validation", validation: "failed", writes: 1, reason: "validation denied", diff: "@@ -1 +1 @@\n-old\n+new" } } }])
  await screen.renderOnce()
  assert.match(screen.captureCharFrame(), /Changes applied · validation failed/)
  assert.match(screen.captureCharFrame(), /\+new/)
  assert.doesNotMatch(screen.captureCharFrame(), /No files changed/)
  setParts([{ type: "tool", tool: "patchline_edit_batch", state: { status: "error", input: {}, error: "rollback conflict", metadata: { stage: "rollback", writes: 2, restored: ["restored.ts"], conflicts: ["external.ts"] } } }])
  await screen.renderOnce()
  assert.match(screen.captureCharFrame(), /Restored: restored.ts/)
  assert.match(screen.captureCharFrame(), /Preserved conflict: external.ts/)
  assert.doesNotMatch(screen.captureCharFrame(), /No files changed/)
  setParts([{ type: "tool", tool: "edit", state: { status: "running", input: { filePath: "active.ts" }, metadata: { stage: "committing" } } }])
  await screen.renderOnce()
  assert.match(screen.captureCharFrame(), /Writing changes/)
} finally {
  screen.renderer.destroy()
}
console.log("TUI smoke passed (mounted renderer, reactive progress, diff and validation failure)")