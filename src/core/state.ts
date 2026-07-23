/**
 * State — two-layer state management (Stage 4 will expand).
 *
 * Current: singleton STATE with cwd, model config, session id.
 * Later: reactive UI store + cost tracking.
 */

import { loadProviderConfig } from "./provider.js";
import type { PermissionMode } from "./permissions.js";

/** Global application state. */
class AppStateImpl {
  cwd = process.cwd();

  get config() {
    return loadProviderConfig();
  }

  sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  turn = 0;
  maxTurns = 100;

  // Permission mode: default | plan | acceptEdits | dontAsk
  private _mode: PermissionMode = "default";

  get mode(): PermissionMode {
    return this._mode;
  }

  set mode(value: PermissionMode) {
    this._mode = value;
  }

  // Legacy support - planMode is now derived from mode
  get planMode(): boolean {
    return this._mode === "plan";
  }

  set planMode(value: boolean) {
    this._mode = value ? "plan" : "default";
  }

  approvedTools = new Set<string>();

  reset(): void {
    this.turn = 0;
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this._mode = "default";
    this.approvedTools.clear();
  }

  nextTurn(): void {
    this.turn++;
  }
}

export const STATE = new AppStateImpl();

export type AppState = AppStateImpl;
