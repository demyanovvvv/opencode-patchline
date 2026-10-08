import { normalizedIdentity } from "../workspace/paths.js"

const queues = new Map<string, Promise<void>>()

/** Process-wide canonical-path serialization; sorted acquisition avoids deadlock. */
export async function withPathLocks<T>(paths: readonly string[], operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const releases: Array<() => void> = []
  try {
    for (const key of [...new Set(paths.map(normalizedIdentity))].sort()) {
      const previous = queues.get(key)
      let release!: () => void
      const current = new Promise<void>((resolve) => { release = resolve })
      queues.set(key, current)
      releases.push(() => { void Promise.resolve(previous).then(() => { release(); if (queues.get(key) === current) queues.delete(key) }) })
      if (signal && previous) {
        let abort!: () => void
        try {
          await Promise.race([previous, new Promise<never>((_resolve, reject) => {
            abort = () => reject(signal.reason)
            signal.addEventListener("abort", abort, { once: true })
          })])
        } finally { signal.removeEventListener("abort", abort) }
      } else await previous
      signal?.throwIfAborted()
    }
    signal?.throwIfAborted()
    return await operation()
  } finally { for (const release of releases.reverse()) release() }
}
