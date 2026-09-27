import { describe, expect, it } from "vitest"
import { runCli } from "../src/cli.js"

describe("Patchline CLI", () => {
  it("prints doctor checks as JSON", async () => {
    const output: string[] = []
    const exitCode = await runCli(["doctor", "--json"], {
      stdout: (line) => output.push(line),
      stderr: () => undefined,
      inspect: async () => [
        { name: "Node.js", ok: true, detail: "22.0.0" },
        { name: "OpenCode", ok: false, detail: "missing" },
      ],
    })

    expect(exitCode).toBe(1)
    expect(JSON.parse(output.join(""))).toEqual({
      checks: [
        { name: "Node.js", ok: true, detail: "22.0.0" },
        { name: "OpenCode", ok: false, detail: "missing" },
      ],
      mode: "DEGRADED",
    })
  })

  it("prints an actionable LSP setup guide", async () => {
    const output: string[] = []
    const exitCode = await runCli(["doctor", "--lsp"], {
      stdout: (line) => output.push(line),
      stderr: () => undefined,
      inspect: async () => [
        { name: "Node.js", ok: true, detail: "22.0.0" },
        { name: "OpenCode", ok: true, detail: "1.18.32" },
        { name: "LSP setup", ok: false, detail: "disabled" },
      ],
    })

    expect(exitCode).toBe(1)
    expect(output.join("\n")).toContain("1. Enable LSP")
    expect(output.join("\n")).toContain("typescript-language-server")
    expect(output.join("\n")).toContain("patchline_grep")
  })

  it("returns the LSP guide as structured JSON", async () => {
    const output: string[] = []
    const exitCode = await runCli(["lsp", "check", "--json"], {
      stdout: (line) => output.push(line),
      stderr: () => undefined,
      inspect: async () => [{ name: "LSP setup", ok: false, detail: "disabled" }],
    })

    expect(exitCode).toBe(1)
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "unavailable",
      steps: expect.arrayContaining([expect.stringContaining("typescript-language-server")]),
    })
  })

  it("shows effective configuration without starting OpenCode", async () => {
    const output: string[] = []
    const exitCode = await runCli(["config", "show"], {
      stdout: (line) => output.push(line),
      stderr: () => undefined,
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(output.join(""))).toMatchObject({ mode: "precision", maxInitialReadLines: 120 })
  })

  it("validates supplied configuration", async () => {
    const output: string[] = []
    const exitCode = await runCli(["config", "validate", '{"mode":"compatibility"}'], {
      stdout: (line) => output.push(line),
      stderr: () => undefined,
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(output.join(""))).toEqual({ valid: true, config: expect.objectContaining({ mode: "compatibility" }) })
  })

  it("explains a stable error code", async () => {
    const output: string[] = []
    const exitCode = await runCli(["explain", "STALE_SNAPSHOT"], {
      stdout: (line) => output.push(line),
      stderr: () => undefined,
    })

    expect(exitCode).toBe(0)
    expect(output.join(" ")).toContain("Re-read")
  })

  it("rejects unknown error codes", async () => {
    const stderr: string[] = []
    const exitCode = await runCli(["explain", "UNKNOWN"], {
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    })

    expect(exitCode).toBe(1)
    expect(stderr.join(" ")).toContain("Unknown error code")
  })
})
