Write `solution.mjs` exporting `parseCSV(text)`, which parses CSV as RFC 4180
describes it and returns an array of rows, each an array of strings.

- Fields are separated by commas, rows by `\n` or `\r\n`.
- A field may be wrapped in double quotes; then it may contain commas, line
  breaks, and quotes written twice (`""` is one `"`).
- Empty fields are empty strings: `a,,b` is three fields.
- One line break at the very end of the input doesn't start another row.
  The empty string parses to `[]`.
- Throw a `SyntaxError` for a quoted field that never closes, or for anything
  other than a comma or line break right after a closing quote.
