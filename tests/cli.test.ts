import { describe, expect, it, vi } from "vitest"
import { runCli } from "../src/cli.js"

describe("Patchline CLI", () => {
  it("defers LSP preparation until a valid LSP command needs it", async () => {
    vi.resetModules()
    const prepareProjectLsp = vi.fn(async () => [])
    const initialize = vi.fn(() => ({ prepareProjectLsp }))
    vi.doMock("../src/lsp/manager.js", initialize)
    try {
      const { runCli: freshCli } = await import("../src/cli.js")
      await freshCli(["config", "show"], { stdout: () => undefined })
      expect(initialize).not.toHaveBeenCalled()
      expect(await freshCli(["lsp", "check", "--directory"], { stderr: () => undefined })).toBe(1)
      expect(initialize).not.toHaveBeenCalled()
      expect(await freshCli(["lsp", "check"], { stdout: () => undefined })).toBe(0)
      expect(prepareProjectLsp).toHaveBeenCalledWith(process.cwd(), { install: false })
      expect(initialize).toHaveBeenCalledOnce()
    } finally { vi.doUnmock("../src/lsp/manager.js"); vi.resetModules() }
  })
  it("defers capability inspection until a doctor command needs it", async () => {
    vi.resetModules()
    const inspectCapabilities = vi.fn(async () => [])
    const initialize = vi.fn(() => ({ inspectCapabilities }))
    vi.doMock("../src/compatibility.js", initialize)
    try {
      const { runCli: freshCli } = await import("../src/cli.js")
      await freshCli(["config", "show"], { stdout: () => undefined })
      expect(initialize).not.toHaveBeenCalled()
      expect(await freshCli(["doctor"], { stdout: () => undefined })).toBe(0)
      expect(initialize).toHaveBeenCalledOnce()
      expect(inspectCapabilities).toHaveBeenCalledOnce()
    } finally { vi.doUnmock("../src/compatibility.js"); vi.resetModules() }
  })
  it("loads configuration commands without initializing the installer", async () => {
    vi.resetModules()
    const initialize = vi.fn(() => { throw new Error("Installer must remain lazy") })
    vi.doMock("../src/installer.js", initialize)
    try {
      const { runCli: freshCli } = await import("../src/cli.js")
      expect(await freshCli(["config", "show"], { stdout: () => undefined, stderr: () => undefined })).toBe(0)
      expect(initialize).not.toHaveBeenCalled()
      const errors: string[] = []
      expect(await freshCli(["install", "--yes"], { stdout: () => undefined, stderr: (line) => errors.push(line) })).toBe(1)
      expect(initialize).toHaveBeenCalledOnce()
      expect(errors).toHaveLength(1)
    } finally { vi.doUnmock("../src/installer.js"); vi.resetModules() }
  })
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
    expect(output.join("\n")).toContain("managed servers")
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
      steps: expect.arrayContaining([expect.stringContaining("managed servers")]),
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
