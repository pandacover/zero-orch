export function merge(intervals) {
  const out = []
  for (const iv of intervals) {
    const last = out[out.length - 1]
    if (last && iv[0] < last[1]) {
      last[1] = iv[1]
    } else {
      out.push(iv)
    }
  }
  return out
}
