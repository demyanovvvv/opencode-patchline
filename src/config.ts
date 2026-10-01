import { z } from "zod"

const configSchema = z
  .object({
    mode: z.enum(["precision", "compatibility", "disabled"]).default("precision"),
    maxInitialReadLines: z.number().int().min(1).max(2_000).default(120),
    maxSearchResults: z.number().int().min(1).max(500).default(30),
    maxDiagnostics: z.number().int().min(1).max(500).default(30),
    snapshotTtlMs: z.number().int().min(60_000).default(60 * 60 * 1_000),
    maxSnapshots: z.number().int().min(8).max(16_384).default(512),
    maxSnapshotBytes: z.number().int().min(32 * 1024 * 1024).max(1024 * 1024 * 1024).default(128 * 1024 * 1024),
    protectExistingWrites: z.boolean().default(true),
    protectGeneratedFiles: z.boolean().default(true),
    applyPatchFallback: z.boolean().default(true),
    hashlineRecovery: z.boolean().default(false),
    guardShellWrites: z.boolean().default(true),
    telemetry: z.boolean().default(false),
    summary: z.boolean().default(true),
    allowedFullReplacements: z.array(z.string()).default([]),
    generatedPatterns: z.array(z.string()).default([]),
    validationCommands: z.record(z.string(), z.string()).default({}),
  })
  .strict()

export type PatchlineConfig = z.infer<typeof configSchema>

export function parseConfig(input: Record<string, unknown> = {}): PatchlineConfig {
  return configSchema.parse(input)
}

export const DEFAULT_CONFIG = parseConfig()
