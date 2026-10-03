export type EditStrategy = "exact" | "hashline" | "patch" | "batch" | "standard"

export type EditRouteInput = {
  fileCount: number
  operationCount: number
  changedLines?: number
  totalLines?: number
  payloadBytes?: number
  hasExact: boolean
  hasHashline: boolean
  hasPatch: boolean
  requiresAtomicBatch?: boolean
}

export type EditRoute = {
  strategy: EditStrategy
  confidence: number
  reason: string
  estimatedPayloadBytes: number
}

export function routeEdit(input: EditRouteInput): EditRoute {
  const fileCount = Math.max(1, input.fileCount)
  const operationCount = Math.max(1, input.operationCount)
  const changedLines = input.changedLines ?? 0
  const totalLines = input.totalLines ?? 0
  const payloadBytes = input.payloadBytes ?? 0
  const ratio = totalLines > 0 ? changedLines / totalLines : 0
  const largeChange = changedLines > 120 || ratio >= 0.35 || payloadBytes > 64 * 1024 || operationCount >= 40 || fileCount > 20

  if (largeChange) {
    return { strategy: "standard", confidence: 0.94, reason: "large replacement should use the standard OpenCode editing tool", estimatedPayloadBytes: payloadBytes }
  }

  if (input.requiresAtomicBatch || fileCount > 1) {
    if (input.hasPatch && (ratio >= 0.35 || operationCount >= 40)) {
      return { strategy: "patch", confidence: 0.88, reason: "large multi-file change is cheaper as one patch", estimatedPayloadBytes: payloadBytes }
    }
    return { strategy: "batch", confidence: 0.95, reason: "multiple files require one recoverable commit", estimatedPayloadBytes: payloadBytes }
  }

  if (input.hasPatch && (ratio >= 0.5 || operationCount >= 50)) {
    return { strategy: "patch", confidence: 0.9, reason: "large change has too many ranges for precise line operations", estimatedPayloadBytes: payloadBytes }
  }

  if (input.hasExact && operationCount === 1 && changedLines <= 12 && ratio < 0.35) {
    return { strategy: "exact", confidence: 0.96, reason: "one small local replacement", estimatedPayloadBytes: payloadBytes }
  }

  if (input.hasHashline) {
    return { strategy: "hashline", confidence: ratio >= 0.35 ? 0.72 : 0.9, reason: "multiple or line-addressed local changes", estimatedPayloadBytes: payloadBytes }
  }

  if (input.hasPatch) {
    return { strategy: "patch", confidence: 0.7, reason: "patch is the only available mutation representation", estimatedPayloadBytes: payloadBytes }
  }

  return { strategy: "exact", confidence: 0.5, reason: "exact edit is the safe default", estimatedPayloadBytes: payloadBytes }
}