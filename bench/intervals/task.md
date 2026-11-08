`intervals.mjs` has `merge(intervals)`, which should take an array of
`[start, end]` pairs (`start <= end`, any order) and return the merged,
non-overlapping intervals sorted by start. Intervals that overlap or touch
(`[1, 2]` and `[2, 5]`) merge. It must not change its input.

It has bugs. Fix them in `intervals.mjs`, keeping its export.
