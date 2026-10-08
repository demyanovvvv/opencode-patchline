import { expect, it } from "vitest"
import { prepareHostSourceChanges } from "../src/installer.js"

it("validates all host adapters before returning any source change", () => {
  expect(() => prepareHostSourceChanges({ renderer: "unsupported", registry: "unsupported", upgrade: "unsupported", startup: "unsupported" }, "cli.js")).toThrow(/Unsupported OpenCode/)
})
