import { describe, expect, it } from "vitest"
import { encodeUtf8, decodeUtf8 } from "../src/preservation/text.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"

describe("ScopedSnapshotStore", () => {
  it("evicts least-recently-used snapshots within a byte quota", () => {
    const store = new ScopedSnapshotStore({ maxBytes: 30 })
    const scope = { sessionId: "s", worktree: "/w" }
    const first = store.record(scope, "/w/a.ts", "a.ts", decodeUtf8(Buffer.from("aaaa")), [])
    store.record(scope, "/w/b.ts", "b.ts", decodeUtf8(Buffer.from("bbbb")), [])
    store.get(scope, "/w/a.ts", first.id)
    store.record(scope, "/w/c.ts", "c.ts", decodeUtf8(Buffer.from("cccc")), [])
    expect(store.size).toBe(2)
    expect(store.bytes).toBeLessThanOrEqual(30)
    expect(store.get(scope, "/w/a.ts", first.id)).toBeDefined()
    store.clear()
    expect(store.bytes).toBe(0)
  })

  it("shares identical documents across snapshots without merging observation scopes", () => {
    const store = new ScopedSnapshotStore({ maxBytes: 30 })
    const scope = { sessionId: "s", worktree: "/w" }
    const first = store.record(scope, "/w/a.ts", "a.ts", decodeUtf8(Buffer.from("same")), [1])
    const second = store.record({ ...scope, sessionId: "other" }, "/w/b.ts", "b.ts", decodeUtf8(Buffer.from("same")), [])
    expect(second.document).toBe(first.document)
    expect(second.seenLines.size).toBe(0)
    expect(store.bytes).toBe(12)
    store.invalidate("/w/a.ts")
    expect(store.bytes).toBe(12)
    store.invalidate("/w/b.ts")
    expect(store.bytes).toBe(0)
  })
  it("reuses the pooled line index for identical document digests", () => {
    const store = new ScopedSnapshotStore()
    const scope = { sessionId: "s", worktree: "/w" }
    const first = store.record(scope, "/w/a.ts", "a.ts", decodeUtf8(Buffer.from("first\nsecond\n")), [1])
    const second = store.record({ ...scope, sessionId: "other" }, "/w/b.ts", "b.ts", decodeUtf8(Buffer.from("first\nsecond\n")), [2])

    expect(second.document).toBe(first.document)
    expect(second.lineIndex).toBe(first.lineIndex)
    expect(second.seenLines).not.toBe(first.seenLines)
  })

  it("creates a different line index when the document digest changes", () => {
    const store = new ScopedSnapshotStore()
    const scope = { sessionId: "s", worktree: "/w" }
    const first = store.record(scope, "/w/a.ts", "a.ts", decodeUtf8(Buffer.from("first\n")), [])
    const second = store.record(scope, "/w/a.ts", "a.ts", decodeUtf8(Buffer.from("changed\n")), [])

    expect(second.lineIndex).not.toBe(first.lineIndex)
  })

  it("reports pooled line-index reuse by document digest", () => {
    const store = new ScopedSnapshotStore()
    const document = decodeUtf8(Buffer.from("first\nsecond\n"))

    const first = store.getOrBuildLineIndex(document)
    expect(first.reused).toBe(false)
    store.record({ sessionId: "s", worktree: "/w" }, "/w/a.ts", "a.ts", document, [], undefined, first.index)
    const second = store.getOrBuildLineIndex(document)
    expect(second.reused).toBe(true)
    expect(second.index).toBe(store.getOrBuildLineIndex(document).index)
  })

  it("isolates snapshots by session and worktree", () => {
    const store = new ScopedSnapshotStore()
    const document = decodeUtf8(encodeUtf8("const value = 1\n", false))
    const scope = { sessionId: "session-a", worktree: "/workspace/a" }
    const snapshot = store.record(scope, "/workspace/a/src/a.ts", "src/a.ts", document, [1])

    expect(store.get(scope, "/workspace/a/src/a.ts", snapshot.id)).toBe(snapshot)
    expect(store.get({ ...scope, sessionId: "session-b" }, "/workspace/a/src/a.ts", snapshot.id)).toBeUndefined()
    expect(store.get({ ...scope, worktree: "/workspace/b" }, "/workspace/a/src/a.ts", snapshot.id)).toBeUndefined()
  })

  it("merges seen lines for identical content", () => {
    const store = new ScopedSnapshotStore()
    const document = decodeUtf8(encodeUtf8("one\ntwo\n", false))
    const scope = { sessionId: "s", worktree: "/w" }
    store.record(scope, "/w/a.ts", "a.ts", document, [1])
    const snapshot = store.record(scope, "/w/a.ts", "a.ts", document, [2])
    expect([...snapshot.seenLines]).toEqual([1, 2])
  })

  it("keeps colliding hashline tags distinct and refuses ambiguous tag-only lookups", () => {
    const store = new ScopedSnapshotStore()
    const scope = { sessionId: "s", worktree: "/w" }
    const seen = new Map<string, { text: string; document: ReturnType<typeof decodeUtf8> }>()
    let collision: { text: string; document: ReturnType<typeof decodeUtf8> } | undefined
    let original: { text: string; document: ReturnType<typeof decodeUtf8> } | undefined
    for (let index = 0; index < 2_000; index++) {
      const text = `const value = ${index}\n`
      const document = decodeUtf8(encodeUtf8(text, false))
      const tag = store.record(scope, "/w/a.ts", "a.ts", document, [1]).tag
      const previous = seen.get(tag)
      if (previous && previous.text !== text) {
        original = previous
        collision = { text, document }
        break
      }
      seen.set(tag, { text, document })
    }
    expect(original).toBeDefined()
    expect(collision).toBeDefined()
    const first = store.record(scope, "/w/a.ts", "a.ts", original!.document, [1])
    const second = store.record(scope, "/w/a.ts", "a.ts", collision!.document, [1])
    expect(first.tag).toBe(second.tag)
    expect(first.id).not.toBe(second.id)
    expect(store.get(scope, "/w/a.ts", first.id)?.text).toBe(original!.text)
    expect(store.get(scope, "/w/a.ts", second.id)?.text).toBe(collision!.text)
    expect(() => store.get(scope, "/w/a.ts", first.tag)).toThrowError(expect.objectContaining({ code: "INVALID_ANCHOR" }))
  })

  it("expires old snapshots", () => {
    let now = 1_000
    const store = new ScopedSnapshotStore({ ttlMs: 100, now: () => now })
    const document = decodeUtf8(encodeUtf8("one\n", false))
    store.record({ sessionId: "s", worktree: "/w" }, "/w/a", "a", document, [1])
    now += 101
    expect(store.cleanup()).toBe(1)
    expect(store.size).toBe(0)
  })

  it("invalidates only the requested scope", () => {
    const store = new ScopedSnapshotStore()
    const document = decodeUtf8(encodeUtf8("one\n", false))
    const firstScope = { sessionId: "first", worktree: "/w" }
    const secondScope = { sessionId: "second", worktree: "/w" }
    const first = store.record(firstScope, "/w/a", "a", document, [1])
    const second = store.record(secondScope, "/w/a", "a", document, [1])

    store.invalidate("/w/a", firstScope)

    expect(store.get(firstScope, "/w/a", first.id)).toBeUndefined()
    expect(store.get(secondScope, "/w/a", second.id)).toBe(second)
  })
})
