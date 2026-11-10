/**
 * A QR code for a short text (the pairing link Settings shows), as an SVG.
 * Byte mode, error correction level M, the smallest version that fits, and
 * the mask with the lowest penalty: what ISO/IEC 18004 asks, without a
 * dependency. Follows Project Nayuki's reference encoder (MIT).
 */

/** Error correction codewords per block, and blocks, for level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
/** Level M in the format bits. */
const ECL_BITS = 0

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

const rawModules = (ver: number) => {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}
const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver]! * BLOCKS[ver]!

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
const gfMul = (x: number, y: number) => {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}
const rsDivisor = (degree: number) => {
  const result: Array<number> = Array.from({ length: degree - 1 }, () => 0)
  result.push(1)
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root)
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!
    }
    root = gfMul(root, 0x02)
  }
  return result
}
const rsRemainder = (data: ReadonlyArray<number>, divisor: ReadonlyArray<number>) => {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ result.shift()!
    result.push(0)
    divisor.forEach((coef, i) => (result[i]! ^= gfMul(coef, factor)))
  }
  return result
}

const alignmentPositions = (ver: number, size: number) => {
  if (ver === 1) return []
  const count = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
]

/** How hard a symbol is to scan: runs, blocks, finder look-alikes, and dark/light balance. */
const penalty = (m: ReadonlyArray<ReadonlyArray<boolean>>) => {
  const size = m.length
  let score = 0
  const finder = [true, false, true, true, true, false, true]
  const lines: Array<Array<boolean>> = []
  for (let i = 0; i < size; i++) {
    lines.push([...m[i]!])
    lines.push(m.map((row) => row[i]!))
  }
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++
      else {
        if (run >= 5) score += run - 2
        run = 1
      }
    }
    // A finder-like 1:1:3:1:1 with four light modules on either side (outside the symbol counts as light).
    for (let i = -4; i + 7 <= size + 4; i++) {
      if (!finder.every((d, k) => (line[i + k] ?? false) === d)) continue
      const lightBefore = [1, 2, 3, 4].every((k) => !(line[i - k] ?? false))
      const lightAfter = [0, 1, 2, 3].every((k) => !(line[i + 7 + k] ?? false))
      if (lightBefore || lightAfter) score += 40
    }
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = m[y]![x]
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3
    }
  }
  const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0)
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/** The symbol's modules, true for dark, row by row (no quiet zone). */
export const qrMatrix = (text: string): Array<Array<boolean>> => {
  const bytes = [...Buffer.from(text, "utf8")]
  let ver = 1
  const bitsNeeded = (v: number) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8
  while (ver <= 40 && bitsNeeded(ver) > dataCodewords(ver) * 8) ver++
  if (ver > 40) throw new Error("too long for a QR code")

  // The data: byte mode, its length, the bytes, a terminator, then padding to capacity.
  const bits: Array<number> = []
  const put = (value: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  put(0x4, 4)
  put(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const capacity = dataCodewords(ver) * 8
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: Array<number> = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // Split into blocks, add each one's error correction, and interleave.
  const numBlocks = BLOCKS[ver]!
  const eccLen = ECC_PER_BLOCK[ver]!
  const raw = Math.floor(rawModules(ver) / 8)
  const numShort = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks: Array<Array<number>> = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < numShort) dat.push(0)
    blocks.push([...dat, ...ecc])
  }
  const codewords: Array<number> = []
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i]!) })
  }

  // The function patterns.
  const size = ver * 4 + 17
  const modules = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const fixed = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const set = (x: number, y: number, dark: boolean) => { modules[y]![x] = dark; fixed[y]![x] = true }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  const align = alignmentPositions(ver, size)
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)
      if (corner) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(align[i]! + dx, align[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  const drawFormat = (mask: number) => {
    const d = (ECL_BITS << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i))
    set(8, 7, bit(b, 6))
    set(8, 8, bit(b, 7))
    set(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i))
    set(8, size - 8, true)
  }
  drawFormat(0) // reserves its modules; drawn for real once the mask is chosen
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), c = Math.floor(i / 3)
      set(a, c, bit(b, i))
      set(c, a, bit(b, i))
    }
  }

  // The codewords, zigzagging up and down in two-module columns from the right.
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (!fixed[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7))
          i++
        }
      }
    }
  }

  const masked = (mask: number) => {
    drawFormat(mask)
    return modules.map((row, y) => row.map((dark, x) => (!fixed[y]![x] && MASKS[mask]!(x, y) ? !dark : dark)))
  }
  let best = masked(0)
  let bestScore = penalty(best)
  for (let mask = 1; mask < 8; mask++) {
    const m = masked(mask)
    const s = penalty(m)
    if (s < bestScore) { best = m; bestScore = s }
  }
  return best
}

/** The QR code as a standalone SVG: dark modules on white, with the four-module quiet zone scanners need. */
export const qrSvg = (text: string): string => {
  const m = qrMatrix(text)
  const n = m.length + 8
  let d = ""
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let w = 1
      while (row[x + w]) w++
      d += `M${x + 4} ${y + 4}h${w}v1h-${w}z`
      x += w - 1
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
