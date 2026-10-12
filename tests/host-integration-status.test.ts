import { expect, it } from "vitest"
import { hostIntegrationStatus } from "../src/installation/host-runtime.js"

it("distinguishes stock, integrated and mismatched host versions", () => {
  expect(hostIntegrationStatus("1.19.0", "1.3.0")).toEqual({ ok: false, detail: "Stock OpenCode 1.19.0; reinstall integration for full tool cards." })
  expect(hostIntegrationStatus("1.19.0+patchline.1.3.0", "1.3.0")).toEqual({ ok: true, detail: "OpenCode 1.19.0; Patchline 1.3.0; integrated host matches package." })
  expect(hostIntegrationStatus("1.19.0+patchline.1.2.1", "1.3.0")).toEqual({ ok: false, detail: "Host Patchline 1.2.1 differs from package 1.3.0; reinstall integration." })
})
