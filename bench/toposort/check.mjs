import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

await suite("solution.mjs", ({ order }) => [
  ["example", () => assert.deepEqual(order({ app: ["lib", "util"], lib: ["util"] }), ["util", "lib", "app"])],
  ["empty", () => assert.deepEqual(order({}), [])],
  ["alphabetical ties", () => assert.deepEqual(order({ c: [], b: [], a: [] }), ["a", "b", "c"])],
  ["deps-only names", () => assert.deepEqual(order({ z: ["y", "x"] }), ["x", "y", "z"])],
  ["ready set order", () => assert.deepEqual(order({ b: ["d"], a: ["c"], c: [], d: [] }), ["c", "a", "d", "b"])],
  ["duplicate deps", () => assert.deepEqual(order({ a: ["b", "b"] }), ["b", "a"])],
  ["self cycle", () => assert.throws(() => order({ a: ["a"] }), /a -> a/)],
  ["two-node cycle", () => assert.throws(() => order({ b: ["a"], a: ["b"] }), /a -> b -> a/)],
  ["longer cycle", () => assert.throws(() => order({ x: [], c: ["a"], a: ["b"], b: ["c"], d: ["a"] }), /a -> b -> c -> a/)],
  ["no false alarm", () => assert.deepEqual(order({ a: ["b", "c"], b: ["c"], c: [] }), ["c", "b", "a"])]
])
