/**
 * Expected failures. Each one gets a single line at the command line
 * (src/cli.ts), not a stack trace.
 */
import { Schema } from "effect"

/** A Claude Agent SDK run that didn't finish: it threw, or ended in an error result. */
export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  message: Schema.String
}) {}

/** The singularity command failed or printed something we can't read. */
export class MemoryError extends Schema.TaggedError<MemoryError>()("MemoryError", {
  message: Schema.String
}) {}

/** The genome on disk is missing or doesn't match its schema. */
export class GenomeError extends Schema.TaggedError<GenomeError>()("GenomeError", {
  message: Schema.String
}) {}

/** A git command failed, or the repo isn't in a state a generation can start from. */
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  message: Schema.String
}) {}

/** The benchmark couldn't be loaded or run. */
export class BenchError extends Schema.TaggedError<BenchError>()("BenchError", {
  message: Schema.String
}) {}
