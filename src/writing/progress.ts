export type MutationStage = "committing" | "rollback"
export type MutationObserver = (stage: MutationStage) => void

/** Presentation failures must never interrupt a commit or guarded rollback. */
export function reportMutationStage(observer: MutationObserver | undefined, stage: MutationStage): void {
  try {
    observer?.(stage)
  } catch {
    // Metadata is best-effort; filesystem safety remains authoritative.
  }
}