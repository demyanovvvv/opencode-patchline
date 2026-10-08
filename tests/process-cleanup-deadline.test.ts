import { EventEmitter } from "node:events"
import { afterEach, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: mock.spawn }))
import { terminateProcessTree } from "../src/validation/diagnostics.js"
afterEach(() => vi.useRealTimers())
it("bounds Windows taskkill cleanup itself", async () => {
  if (process.platform !== "win32") return
  vi.useFakeTimers()
  const killer = Object.assign(new EventEmitter(), { kill: vi.fn() })
  mock.spawn.mockReturnValue(killer)
  const child = { pid: 12345, kill: vi.fn() }
  let done = false
  const pending = terminateProcessTree(child as never).then(() => { done = true })
  await vi.advanceTimersByTimeAsync(2000)
  expect(done).toBe(true)
  expect(killer.kill).toHaveBeenCalled()
  expect(child.kill).toHaveBeenCalled()
  await pending
})
