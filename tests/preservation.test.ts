import { describe, expect, it } from "vitest"
import { applyNormalizedTextPreservingShape, decodeUtf8, encodeUtf8 } from "../src/preservation/text.js"
import { PatchlineError } from "../src/errors.js"

describe("text preservation", () => {
  it("preserves BOM and CRLF", () => {
    const document = decodeUtf8(encodeUtf8("one\r\ntwo\r\n", true))
    const result = applyNormalizedTextPreservingShape("one\nchanged\n", document)
    expect([...result.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(decodeUtf8(result).text).toBe("one\r\nchanged\r\n")
  })

  it("preserves unchanged mixed line endings", () => {
    const document = decodeUtf8(encodeUtf8("one\r\ntwo\nthree\r\n", false))
    const result = applyNormalizedTextPreservingShape("one\ntwo\nchanged\n", document)
    expect(decodeUtf8(result).text).toBe("one\r\ntwo\nchanged\r\n")
  })

  it("uses the dominant line ending for inserted mixed-ending content", () => {
    const document = decodeUtf8(encodeUtf8("one\r\ntwo\r\nthree\nfour\r\n", false))
    const result = applyNormalizedTextPreservingShape("one\ntwo\nchanged\nnew\nfour\n", document)
    expect(decodeUtf8(result).text).toBe("one\r\ntwo\r\nchanged\r\nnew\r\nfour\r\n")
  })

  it("rejects invalid UTF-8", () => {
    expect(() => decodeUtf8(Uint8Array.from([0xc3, 0x28]))).toThrowError(PatchlineError)
  })
})
