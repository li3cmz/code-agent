/**
 * State — two-layer state management (Stage 4 will expand).
 *
 * Current: singleton STATE with cwd, model config, session id.
 * Later: reactive UI store + cost tracking.
 */

import { loadProviderConfig } from "./provider.js";

/** Global application state. */
class AppStateImpl {
  cwd = process.cwd();

  get config() {
    return loadProviderConfig();
  }

  sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  turn = 0;
  maxTurns = 100;
  planMode = false;
  approvedTools = new Set<string>();

  reset(): void {
    this.turn = 0;
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.planMode = false;
    this.approvedTools.clear();
  }

  nextTurn(): void {
    this.turn++;
  }
}

export const STATE = new AppStateImpl();

export type AppState = AppStateImpl;
