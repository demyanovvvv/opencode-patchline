import { describe, expect, it } from "vitest"
import { routeEdit } from "../src/editing/router.js"

describe("edit strategy router", () => {
  it("selects exact for one small replacement", () => {
    expect(routeEdit({ fileCount: 1, operationCount: 1, changedLines: 2, totalLines: 500, hasExact: true, hasHashline: true, hasPatch: true })).toMatchObject({ strategy: "exact" })
  })

  it("selects Hashline for multiple local line changes", () => {
    expect(routeEdit({ fileCount: 1, operationCount: 5, changedLines: 18, totalLines: 500, hasExact: false, hasHashline: true, hasPatch: true })).toMatchObject({ strategy: "hashline" })
  })

  it("selects patch for a large transformation", () => {
    expect(routeEdit({ fileCount: 1, operationCount: 80, changedLines: 600, totalLines: 900, hasExact: false, hasHashline: true, hasPatch: true })).toMatchObject({ strategy: "patch" })
  })

  it("selects batch for multi-file atomic work", () => {
    expect(routeEdit({ fileCount: 3, operationCount: 3, hasExact: true, hasHashline: true, hasPatch: false, requiresAtomicBatch: true })).toMatchObject({ strategy: "batch" })
  })
})