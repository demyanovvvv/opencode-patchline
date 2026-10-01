import { describe, expect, it } from "vitest"
import { executeCommand } from "../src/installation/process.js"

describe("installer process launcher", () => {
  it("executes absolute paths and keeps shell metacharacters literal", async () => {
    const value = "spaces & ; $(echo bad)"
    const result = await executeCommand(process.execPath, ["-e", "console.log(process.argv[1])", value], process.cwd())
    expect(result.code).toBe(0)
    expect(result.output).toBe(value)
  })
})