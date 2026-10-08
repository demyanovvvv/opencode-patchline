export type MetricName =
  | "read"
  | "edit"
  | "write"
  | "grep"
  | "ast_search"
  | "stale_conflict"
  | "write_prevented"
  | "fallback"
  | "diagnostics"
  | "native_patch_context_mismatch"

export type MetricEvent = {
  name: MetricName
  at: number
  durationMs?: number | undefined
  path?: string | undefined
  lines?: number | undefined
  bytes?: number | undefined
  added?: number | undefined
  deleted?: number | undefined
  details?: Record<string, string | number | boolean> | undefined
}

export class LocalMetrics {
  readonly #events: MetricEvent[] = []
  readonly #counts: Record<MetricName, number> = {
    read: 0,
    edit: 0,
    write: 0,
    grep: 0,
    ast_search: 0,
    stale_conflict: 0,
    write_prevented: 0,
    fallback: 0,
    diagnostics: 0,
    native_patch_context_mismatch: 0,
  }
  readonly #maxEvents: number
  readonly #enabled: boolean

  constructor(options: { maxEvents?: number; enabled?: boolean } = {}) {
    const maxEvents = options.maxEvents ?? 1_000
    this.#maxEvents = maxEvents
    this.#enabled = options.enabled ?? true
  }

  record(event: Omit<MetricEvent, "at">): void {
    this.#counts[event.name]++
    if (!this.#enabled) return
    this.#events.push({ ...event, at: Date.now() })
    if (this.#events.length > this.#maxEvents) this.#events.splice(0, this.#events.length - this.#maxEvents)
  }

  snapshot(): readonly MetricEvent[] {
    return this.#events.slice()
  }

  summary(): Record<MetricName, number> {
    return { ...this.#counts }
  }
}
