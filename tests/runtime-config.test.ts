import { describe, expect, it } from "vitest"
import { runDiagnosticCommand } from "../src/validation/diagnostics.js"

describe("runtime configuration", () => {
  it("bounds diagnostics by configured line count", async () => {
    const command = `${process.execPath} -e "console.log('one'); console.log('two'); console.log('three')"`
    const result = await runDiagnosticCommand(command, process.cwd(), 120_000, 2)

    expect(result.ok).toBe(true)
    expect(result.output).toContain("one")
    expect(result.output).toContain("two")
    expect(result.output).not.toContain("three")
    expect(result.output).toContain("diagnostics truncated")
  })
})
