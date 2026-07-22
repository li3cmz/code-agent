/**
 * Shared message and result types.
 *
 * These mirror (a subset of) Claude Code's message model: the query loop yields
 * typed messages, and terminates with a discriminated `Terminal` union that
 * encodes *why* it stopped. Kept intentionally small for Stage 0; expanded as
 * later stages land.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
}

/** Why the query loop stopped. */
export type Terminal =
  | { kind: "done"; reason: "completed" }
  | { kind: "aborted"; reason: "user_abort" }
  | { kind: "max_turns"; reason: "max_turns_exhausted" }
  | { kind: "error"; reason: "unrecoverable"; error: unknown };
