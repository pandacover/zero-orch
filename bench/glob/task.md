Write `solution.mjs` exporting `match(pattern, path)`, which says whether a
`/`-separated path matches a glob pattern. The whole path must match.

- `?` matches one character other than `/`.
- `*` matches any run of characters other than `/`, including none.
- `**` as a whole segment matches any number of segments, including none:
  `**/x` matches `x` and `a/b/x`; `a/**/b` matches `a/b` and `a/x/y/b`; a
  trailing `a/**` matches everything below `a` (`a/b`, `a/b/c`) but not `a`.
- `[abc]`, `[a-z]` match one character from the set; `[!a-z]` one character
  not in it (and never `/`).
- `{a,b,c}` matches any of the alternatives, which may themselves contain
  patterns and nested braces: `{a,{b,c}d}` matches `a`, `bd` and `cd`.
- `\` makes the next character literal: `\*.md` matches only `*.md`.
- Dot files: a path segment starting with `.` is matched only by a pattern
  segment that starts with a literal `.`. So `*`, `?`, `[...]` and `**` never
  match a segment's leading dot: `*.js` doesn't match `.a.js`, and `**/x`
  doesn't match `.git/x`.
