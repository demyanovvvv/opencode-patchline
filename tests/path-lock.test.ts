import { expect, it } from "vitest"
import { withPathLocks } from "../src/writing/path-lock.js"

it("serializes overlapping paths across sessions without blocking disjoint paths", async () => {
  const events: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const first = withPathLocks(["a", "b"], async () => { events.push("first"); await gate })
  const second = withPathLocks(["b", "a"], async () => { events.push("second") })
  await withPathLocks(["c"], async () => { events.push("disjoint") })
  expect(events.sort()).toEqual(["disjoint", "first"])
  release()
  await Promise.all([first, second])
  expect(events.at(-1)).toBe("second")
})
