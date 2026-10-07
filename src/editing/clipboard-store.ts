type Clipboard = { named?: Map<string, readonly string[]> }

export class ClipboardStore {
  private readonly entries = new Map<string, { value: Clipboard; usedAt: number }>()
  constructor(private readonly now = Date.now) {}
  get(key: string): Clipboard {
    const now = this.now()
    for (const [scope, entry] of this.entries) if (now - entry.usedAt > 3_600_000) this.entries.delete(scope)
    let bytes = 0
    for (const entry of this.entries.values()) for (const lines of entry.value.named?.values() ?? []) for (const line of lines) bytes += 2 * line.length + 8
    while (bytes > 64 * 1024 * 1024 && this.entries.size) {
      const oldest = this.entries.keys().next().value!
      const entry = this.entries.get(oldest)!
      for (const lines of entry.value.named?.values() ?? []) for (const line of lines) bytes -= 2 * line.length + 8
      this.entries.delete(oldest)
    }
    const entry = this.entries.get(key) ?? { value: {}, usedAt: now }
    entry.usedAt = now
    this.entries.delete(key)
    this.entries.set(key, entry)
    while (this.entries.size > 512) this.entries.delete(this.entries.keys().next().value!)
    return entry.value
  }
  clear(): void { this.entries.clear() }
  get size(): number { return this.entries.size }
}
