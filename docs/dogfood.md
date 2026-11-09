# Dogfooding zero on zero (2026-11-09)

zero was run on its own repo, on the branch `zero/dogfood`, in two ways:

1. **Evolution:** zero measured and rewrote its own genome (`zero bench`,
   `zero generation`, `zero evolve`).
2. **The control plane:** Claude threads in the zero project, started from
   the running app's API, built real features in zero's own code and
   committed them. Approval cards were answered by
   `scripts/drive-thread.mjs`, which plays a careful person: it allows edits
   inside the project and a short list of commands (checks, git, node), and
   denies the rest.

Only Claude was used (Codex stays off: its Windows sandbox asks for admin
elevation on every command). Everything ran headless.

## What happened

### Evolution: 6 generations, 2 kept

| gen | change the improver made | score | benchmark cost | verdict |
|---|---|---|---|---|
| base | Opus 5.5, effort medium | 100% (6 tasks) | $3.38 | |
| 1 | solver effort medium → low | 100% | $3.19 | turned down (needs 15% cheaper) |
| 2 | leaner solver.md | 100% | $3.27 | turned down |
| 3 | effort low + 3-step solver.md | 100% | $3.22 | turned down |
| 4 | **solver Opus → Sonnet 5.5** | 100% | **$1.66** | **kept** (781d38c) |
| 5 | **solver Sonnet → Haiku 5.5** | 100% | **$0.11** | **kept** (f9cef20) |
| — | benchmark grows to 9 tasks (calc, diff, glob) | 100% | $0.16 | re-measured |
| 6 | effort low + leaner solver.md | 100% | $0.16 | turned down |

The genome now runs the solver on Haiku 5.5 and solves every task, 30×
cheaper than where it started.

### Control plane: zero improving zero

| thread | task | result | cost |
|---|---|---|---|
| 1 | add `--reps N` to bench / generation / evolve | committed 5009bb3, tests added, stored in singularity | $1.52 |
| 2 | expose reps in the Evolution page | **singularity recalled thread 1's commit**; committed a709436, stored | $1.03 |
| 3 | show cost on the lineage chart | committed a85908b after three turns (see below) | $4.03 |

## What dogfooding found, and what was fixed

1. **The improver didn't know which settings existed.** Gen 1 only ever
   thought of effort. Fix e248f1a: its prompt lists each genome setting, its
   value and its range; `genome.json` only accepts known models.
2. **A test vetoed evolution.** Gens 2, 3 and 4 *did* switch the solver to
   Sonnet, ran `npm test`, saw a test fail and backed the change out: the
   test copied zero's live genome and pinned its model (another pinned the
   live `improver.md`, which would block the improver rewriting itself, the
   recursive part). Fix 0cb58be: tests use a fixture genome.
3. **The improver didn't know the solver's environment.** It told the solver
   to check its work with `node -e`, which the solver's shell refuses. Fix
   0cb58be: the improver's prompt carries the solver's shell rules. Gen 6's
   improver then named the real limit itself.
4. **Resuming the improver to commit failed and bought nothing.** Replaying
   its long context ran past the $0.50 budget both times; zero's fallback
   commit was stored by singularity anyway, filed under the improver
   session whose edits it holds. Fix 14347b5: zero commits directly. Also
   fixed a doubled "gen 5: gen 5:" subject.
5. **The benchmark was too easy.** Every model scored 100%, so evolution
   could only buy cost, and walked the solver down to Haiku. The three
   harder tasks (3c90909, validated against reference solutions) didn't
   change that: Haiku 5.5 solves them too.
6. **Multi-turn threads overcounted cost.** The Agent SDK reports a resumed
   session's running total; each turn was recorded with every earlier turn
   in it (thread 3's 38-second third turn read $4.03). Fix e139ac5: each
   turn is charged the difference.
7. **The lineage chart hid the night.** Every point sat at 100%; the wins
   were in cost. Thread 3 (zero itself) added cost labels; 95295d5 makes
   each label and row show the cost its verdict was judged on.
8. **The README overstated the permission policy.** Claude Code runs
   commands it recognizes as read-only (`ls`, `cat`, chained) without
   asking; the improver did this freely. They can't write, and the git
   check after the session catches anything that does. README corrected.

## What's still open

- **A benchmark that separates models.** Algorithm-sized tasks don't any
  more. It needs repo-scale tasks (several files, a real codebase, a
  failing test suite to fix). Until then, evolution optimizes cost only.
- **`zero solve` now runs on Haiku,** because that's what the genome
  evolved to. Control-plane threads aren't affected (they use the model in
  Settings, Opus 5.5 by default), but `zero solve` on real work is. Revert
  with `git revert f9cef20` if that matters before the benchmark improves.
- **singularity rarely helps the improver.** Recall matches words, and
  evolution keeps rewriting the same few genome lines, so an earlier
  improvement soon reads as "gone". The ledger in the improver's prompt
  carries the lineage better. Where singularity clearly helped was in code:
  thread 2 was handed thread 1's commit and finished faster and cheaper.
- **singularity skipped thread 3's commit** as "more than one session was
  committing": the driver's own command line, running from another agent
  session, contained the word "commit". A harness artifact, but also a
  false positive in singularity worth fixing there.
- **The running app needs a restart** to pick up the server-side fixes
  (per-turn cost, the reps field in the jobs API). The page itself is
  served fresh from disk.
- Ledger reasons written before 14347b5 still say "committed by zero, not
  the session: singularity may not store it"; singularity did store both.

## Cost

About $28 in all: $19.28 in the ledger (benchmarks and improvers),
about $2.50 the ledger missed (two stopped generations and two failed
commit sessions), and $6.58 for the three control-plane threads.
