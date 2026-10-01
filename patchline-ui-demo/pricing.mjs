export function calculateTotal(items, discountPercent = 0) {
  const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0)
  const discount = Math.min(100, Math.max(0, discountPercent))
  return subtotal * (1 - discount / 100)
}

export function formatTotal(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
}