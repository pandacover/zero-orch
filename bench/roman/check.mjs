import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

await suite("solution.mjs", ({ toRoman, fromRoman }) => {
  const throwsRange = (f) => assert.throws(f, RangeError)
  return [
    ["toRoman basics", () => { assert.equal(toRoman(1), "I"); assert.equal(toRoman(4), "IV"); assert.equal(toRoman(9), "IX"); assert.equal(toRoman(14), "XIV") }],
    ["toRoman big", () => { assert.equal(toRoman(1994), "MCMXCIV"); assert.equal(toRoman(3999), "MMMCMXCIX"); assert.equal(toRoman(444), "CDXLIV") }],
    ["toRoman range", () => { throwsRange(() => toRoman(0)); throwsRange(() => toRoman(4000)); throwsRange(() => toRoman(-3)) }],
    ["toRoman type", () => { throwsRange(() => toRoman(2.5)); throwsRange(() => toRoman("12")); throwsRange(() => toRoman(NaN)) }],
    ["fromRoman basics", () => { assert.equal(fromRoman("III"), 3); assert.equal(fromRoman("XLII"), 42); assert.equal(fromRoman("MCMXCIV"), 1994) }],
    ["round trip", () => { for (let i = 1; i < 4000; i++) assert.equal(fromRoman(toRoman(i)), i) }],
    ["fromRoman empty/lower", () => { throwsRange(() => fromRoman("")); throwsRange(() => fromRoman("xiv")) }],
    ["fromRoman unknown", () => { throwsRange(() => fromRoman("ABC")); throwsRange(() => fromRoman("X I")) }],
    ["fromRoman non-standard", () => { for (const s of ["IIII", "VX", "IC", "MCMC", "VV", "XXXX", "IL", "DM", "MMMM"]) throwsRange(() => fromRoman(s)) }]
  ]
})
