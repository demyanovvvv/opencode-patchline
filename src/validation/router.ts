import path from "node:path"
import type { PatchlineConfig } from "../config.js"

export function validationCommand(filePath: string, config: PatchlineConfig): string | undefined {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  return config.validationCommands[extension] ?? config.validationCommands.default
}
