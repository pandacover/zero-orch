/**
 * Whether a child genome replaces its parent.
 *
 * Score first: the child must pass more of the hidden cases. When it scores
 * the same, it wins only by being clearly cheaper. A change that is neither
 * is turned down, so the genome only moves when the benchmark says it should.
 */
import type { Scorecard } from "./Ledger.ts"

/** Score differences smaller than this are ties. */
export const SCORE_EPSILON = 0.005
/** A tie wins only if it costs at most this share of the parent's spend. */
export const CHEAPER_BY = 0.85

export interface Verdict {
  readonly accept: boolean
  readonly reason: string
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export const judge = (parent: Scorecard, child: Scorecard): Verdict => {
  const delta = child.score - parent.score
  if (delta > SCORE_EPSILON) {
    return { accept: true, reason: `score ${pct(parent.score)} → ${pct(child.score)} (${child.solved}/${child.tasks} solved)` }
  }
  if (delta < -SCORE_EPSILON) {
    return { accept: false, reason: `score fell ${pct(parent.score)} → ${pct(child.score)}` }
  }
  if (child.costUsd <= parent.costUsd * CHEAPER_BY) {
    return {
      accept: true,
      reason: `same score (${pct(child.score)}), cost $${parent.costUsd.toFixed(2)} → $${child.costUsd.toFixed(2)}`
    }
  }
  return {
    accept: false,
    reason: `same score (${pct(child.score)}) and not cheaper enough ($${parent.costUsd.toFixed(2)} → $${child.costUsd.toFixed(2)})`
  }
}
