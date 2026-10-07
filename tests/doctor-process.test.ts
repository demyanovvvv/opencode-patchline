import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }))
import { commandVersion } from "../src/compatibility.js"

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

it("terminates a hung capability probe within its deadline", async () => {
  vi.useFakeTimers()
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  mocks.spawn.mockReturnValue(child)
  const pending = commandVersion("probe", ["--version"], 50)
  await vi.advanceTimersByTimeAsync(50)
  expect(child.kill).toHaveBeenCalledWith("SIGKILL")
  await expect(pending).resolves.toBeUndefined()
})

it("terminates a capability probe that exceeds the output budget", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  mocks.spawn.mockReturnValue(child)
  const pending = commandVersion("probe", ["--version"])
  child.stdout.write("x".repeat(20_000))
  expect(child.kill).toHaveBeenCalledWith("SIGKILL")
  await expect(pending).resolves.toBeUndefined()
})

it("terminates the Windows probe process tree", async () => {
  if (process.platform !== "win32") return
  vi.useFakeTimers()
  const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  const killer = new EventEmitter()
  mocks.spawn.mockImplementation((command: string) => command === "taskkill.exe" ? killer : child)
  const pending = commandVersion("probe", ["--version"], 50)
  await vi.advanceTimersByTimeAsync(50)
  expect(mocks.spawn).toHaveBeenCalledWith("taskkill.exe", ["/pid", "12345", "/T", "/F"], expect.anything())
  let settled = false
  void pending.then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  killer.emit("close", 0)
  await expect(pending).resolves.toBeUndefined()
})
