Write `solution.mjs` exporting `order(deps)`. `deps` maps each node name to
the names it depends on, e.g. `{ app: ["lib", "util"], lib: ["util"] }`.
A name that appears only as a dependency is a node too.

Return every node once, each after all of its dependencies. When several
nodes are ready at once, take them in alphabetical order, so the output is
deterministic: `order({ app: ["lib", "util"], lib: ["util"] })` is
`["util", "lib", "app"]`.

If the graph has a cycle, throw an `Error` whose message contains the cycle
as `a -> b -> a`: start from the alphabetically first node on the cycle,
follow dependency edges, and end where you started. A node depending on
itself is the cycle `a -> a`. If there are several cycles, report the one
through the alphabetically first node that is on any cycle.
