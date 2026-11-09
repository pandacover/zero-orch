Write `solution.mjs` exporting `diff(a, b)`, a line diff. `a` and `b` are
arrays of strings. Return an array of operations, each one of:

- `{ op: "keep", line }`: a line of `a` that stays,
- `{ op: "del", line }`: a line of `a` that goes,
- `{ op: "add", line }`: a line of `b` that's new.

Read in order, `keep` and `del` operations walk through `a`, and `keep` and
`add` operations walk through `b`, so the operations turn `a` into `b`.

The diff must be minimal: as few `del` and `add` operations as possible (so
as many `keep`s as the longest common subsequence allows). Within each run of
changes between two `keep`s (or the ends), every `del` comes before every
`add`. Inputs can have a few thousand lines each.
