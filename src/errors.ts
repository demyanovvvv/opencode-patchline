export type PatchlineErrorCode =
  | "OPENCODE_UNSUPPORTED"
  | "CAPABILITY_UNAVAILABLE"
  | "INVALID_ARGUMENT"
  | "PATH_OUTSIDE_WORKSPACE"
  | "SYMLINK_ESCAPE"
  | "GIT_INTERNAL_PATH"
  | "FILE_NOT_FOUND"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_SCOPE_MISMATCH"
  | "STALE_SNAPSHOT"
  | "INVALID_ANCHOR"
  | "PATCH_PREFLIGHT_FAILED"
  | "WRITE_PROTECTED"
  | "GENERATED_FILE"
  | "ENCODING_UNSUPPORTED"
  | "TRANSACTION_FAILED"
  | "DIAGNOSTICS_UNAVAILABLE"
  | "VALIDATION_FAILED"
  | "FALLBACK_REJECTED"

export class PatchlineError extends Error {
  readonly code: PatchlineErrorCode
  readonly path: string | undefined
  readonly snapshotId: string | undefined
  readonly retryable: boolean
  readonly writes: number
  readonly details: Record<string, unknown> | undefined

  constructor(
    code: PatchlineErrorCode,
    message: string,
    options: {
      path?: string
      snapshotId?: string
      retryable?: boolean
      writes?: number
      cause?: unknown
      details?: Record<string, unknown>
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "PatchlineError"
    this.code = code
    this.path = options.path
    this.snapshotId = options.snapshotId
    this.retryable = options.retryable ?? false
    this.writes = options.writes ?? 0
    this.details = options.details
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof PatchlineError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
