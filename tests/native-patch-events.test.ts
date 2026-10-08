import { expect, it } from "vitest"
import { PatchlinePlugin } from "../src/plugin.js"

it("counts native context failures once per call without retaining source", async () => {
  const root = process.cwd()
  const hooks = await PatchlinePlugin({ directory: root, worktree: root } as never)
  const event = { type: "message.part.updated", properties: { part: { id: "part", sessionID: "s", callID: "call", type: "tool", tool: "apply_patch", state: { status: "error", error: "Failed to find expected lines in secret.ts: private source", input: { patchText: "private source" } } } } }
  await hooks.event?.({ event } as never)
  await hooks.event?.({ event } as never)
  await hooks.event?.({ event: { ...event, properties: { part: { ...event.properties.part, callID: "other", tool: "edit" } } } } as never)
  await hooks.event?.({ event: { ...event, properties: { part: { ...event.properties.part, callID: "syntax", state: { ...event.properties.part.state, error: "apply_patch verification failed: invalid envelope" } } } } } as never)
  const context = { sessionID: "s", messageID: "m", agent: "test", directory: root, worktree: root, abort: new AbortController().signal, metadata() {}, async ask() {} }
  const summary = await hooks.tool!.patchline_summary!.execute({}, context)
  expect(summary).toMatchObject({ metadata: { summary: { nativePatchContextMismatches: 1 } } })
  expect(JSON.stringify(summary)).not.toContain("private source")
  await hooks.dispose?.()
})

it("ignores malformed events and bounds deduplication state", async () => {
  const hooks = await PatchlinePlugin({ directory: process.cwd(), worktree: process.cwd() } as never)
  for (const event of [undefined, {}, { type: "message.part.updated" }, { type: "message.part.updated", properties: { part: { type: "text" } } }]) await hooks.event?.({ event } as never)
  await hooks.event?.({ event: { type: "message.part.updated", properties: { part: { type: "tool", tool: "apply_patch", state: { status: "error", error: "Failed to find expected lines" } } } } } as never)
  for (let i = 0; i < 1_100; i++) await hooks.event?.({ event: { type: "message.part.updated", properties: { part: { id: `part-${i}`, sessionID: "bounded", callID: `call-${i}`, type: "tool", tool: "apply_patch", state: { status: "error", error: "Failed to find expected lines" } } } } } as never)
  const context = { sessionID: "bounded", messageID: "m", agent: "test", directory: process.cwd(), worktree: process.cwd(), abort: new AbortController().signal, metadata() {}, async ask() {} }
  const summary = await hooks.tool!.patchline_summary!.execute({}, context)
  expect(summary).toMatchObject({ metadata: { summary: { nativePatchContextMismatches: 1_100 } } })
  await hooks.dispose?.()
})
