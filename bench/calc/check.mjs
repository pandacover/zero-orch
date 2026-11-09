import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

await suite("solution.mjs", ({ evaluate }) => {
  const near = (src, want) => assert.ok(Math.abs(evaluate(src) - want) < 1e-9, `${src} = ${evaluate(src)}, want ${want}`)
  const syntaxAt = (src, at) => assert.throws(() => evaluate(src), (e) => e instanceof SyntaxError && new RegExp(`\\bat ${at}\\b`).test(e.message), `${src} should fail at ${at}`)
  return [
    ["precedence", () => { near("1 + 2 * 3", 7); near("(1 + 2) * 3", 9); near("10 % 4 + 1", 3) }],
    ["left associative", () => { near("7 - 2 - 1", 4); near("8 / 2 / 2", 2); near("2 * 3 % 4", 2) }],
    ["power", () => { near("2 ^ 3 ^ 2", 512); near("-2 ^ 2", -4); near("2 ^ -1", 0.5); near("(-2) ^ 2", 4) }],
    ["unary", () => { near("--3", 3); near("-(2 + 3)", -5); near("+-+4", -4); near("2 * -3", -6) }],
    ["numbers", () => { near(".5 + 1.5e1", 15.5); near("1e3", 1000); near("2.5e-2 * 4", 0.1) }],
    ["calls and constants", () => { near("max(1, min(4, 3), 2)", 3); near("abs(-3) + sqrt(16)", 7); near("2 * pi", 2 * Math.PI); near("e ^ 0", 1); near("max(5)", 5) }],
    ["whitespace", () => { near("  1+2  ", 3); near("\t3*\n4", 12) }],
    ["syntax positions", () => { syntaxAt("1 +", 3); syntaxAt("1 + * 2", 4); syntaxAt("(1 + 2", 6); syntaxAt("1 2", 2); syntaxAt("2 $ 3", 2); syntaxAt("", 0); syntaxAt("max(1,)", 6); syntaxAt("(1))", 3) }],
    ["unknown names", () => { assert.throws(() => evaluate("x + 1"), ReferenceError); assert.throws(() => evaluate("foo(1)"), ReferenceError) }],
    ["arity", () => { assert.throws(() => evaluate("abs(1, 2)"), TypeError); assert.throws(() => evaluate("min()"), TypeError); assert.throws(() => evaluate("sqrt()"), TypeError) }],
    ["division by zero", () => { assert.throws(() => evaluate("1 / 0"), RangeError); assert.throws(() => evaluate("5 % (2 - 2)"), RangeError) }]
  ]
})
