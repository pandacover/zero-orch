Write `solution.mjs` exporting `evaluate(src)`, which evaluates an arithmetic
expression and returns a number.

- Numbers: `12`, `1.5`, `.5`, `1e3`, `2.5e-2`. Constants: `pi` and `e`.
- Binary operators by precedence, lowest first: `+ -`, then `* / %`, then
  `^`. `+ - * / %` are left-associative; `^` is right-associative
  (`2 ^ 3 ^ 2` is 512).
- Unary `+` and `-`, which may repeat (`--3` is 3). `^` binds tighter than
  unary minus: `-2 ^ 2` is -4, and `2 ^ -1` is 0.5.
- Parentheses, and calls: `min(...)` and `max(...)` take one or more
  arguments, `abs(x)` and `sqrt(x)` exactly one. Whitespace is ignored.

Errors:

- A `SyntaxError` for anything that isn't a well-formed expression. Its
  message must contain `at N`, where N is the index in `src` of the first
  character of the token that can't be there, or `src.length` when the input
  ends too early: `"1 +"` fails `at 3`, `"1 + * 2"` fails `at 4`.
- A `ReferenceError` for an unknown name or function.
- A `TypeError` for a call with the wrong number of arguments.
- A `RangeError` for division or `%` by zero.
