import { expect, it } from "vitest"
import { ClipboardStore } from "../src/editing/clipboard-store.js"

it("expires idle clipboard state and limits total scopes", () => {
  let now = 0
  const store = new ClipboardStore(() => now)
  const first = store.get("first")
  first.named = new Map([["value", ["line"]]])
  now = 3_600_001
  expect(store.get("first").named).toBeUndefined()
  for (let i = 0; i < 513; i++) store.get(`scope-${i}`)
  expect(store.size).toBe(512)
  store.get("one").named = new Map([["large", ["x".repeat(20 * 1024 * 1024)]]])
  store.get("two").named = new Map([["large", ["x".repeat(20 * 1024 * 1024)]]])
  store.get("three")
  expect(store.get("one").named).toBeUndefined()
})
