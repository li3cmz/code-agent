/**
 * State — two-layer state management.
 *
 * Layer 1: Session state (persistent across turns)
 * Layer 2: Reactive UI state (for real-time updates)
 */

import { loadProviderConfig } from "./provider.js";
import type { PermissionMode } from "./permissions.js";

/** Token usage for a single turn. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Cost tracking per turn. */
export interface TurnCost {
  turn: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number; // USD
}

/** Pricing info (can be updated via config). */
export interface Pricing {
  promptPer1k: number;  // $ per 1K input tokens
  completionPer1k: number; // $ per 1K output tokens
}

/** Default pricing for GPT-4o/GPT-5 models (Azure OpenAI). */
export const DEFAULT_PRICING: Pricing = {
  promptPer1k: 0.0025,   // $2.50 per 1M input
  completionPer1k: 0.01,  // $10.00 per 1M output
};

/** Global application state. */
class AppStateImpl {
  cwd = process.cwd();

  get config() {
    return loadProviderConfig();
  }

  sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  turn = 0;
  maxTurns = 100;

  // ==========================================
  // Layer 1: Session State (persistent)
  // ==========================================

  /** Token usage tracking for current session. */
  tokens: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  /** Cost tracking for current session. */
  totalCost = 0;

  /** Per-turn cost history. */
  turnCosts: TurnCost[] = [];

  /** Pricing configuration. */
  pricing: Pricing = DEFAULT_PRICING;

  /** Current turn's token usage (accumulated during turn). */
  private _currentTurnTokens: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  get currentTurnTokens(): TokenUsage {
    return this._currentTurnTokens;
  }

  /** Calculate cost from token usage. */
  calculateCost(promptTokens: number, completionTokens: number): number {
    return (
      (promptTokens / 1000) * this.pricing.promptPer1k +
      (completionTokens / 1000) * this.pricing.completionPer1k
    );
  }

  /** Add token usage from an API response. */
  addUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void {
    const prompt = usage.prompt_tokens ?? 0;
    const completion = usage.completion_tokens ?? 0;
    const total = usage.total_tokens ?? prompt + completion;

    // Update current turn
    this._currentTurnTokens.promptTokens += prompt;
    this._currentTurnTokens.completionTokens += completion;
    this._currentTurnTokens.totalTokens += total;

    // Update session total
    this.tokens.promptTokens += prompt;
    this.tokens.completionTokens += completion;
    this.tokens.totalTokens += total;
  }

  /** Finalize current turn's cost and reset for next turn. */
  finalizeTurnCost(): TurnCost {
    const turnCost: TurnCost = {
      turn: this.turn,
      promptTokens: this._currentTurnTokens.promptTokens,
      completionTokens: this._currentTurnTokens.completionTokens,
      totalTokens: this._currentTurnTokens.totalTokens,
      cost: this.calculateCost(
        this._currentTurnTokens.promptTokens,
        this._currentTurnTokens.completionTokens
      ),
    };

    this.totalCost += turnCost.cost;
    this.turnCosts.push(turnCost);

    // Reset for next turn
    this._currentTurnTokens = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    return turnCost;
  }

  /** Get formatted cost summary. */
  getCostSummary(): string {
    const { promptTokens, completionTokens, totalTokens } = this.tokens;
    return `Tokens: ${totalTokens.toLocaleString()} (prompt: ${promptTokens.toLocaleString()}, completion: ${completionTokens.toLocaleString()}) | Cost: $${this.totalCost.toFixed(4)}`;
  }

  // ==========================================
  // Permission Mode
  // ==========================================

  // Permission mode: default | plan | acceptEdits | dontAsk
  private _mode: PermissionMode = "default";

  get mode(): PermissionMode {
    return this._mode;
  }

  set mode(value: PermissionMode) {
    this._mode = value;
  }

  // Temporary permission mode (single-use)
  private _tempMode: PermissionMode | null = null;

  get tempMode(): PermissionMode | null {
    return this._tempMode;
  }

  // Get temp mode and clear it (single-use)
  consumeTempMode(): PermissionMode | null {
    const mode = this._tempMode;
    this._tempMode = null;
    return mode;
  }

  setTempMode(mode: PermissionMode | null): void {
    this._tempMode = mode;
  }

  // Legacy support - planMode is now derived from mode
  get planMode(): boolean {
    return this._mode === "plan";
  }

  set planMode(value: boolean) {
    this._mode = value ? "plan" : "default";
  }

  approvedTools = new Set<string>();

  // ==========================================
  // Layer 2: Reactive UI State
  // ==========================================

  /** Current tool being executed (for UI display). */
  currentTool: string | null = null;

  /** Whether a tool is currently running. */
  isToolRunning = false;

  reset(): void {
    this.turn = 0;
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this._mode = "default";
    this._tempMode = null;
    this.approvedTools.clear();
    this.resetUsage();
  }

  resetUsage(): void {
    this.tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.totalCost = 0;
    this.turnCosts = [];
    this._currentTurnTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  nextTurn(): void {
    this.turn++;
  }
}

export const STATE = new AppStateImpl();

export type AppState = AppStateImpl;
