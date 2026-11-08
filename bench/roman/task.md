Write `solution.mjs` exporting two functions:

- `toRoman(n)`: the Roman numeral for an integer 1–3999, in standard form
  (`4` is `IV`, `1994` is `MCMXCIV`). Throw a `RangeError` for anything else:
  0, negatives, 4000 and up, non-integers, non-numbers.
- `fromRoman(s)`: the integer for a numeral in standard form, uppercase only.
  Throw a `RangeError` for anything that isn't one: the empty string,
  lowercase, unknown letters, and non-standard forms such as `IIII`, `VX`,
  `IC` or `MCMC`.
