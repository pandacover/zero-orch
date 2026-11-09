import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

// The longest common subsequence's length, the slow sure way.
const lcs = (a, b) => {
  let prev = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint32Array(b.length + 1)
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    prev = cur
  }
  return prev[b.length]
}

let seed = 11
const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n

await suite("solution.mjs", ({ diff }) => {
  const valid = (a, b, label) => {
    const ops = diff(a, b)
    assert.ok(Array.isArray(ops), `${label}: not an array`)
    let i = 0, j = 0, keeps = 0, sawAdd = false
    for (const o of ops) {
      if (o.op === "keep") {
        assert.equal(o.line, a[i], `${label}: keep doesn't match a[${i}]`)
        assert.equal(o.line, b[j], `${label}: keep doesn't match b[${j}]`)
        i++; j++; keeps++; sawAdd = false
      } else if (o.op === "del") {
        assert.ok(!sawAdd, `${label}: a del after an add in one run of changes`)
        assert.equal(o.line, a[i], `${label}: del doesn't match a[${i}]`)
        i++
      } else if (o.op === "add") {
        assert.equal(o.line, b[j], `${label}: add doesn't match b[${j}]`)
        j++; sawAdd = true
      } else assert.fail(`${label}: unknown op ${o.op}`)
    }
    assert.equal(i, a.length, `${label}: didn't consume all of a`)
    assert.equal(j, b.length, `${label}: didn't produce all of b`)
    assert.equal(keeps, lcs(a, b), `${label}: not minimal (${keeps} keeps, ${lcs(a, b)} possible)`)
  }
  const lines = (s) => s.split("")
  return [
    ["identical", () => valid(lines("abc"), lines("abc"), "same")],
    ["empty sides", () => { valid([], lines("xy"), "from empty"); valid(lines("xy"), [], "to empty"); valid([], [], "both empty") }],
    ["classic", () => valid(lines("ABCABBA"), lines("CBABAC"), "ABCABBA")],
    ["replace middle", () => valid(lines("aXb"), lines("aYb"), "replace")],
    ["dels before adds", () => { valid(lines("abcd"), lines("axyd"), "run"); valid(lines("xab"), lines("aby"), "ends") }],
    ["repeated lines", () => valid(["}", "}", "x", "}"], ["}", "x", "}", "}"], "braces")],
    ["random small", () => { for (let t = 0; t < 200; t++) { const a = Array.from({ length: rand(9) }, () => "abc"[rand(3)]); const b = Array.from({ length: rand(9) }, () => "abc"[rand(3)]); valid(a, b, `random ${a.join("")}/${b.join("")}`) } }],
    ["big, few edits", () => {
      const a = Array.from({ length: 3000 }, (_, k) => `line ${k % 500}`)
      const b = a.slice()
      for (let k = 0; k < 25; k++) { const at = rand(b.length); rand(2) ? b.splice(at, 1) : b.splice(at, 0, `new ${k}`) }
      const t = performance.now()
      valid(a, b, "big")
      assert.ok(performance.now() - t < 8000, "too slow")
    }]
  ]
})
