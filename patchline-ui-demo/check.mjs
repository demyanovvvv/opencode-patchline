import assert from "node:assert/strict"
import { calculateTotal, formatTotal } from "./pricing.mjs"

const items = [{ price: 25, quantity: 2 }, { price: 50, quantity: 1 }]

assert.equal(formatTotal(100), "$100.00", "Currency formatting")
assert.equal(calculateTotal(items), 100, "Total without discount")
assert.equal(calculateTotal(items, 10), 90, "Total with a 10% discount")
assert.equal(calculateTotal([]), 0, "Empty cart")
assert.equal(calculateTotal(items, -10), 100, "Negative discount is clamped")
assert.equal(calculateTotal(items, 150), 0, "Discount is capped at 100%")

console.log("Patchline UI demo: все 6 проверок прошли")