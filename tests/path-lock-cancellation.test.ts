import { expect, it } from "vitest"
import { withPathLocks } from "../src/writing/path-lock.js"

it("cancels queued locks without letting a later waiter overtake the holder", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const holder = withPathLocks(["cancel-path"], () => gate)
  const controller = new AbortController()
  const cancelled = withPathLocks(["cancel-path"], async () => { throw new Error("must not enter") }, controller.signal)
  controller.abort()
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
  let entered = false
  const later = withPathLocks(["cancel-path"], async () => { entered = true })
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(entered).toBe(false)
  release()
  await Promise.all([holder, later])
})
