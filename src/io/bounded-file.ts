import { open } from "node:fs/promises"
import { PatchlineError } from "../errors.js"

export async function readBoundedUtf8Bytes(absolute: string, relative: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(absolute, "r")
  try {
    const info = await handle.stat({ bigint: true })
    if (info.size > BigInt(maxBytes)) {
      throw new PatchlineError("INVALID_ARGUMENT", `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB read limit: ${relative}`, { path: relative })
    }
    const chunks: Buffer[] = []
    let total = 0
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      total += bytesRead
      if (total > maxBytes) {
        throw new PatchlineError("INVALID_ARGUMENT", `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB read limit: ${relative}`, { path: relative })
      }
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}
