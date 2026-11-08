import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

await suite("solution.mjs", ({ parseCSV }) => [
  ["simple", () => assert.deepEqual(parseCSV("a,b\nc,d"), [["a", "b"], ["c", "d"]])],
  ["trailing newline", () => assert.deepEqual(parseCSV("a,b\n"), [["a", "b"]])],
  ["crlf", () => assert.deepEqual(parseCSV("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]])],
  ["empty input", () => assert.deepEqual(parseCSV(""), [])],
  ["empty fields", () => assert.deepEqual(parseCSV("a,,b\n,\n"), [["a", "", "b"], ["", ""]])],
  ["quoted comma", () => assert.deepEqual(parseCSV('"a,b",c'), [["a,b", "c"]])],
  ["escaped quote", () => assert.deepEqual(parseCSV('"say ""hi""",x'), [['say "hi"', "x"]])],
  ["newline in quotes", () => assert.deepEqual(parseCSV('"l1\nl2",z\r\nq,w'), [["l1\nl2", "z"], ["q", "w"]])],
  ["empty quoted", () => assert.deepEqual(parseCSV('"",""'), [["", ""]])],
  ["blank line row", () => assert.deepEqual(parseCSV("a\n\nb"), [["a"], [""], ["b"]])],
  ["unclosed", () => assert.throws(() => parseCSV('"abc,d'), SyntaxError)],
  ["junk after quote", () => assert.throws(() => parseCSV('"ab"c,d'), SyntaxError)]
])
