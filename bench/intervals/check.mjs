import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

await suite("intervals.mjs", ({ merge }) => [
  ["sorted overlap", () => assert.deepEqual(merge([[1, 3], [2, 6], [8, 10]]), [[1, 6], [8, 10]])],
  ["unsorted", () => assert.deepEqual(merge([[8, 10], [1, 3], [2, 6]]), [[1, 6], [8, 10]])],
  ["touching", () => assert.deepEqual(merge([[1, 2], [2, 5]]), [[1, 5]])],
  ["contained", () => assert.deepEqual(merge([[1, 10], [2, 3], [4, 5]]), [[1, 10]])],
  ["empty", () => assert.deepEqual(merge([]), [])],
  ["single point", () => assert.deepEqual(merge([[5, 5], [5, 5]]), [[5, 5]])],
  ["negatives", () => assert.deepEqual(merge([[-5, -1], [-3, 2], [4, 4]]), [[-5, 2], [4, 4]])],
  ["input untouched", () => {
    const input = [[3, 4], [1, 3]]
    const copy = JSON.stringify(input)
    merge(input)
    assert.equal(JSON.stringify(input), copy)
  }]
])
