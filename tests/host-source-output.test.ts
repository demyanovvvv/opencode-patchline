import { expect, it } from "vitest"
import { executeCommand } from "../src/installation/process.js"

it("retains complete bounded host adapter source when explicitly requested", async () => {
  const result = await executeCommand(process.execPath, ["-e", "process.stdout.write('anchor'+ 'x'.repeat(25000))"], process.cwd(), false, {}, 100_000)
  expect(result.output.startsWith("anchor")).toBe(true)
  expect(result.output.length).toBe(25006)
})
