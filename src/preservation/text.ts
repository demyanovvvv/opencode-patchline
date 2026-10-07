import { PatchlineError } from "../errors.js"
import { diffLines } from "diff"

export type LineEnding = "LF" | "CRLF" | "mixed" | "none"

export type TextDocument = {
  bytes: Uint8Array
  text: string
  normalizedText: string
  bom: boolean
  lineEnding: LineEnding
  endsWithNewline: boolean
}

const decoder = new TextDecoder("utf-8", { fatal: true })

export function decodeUtf8(bytes: Uint8Array, path?: string): TextDocument {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = bom ? bytes.subarray(3) : bytes
  let text: string
  try {
    text = decoder.decode(body)
  } catch (cause) {
    throw new PatchlineError(
      "ENCODING_UNSUPPORTED",
      `Only valid UTF-8 source is supported${path ? `: ${path}` : "."}`,
      path ? { path, cause } : { cause },
    )
  }
  const crlf = (text.match(/\r\n/g) ?? []).length
  const bareLf = (text.match(/(?<!\r)\n/g) ?? []).length
  const lineEnding: LineEnding = crlf > 0 && bareLf > 0 ? "mixed" : crlf > 0 ? "CRLF" : bareLf > 0 ? "LF" : "none"
  return {
    bytes,
    text,
    normalizedText: text.replace(/\r\n?/g, "\n"),
    bom,
    lineEnding,
    endsWithNewline: /(?:\r\n|\n)$/.test(text),
  }
}

export function encodeUtf8(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text)
  if (!bom) return body
  const bytes = new Uint8Array(body.length + 3)
  bytes.set([0xef, 0xbb, 0xbf])
  bytes.set(body, 3)
  return bytes
}

export function restoreTextShape(normalizedText: string, document: TextDocument): Uint8Array {
  const ending = document.lineEnding === "CRLF" ? "\r\n" : "\n"
  const shaped = ending === "\r\n" ? normalizedText.replace(/\n/g, ending) : normalizedText
  return encodeUtf8(shaped, document.bom)
}

function preferredEnding(text: string): "\n" | "\r\n" {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  if (crlf === lf) return text.indexOf("\r\n") >= 0 && text.indexOf("\r\n") <= text.indexOf("\n") ? "\r\n" : "\n"
  return crlf > lf ? "\r\n" : "\n"
}

export function applyNormalizedTextPreservingShape(normalizedText: string, document: TextDocument): Uint8Array {
  if (document.lineEnding === "mixed") {
    const changes = diffLines(document.normalizedText, normalizedText, { timeout: 100, maxEditLength: 2_000 })
    if (!changes) throw new PatchlineError("STANDARD_TOOL_REQUIRED", "Mixed-newline preservation exceeded its diff budget.")
    let raw = 0
    const output: string[] = []
    const ending = preferredEnding(document.text)
    for (const change of changes) {
      if (change.added) {
        output.push(ending === "\r\n" ? change.value.replace(/\n/g, "\r\n") : change.value)
        continue
      }
      const start = raw
      for (let index = 0; index < change.value.length; index++) raw += document.text[raw] === "\r" && document.text[raw + 1] === "\n" ? 2 : 1
      if (!change.removed) output.push(document.text.slice(start, raw))
    }
    return encodeUtf8(output.join(""), document.bom)
  }
  const ending = preferredEnding(document.text)
  const original = document.normalizedText
  let commonStart = 0
  while (commonStart < original.length && commonStart < normalizedText.length && original[commonStart] === normalizedText[commonStart]) commonStart++
  let commonEnd = 0
  while (
    commonEnd < original.length - commonStart &&
    commonEnd < normalizedText.length - commonStart &&
    original[original.length - commonEnd - 1] === normalizedText[normalizedText.length - commonEnd - 1]
  ) commonEnd++
  const suffixStart = original.length - commonEnd
  if (
    commonEnd > 0 &&
    suffixStart > commonStart &&
    original[suffixStart] === "\n" &&
    normalizedText[normalizedText.length - commonEnd] === "\n"
  ) commonEnd--
  const rawOffsetAt = (normalizedOffset: number): number => {
    let rawOffset = 0
    let consumed = 0
    while (consumed < normalizedOffset && rawOffset < document.text.length) {
      rawOffset += document.text[rawOffset] === "\r" && document.text[rawOffset + 1] === "\n" ? 2 : 1
      consumed++
    }
    return rawOffset
  }
  const rawStart = rawOffsetAt(commonStart)
  const rawEnd = rawOffsetAt(original.length - commonEnd)
  let rebuilt = document.text.slice(0, rawStart)
  const inserted = normalizedText.slice(commonStart, normalizedText.length - commonEnd)
  rebuilt += ending === "\r\n" ? inserted.replace(/\n/g, "\r\n") : inserted
  rebuilt += document.text.slice(rawEnd)
  return encodeUtf8(rebuilt, document.bom)
}

export function countLines(text: string): number {
  if (text.length === 0) return 0
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
}
