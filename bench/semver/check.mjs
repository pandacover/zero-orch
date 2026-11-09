import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

await suite("solution.mjs", ({ compare }) => {
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"]
  return [
    ["numeric parts", () => {
      assert.equal(compare("1.2.3", "1.2.4"), -1)
      assert.equal(compare("2.0.0", "1.9.9"), 1)
      assert.equal(compare("1.10.0", "1.9.0"), 1)
    }],
    ["equal", () => assert.equal(compare("1.2.3", "1.2.3"), 0)],
    ["spec order", () => {
      for (let i = 0; i + 1 < order.length; i++) {
        assert.equal(compare(order[i], order[i + 1]), -1, `${order[i]} < ${order[i + 1]}`)
        assert.equal(compare(order[i + 1], order[i]), 1, `${order[i + 1]} > ${order[i]}`)
      }
    }],
    ["build ignored", () => {
      assert.equal(compare("1.0.0+build.1", "1.0.0+other"), 0)
      assert.equal(compare("1.0.0-rc.1+b", "1.0.0"), -1)
    }],
    ["hyphen identifiers", () => assert.equal(compare("1.0.0-a-b", "1.0.0-a-c"), -1)],
    ["numeric vs alnum", () => assert.equal(compare("1.0.0-1", "1.0.0-a"), -1)],
    ["invalid shape", () => {
      for (const v of ["1.2", "1.2.3.4", "v1.2.3", "", "1..2"]) assert.throws(() => compare(v, "1.0.0"), TypeError, v)
    }],
    ["leading zeros", () => {
      assert.throws(() => compare("01.2.3", "1.0.0"), TypeError)
      assert.throws(() => compare("1.0.0-01", "1.0.0"), TypeError)
    }],
    ["bad identifiers", () => {
      for (const v of ["1.0.0-", "1.0.0-a..b", "1.0.0-a_b", "1.0.0+"]) assert.throws(() => compare(v, "1.0.0"), TypeError, v)
    }],
    ["zero ok", () => {
      assert.equal(compare("0.0.0", "0.0.1"), -1)
      assert.equal(compare("1.0.0-0", "1.0.0-0a"), -1)
    }]
  ]
})
