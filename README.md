<img src="assets/icon.svg" width="64" height="64" alt="">

# zero

A recursive self-improving agent, built with the Claude Agent SDK, TypeScript
and Effect, on [singularity](https://github.com/pandacover/singularity)'s
procedural memory.

zero rewrites its own **genome**: the instructions, lessons and settings its
agents run with. A benchmark with hidden tests scores each version. A change
is kept only if it wins; zero commits it, and singularity stores it under
the improver session whose edits it holds. The next time zero improves
itself, singularity hands it the past improvement most like the one it's
about to make. Each improvement then starts from how earlier improvements were
made, not only from their scores.

## The loop

```
             ┌──────────────── genome/ (in git) ─────────────────┐
             │ solver.md   lessons.md   genome.json   improver.md │
             └───────┬───────────────────────────────▲───────────┘
                     │ runs with                     │ rewrites (incl. improver.md itself)
                     ▼                               │
  bench/ ──► solver sessions ──► hidden checks ──► scorecard ──► improver session ◄── singularity recall
                                                                     │                (past improvements)
                                          measure the child ◄────────┘
                                                 │
                         wins? ── yes ──► zero commits genome/ ──► singularity store (filed under the improver)
                                 └─ no ──► revert genome/, log to ledger
```

One generation (`src/Generation.ts`):

1. Start from a clean tree, so every change after this is the improver's.
2. Score the current genome on `bench/`, or reuse its score from the ledger.
3. `singularity recall` the past improvement most like this one.
4. Run the **improver**, an Agent SDK session in this repo. Its system prompt
   is `genome/improver.md`, which it may also rewrite; that is what makes the
   loop recursive. It gets the scorecard (failed checks, the solver's last
   words), the ledger of earlier attempts, and the recalled commit. It edits
   `genome/`, then runs `npm run typecheck` and `npm test`.
5. Guard: only `genome/` may change, and the new genome must parse.
6. Score the child. If it beats the parent (a higher score, or the same score
   for at least 15% less cost), zero commits `genome/` and runs `singularity
   store`. singularity files the commit under the improver's session, because
   that session's edits are the commit's lines, with its task and the checks
   it ran. If the child doesn't win, every file is put back.
7. Write the attempt to `.zero/ledger.jsonl`, whether it won or lost.

## Where singularity comes in

singularity stores a commit when an agent session made it and the last check
before it passed, and later recalls it for a similar task. zero uses that at
both levels:

| | recalls | stores |
|---|---|---|
| **improver** (zero on itself) | the past *self-improvement* most like this one | each accepted genome change, filed under the improver session that made the edit |
| **solver** (`zero solve` on your repos) | the past change in that repo most like the task | the solver's commit, after the repo's checks pass |

Sessions whose work gets committed run with `persistSession: true` and `cwd`
set to the repo root: singularity finds a commit's session by its Claude Code
transcript, either the session that ran `git commit` or, when none did, the one
whose edits the commit adds.

## Commands

```sh
npm install
node src/cli.ts bench [--task intervals]           # score the current genome (no changes)
node src/cli.ts generation                         # one generation
node src/cli.ts evolve --generations 3 --budget-usd 25
node src/cli.ts solve "add a --json flag" --cwd ../some-repo
node src/cli.ts lineage                            # attempts, verdicts, what singularity stored
npm run typecheck && npm test                      # all offline: fake agent and memory layers
```

### Control plane

```sh
npm run ui                    # then open http://127.0.0.1:4747  (--port to change it)
```

A chat app in the browser, instead of the CLI:

- **Projects:** folders on this machine. zero itself is the first one; add more
  with **+ Add project** by pasting a folder's path.
- **Threads:** conversations with Claude (through the Agent SDK) in a project.
  Text streams in a line at a time; each run of tool calls folds into one
  row that opens to show every call and its output. Under the message box,
  pick the model and effort (one menu, models grouped by provider) and what
  Claude may do without asking: **Ask first**, **Auto-edit** (edits in the
  project run freely), **Full access** (edits and commands run without
  asking) or **Read-only**. A change applies at once, even mid-turn. A
  command or edit that needs approval waits as a card in the thread:
  **Allow** / **Deny**, or `Y` / `N`.
- **singularity in every thread:** a thread's first message in a git project is
  handed the most similar past change there ("Recalled from memory"); a turn
  that commits is stored for the next thread ("Stored in memory").
- **zero's genome in every thread:** threads get zero's evolved solver
  instructions and lessons, so what evolution learns reaches your work.
- **Evolution:** the lineage chart, Benchmark / Generation / Evolve runs with
  live output, and every attempt.
- **Settings:** Claude's model and effort, the default access, memory, and the
  genome toggle. Saved as you change them.

Keys: `Alt+N` new thread, `Enter` send (`Shift+Enter` new line), `Esc` stop.

Threads, projects and settings live in `~/.zero` (`ZERO_HOME` to move them).
The server listens only on 127.0.0.1, refuses any other Host header, and wants
a token minted at startup on every API call. Codex and Ollama providers exist
in `src/app/providers/` but are off: Codex's Windows sandbox asks for admin
elevation on every command.

A generation refuses to start on a dirty tree: commit or stash first.
`evolve` runs each generation in a fresh process, so it always reads the
genome and code the last generation left. It stops at the budget, and stops on
the first generation that fails.

## Cost

Every default model is `claude-opus-5-5` (`genome/genome.json`). The improver
may change effort and turn limits, and cost counts against it. One real
benchmark task cost about $0.58. Expect roughly $3–4 for the six-task
benchmark, and $5–8 for a generation (child benchmark plus improver; the parent
is measured only once). Per-session caps are `maxBudgetUsd` $2 per solver task,
$5 per improver, and $10 per `solve`.

## Safety

- Every tool call Claude Code would ask permission for goes through
  `src/Policy.ts`, which decides in code. The improver can write only
  `genome/`. A shell command that could change anything must be on an
  allowlist (checks, read-only git, singularity), and chained, piped or
  redirected ones are denied. It can't `git add` or commit at all. (Claude
  Code itself runs commands it recognizes as read-only, such as `ls`, `cat`
  or `git log`, without asking, even chained; dogfooding showed the improver
  doing this freely. They can't write, and the next guard checks anyway.)
- After the session, git independently checks which files changed. Anything
  outside `genome/` is reverted without being measured.
- The benchmark and the judge (`bench/`, `src/Fitness.ts`) sit outside the
  genome, so the improver can't edit the test it is graded on.
- The solver can't go looking for the hidden tests. Its workspaces live in the
  OS temp dir, outside this repo; its reads stay inside its workspace; and a
  genome that mentions `check.mjs`, `bench/`, `.zero/` or this repo's path
  is rejected without being measured.
- Sessions load no settings files (`settingSources: []`) and get only
  Read/Glob/Grep/Edit/Write/Bash: no web, no subagents.
- The solver may run `node`, which can execute anything. The policy limits what
  the model reaches for, but it isn't a sandbox.

## Layout

```
genome/            what zero may rewrite (solver.md, lessons.md, improver.md, genome.json)
bench/<task>/      task.md, optional files/, hidden check.mjs   (bench/_lib: the check harness)
src/Claude.ts      Agent service: query() as an Effect Stream, abort on interrupt
src/Singularity.ts Memory service: recall / store / changes via the singularity CLI
src/Policy.ts      per-session tool permissions
src/Bench.ts       fitness: solver sessions + hidden checks → scorecard
src/Fitness.ts     the accept/reject rule
src/Generation.ts  one generation
src/Solve.ts       the evolved solver on a real repo
src/app/           the control plane: server, threads, store, providers (ui/ is the page)
src/cli.ts         effect/cli commands
test/              offline tests with fake Agent and Memory layers
```

## Next steps

- **Source scope:** let the improver edit `src/` too (except the judge). Gate
  it on typecheck and tests, and run the benchmark in a child process so the
  new code is what gets measured. `evolve` already runs each generation in a
  fresh process.
- **Noise:** each task runs once, so small score differences may be luck. A
  `--reps` flag and re-measuring the parent would make the accept rule
  stricter.
- **Held-out tasks:** keep some benchmark tasks out of the improver's
  scorecard, and report them separately to catch overfitting.
