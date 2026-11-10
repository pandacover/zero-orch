import { describe, expect, it } from "vitest"
import { qrMatrix, qrSvg } from "../src/app/Qr.ts"

const LINK = "https://desk.tail1234.ts.net/pair?code=abcd2345wxyz"

/** A finder pattern's 7x7 rings, read off the matrix at its top-left corner. */
const finderAt = (m: Array<Array<boolean>>, x: number, y: number) =>
  Array.from({ length: 7 }, (_, dy) => Array.from({ length: 7 }, (_, dx) => (m[y + dy]![x + dx] ? "#" : ".")).join("")).join("\n")
const FINDER = ["#######", "#.....#", "#.###.#", "#.###.#", "#.###.#", "#.....#", "#######"].join("\n")

describe("QR codes", () => {
  it("takes the smallest version a pairing link fits", () => {
    expect(qrMatrix(LINK)).toHaveLength(33) // version 4 at level M holds 62 bytes
    expect(qrMatrix("a")).toHaveLength(21) // version 1
    expect(qrMatrix("x".repeat(300))).toHaveLength(13 * 4 + 17)
  })

  it("has its three finder patterns, timing lines and dark module where scanners look", () => {
    const m = qrMatrix(LINK)
    const n = m.length
    expect(finderAt(m, 0, 0)).toBe(FINDER)
    expect(finderAt(m, n - 7, 0)).toBe(FINDER)
    expect(finderAt(m, 0, n - 7)).toBe(FINDER)
    for (let i = 8; i < n - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0)
      expect(m[i]![6]).toBe(i % 2 === 0)
    }
    expect(m[n - 8]![8]).toBe(true)
  })

  it("writes the format bits twice, the same both times", () => {
    const m = qrMatrix(LINK)
    const n = m.length
    const first = [0, 1, 2, 3, 4, 5, 7, 8].map((y) => m[y]![8]).concat([7, 5, 4, 3, 2, 1, 0].map((x) => m[8]![x]))
    const second = Array.from({ length: 8 }, (_, i) => m[8]![n - 1 - i]).concat(Array.from({ length: 7 }, (_, i) => m[n - 7 + i]![8]))
    expect(first).toEqual(second)
    // Level M: the top two of the 15 bits (14 and 13, read here lowest first) are 00, under the mask 101010000010010.
    const bits = first.map(Number)
    expect([bits[14]! ^ 1, bits[13]! ^ 0]).toEqual([0, 0])
  })

  it("is the same every time for the same text, and different for another", () => {
    expect(qrMatrix(LINK)).toEqual(qrMatrix(LINK))
    expect(qrMatrix(LINK)).not.toEqual(qrMatrix(LINK.replace("abcd", "abce")))
  })

  it("draws as an SVG with a white quiet zone of four modules", () => {
    const svg = qrSvg(LINK)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 41 41" shape-rendering="crispEdges">/)
    expect(svg).toContain('<rect width="41" height="41" fill="#fff"/>')
    // The top-left finder's top row: seven dark modules from (4,4).
    expect(svg).toContain("M4 4h7v1h-7z")
  })

  it("holds text outside ASCII as UTF-8, and refuses what no QR code holds", () => {
    expect(qrMatrix("é✓").length).toBe(21)
    expect(() => qrMatrix("x".repeat(3000))).toThrow(/too long/)
  })
})
