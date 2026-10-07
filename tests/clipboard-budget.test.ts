import { expect, it } from "vitest"
import { assertClipboardBudget } from "../src/editing/hashline-adapter.js"

it("limits retained clipboard data and register count", () => {
  expect(() => assertClipboardBudget({ named: new Map([["large", ["x".repeat(4 * 1024 * 1024 + 1)]]]) })).toThrow(/budget/i)
  expect(() => assertClipboardBudget({ named: new Map(Array.from({ length: 257 }, (_, i) => [`r${i}`, ["x"]])) })).toThrow(/register/i)
  expect(() => assertClipboardBudget({ named: new Map([["small", ["x"]]]) })).not.toThrow()
})
