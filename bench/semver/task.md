Write `solution.mjs` exporting `compare(a, b)` for Semantic Versioning 2.0.0
version strings. It returns -1, 0 or 1 by SemVer precedence:

- `MAJOR.MINOR.PATCH`, compared numerically.
- An optional pre-release after `-` (dot-separated identifiers) has lower
  precedence than the release. Identifiers compare one by one: numeric ones
  numerically, others in ASCII order, and a numeric one is lower than a
  non-numeric one; a shorter list is lower when all before it are equal.
- Build metadata after `+` is ignored.
- Throw a `TypeError` for an invalid version: missing parts, a leading `v`,
  leading zeros in a numeric part or numeric pre-release identifier, empty
  identifiers, or characters outside `[0-9A-Za-z-]`.
