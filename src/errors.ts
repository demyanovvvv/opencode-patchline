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

const RECOVERY_ACTIONS: Record<PatchlineErrorCode, string> = {
  OPENCODE_UNSUPPORTED: "Upgrade OpenCode to a supported version and run doctor again.",
  CAPABILITY_UNAVAILABLE: "Check doctor output or use the supported fallback.",
  INVALID_ARGUMENT: "Correct the arguments and retry.",
  PATH_OUTSIDE_WORKSPACE: "Use a path inside the OpenCode worktree.",
  SYMLINK_ESCAPE: "Use a non-escaping path inside the worktree.",
  GIT_INTERNAL_PATH: "Choose a source path outside .git.",
  FILE_NOT_FOUND: "Re-discover the path and read it before retrying.",
  SNAPSHOT_NOT_FOUND: "Read the target again to create a fresh snapshot.",
  SNAPSHOT_SCOPE_MISMATCH: "Read the file in the current OpenCode session.",
  STALE_SNAPSHOT: "Re-read the affected range and retry the edit.",
  INVALID_ANCHOR: "Read the current range and provide a precise anchor.",
  PATCH_PREFLIGHT_FAILED: "Correct the patch and retry from a fresh snapshot.",
  WRITE_PROTECTED: "Use snapshot-anchored edit for existing files.",
  GENERATED_FILE: "Update the canonical source or generator instead.",
  ENCODING_UNSUPPORTED: "Convert the file to supported UTF-8 text before editing.",
  TRANSACTION_FAILED: "Inspect the reported conflicts and re-read affected files before retrying.",
  DIAGNOSTICS_UNAVAILABLE: "Check the configured command and granted permissions.",
  VALIDATION_FAILED: "Inspect diagnostics before making another edit.",
  FALLBACK_REJECTED: "Use a snapshot-tagged operation or enable the fallback explicitly.",
}

export function recoveryActionFor(code: PatchlineErrorCode): string {
  return RECOVERY_ACTIONS[code]
}

export class PatchlineError extends Error {
  readonly code: PatchlineErrorCode
  readonly path: string | undefined
  readonly snapshotId: string | undefined
  readonly retryable: boolean
  readonly writes: number
  readonly details: Record<string, unknown> | undefined
  readonly recoveryAction: string

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
    this.recoveryAction = recoveryActionFor(code)
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof PatchlineError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
