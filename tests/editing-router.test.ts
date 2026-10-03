import { describe, expect, it } from "vitest"
import { routeEdit } from "../src/editing/router.js"

describe("edit strategy router", () => {
  it("selects exact for one small replacement", () => {
    expect(routeEdit({ fileCount: 1, operationCount: 1, changedLines: 2, totalLines: 500, hasExact: true, hasHashline: true, hasPatch: true })).toMatchObject({ strategy: "exact" })
  })

  it("selects Hashline for multiple local line changes", () => {
    expect(routeEdit({ fileCount: 1, operationCount: 5, changedLines: 18, totalLines: 500, hasExact: false, hasHashline: true, hasPatch: true })).toMatchObject({ strategy: "hashline" })
  })

  it("routes a large transformation to standard tools", () => {
    expect(routeEdit({ fileCount: 1, operationCount: 80, changedLines: 600, totalLines: 900, hasExact: false, hasHashline: true, hasPatch: true })).toMatchObject({ strategy: "standard" })
  })

  it("routes large replacements to standard tools", () => {
    expect(routeEdit({ fileCount: 1, operationCount: 1, changedLines: 140, totalLines: 300, payloadBytes: 70 * 1024, hasExact: true, hasHashline: true, hasPatch: false })).toMatchObject({ strategy: "standard" })
  })

  it("routes large multi-file changes to standard tools", () => {
    expect(routeEdit({ fileCount: 21, operationCount: 21, changedLines: 300, totalLines: 600, payloadBytes: 80 * 1024, hasExact: true, hasHashline: true, hasPatch: false, requiresAtomicBatch: true })).toMatchObject({ strategy: "standard" })
  })

  it("selects batch for multi-file atomic work", () => {
    expect(routeEdit({ fileCount: 3, operationCount: 3, hasExact: true, hasHashline: true, hasPatch: false, requiresAtomicBatch: true })).toMatchObject({ strategy: "batch" })
  })

  it("keeps exact threshold inputs local and routes the next boundary to standard", () => {
    const common = { fileCount: 1, operationCount: 1, totalLines: 400, hasExact: true, hasHashline: true, hasPatch: false }
    expect(routeEdit({ ...common, changedLines: 120 })).not.toMatchObject({ strategy: "standard" })
    expect(routeEdit({ ...common, changedLines: 121 })).toMatchObject({ strategy: "standard" })
    expect(routeEdit({ ...common, changedLines: 139, totalLines: 400 })).toMatchObject({ strategy: "standard" })
    expect(routeEdit({ ...common, changedLines: 140, totalLines: 401 })).toMatchObject({ strategy: "standard" })
  })
})