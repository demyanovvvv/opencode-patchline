import { describe, expect, it } from "vitest"
import { encodeUtf8, decodeUtf8 } from "../src/preservation/text.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"

describe("ScopedSnapshotStore", () => {
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
