import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

await suite("solution.mjs", ({ LRUCache }) => [
  ["basic get/set", () => { const c = new LRUCache(2); c.set("a", 1); assert.equal(c.get("a"), 1); assert.equal(c.get("b"), undefined) }],
  ["evicts LRU", () => { const c = new LRUCache(2); c.set("a", 1).set("b", 2); c.get("a"); c.set("c", 3); assert.equal(c.has("b"), false); assert.deepEqual(c.keys(), ["a", "c"]) }],
  ["set refreshes", () => { const c = new LRUCache(2); c.set("a", 1).set("b", 2).set("a", 10).set("c", 3); assert.deepEqual(c.keys(), ["a", "c"]); assert.equal(c.get("a"), 10) }],
  ["has is not a use", () => { const c = new LRUCache(2); c.set("a", 1).set("b", 2); assert.equal(c.has("a"), true); c.set("c", 3); assert.equal(c.has("a"), false) }],
  ["capacity 0", () => { const c = new LRUCache(0); c.set("a", 1); assert.equal(c.size, 0); assert.equal(c.get("a"), undefined) }],
  ["bad capacity", () => { assert.throws(() => new LRUCache(-1), RangeError); assert.throws(() => new LRUCache(1.5), RangeError) }],
  ["delete and size", () => { const c = new LRUCache(3); c.set(1, "x").set(2, "y"); assert.equal(c.delete(1), true); assert.equal(c.delete(1), false); assert.equal(c.size, 1) }],
  ["object and NaN keys", () => { const c = new LRUCache(3); const k = {}; c.set(k, 1).set(NaN, 2); assert.equal(c.get(k), 1); assert.equal(c.get({}), undefined); assert.equal(c.get(NaN), 2) }],
  ["undefined values", () => { const c = new LRUCache(2); c.set("u", undefined); assert.equal(c.has("u"), true); assert.equal(c.size, 1) }],
  ["random ops match a model", () => {
    // A seeded walk of 5000 operations, checked step by step against an array model.
    let seed = 7
    const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
    const c = new LRUCache(5)
    const model = []
    const touch = (k, v) => { const i = model.findIndex((e) => e[0] === k); if (i >= 0) model.splice(i, 1); model.push([k, v]) }
    for (let step = 0; step < 5000; step++) {
      const k = rand(9), op = rand(4)
      if (op === 0) { c.set(k, step); touch(k, step); if (model.length > 5) model.shift() }
      else if (op === 1) { const e = model.find((x) => x[0] === k); assert.equal(c.get(k), e?.[1], `get ${k} at ${step}`); if (e) touch(k, e[1]) }
      else if (op === 2) { const i = model.findIndex((x) => x[0] === k); assert.equal(c.delete(k), i >= 0, `delete ${k} at ${step}`); if (i >= 0) model.splice(i, 1) }
      else assert.equal(c.has(k), model.some((x) => x[0] === k), `has ${k} at ${step}`)
      assert.equal(c.size, model.length, `size at ${step}`)
    }
    assert.deepEqual(c.keys(), model.map((e) => e[0]))
  }]
])
