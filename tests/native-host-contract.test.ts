import { expect, it } from "vitest"
import { nativeHostTestSpec } from "../src/validation/native-host.js"

it("selects the upstream apply_patch suite without guessing another test path", () => {
  expect(nativeHostTestSpec("host", "1.19.0")).toMatchObject({
    args: ["test", "test/tool/apply_patch.test.ts", "--timeout", "30000"],
  })
  expect(() => nativeHostTestSpec("", "1.19.0")).toThrow(/source/i)
  expect(() => nativeHostTestSpec("host", "1.19.0-beta.1")).toThrow(/stable/i)
  expect(() => nativeHostTestSpec("host", "2.0.0")).toThrow(/supported/i)
})
