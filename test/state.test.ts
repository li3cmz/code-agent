import { describe, it, expect, beforeEach } from "vitest";
import { STATE, type TokenUsage, type TurnCost } from "../src/core/state.js";
import { UI, type UIState } from "../src/core/ui.js";

describe("STATE - Token & Cost Tracking", () => {
  beforeEach(() => {
    STATE.reset();
  });

  describe("Token usage", () => {
    it("should start with zero tokens", () => {
      expect(STATE.tokens.totalTokens).toBe(0);
      expect(STATE.tokens.promptTokens).toBe(0);
      expect(STATE.tokens.completionTokens).toBe(0);
    });

    it("should add token usage from API response", () => {
      STATE.addUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      });

      expect(STATE.tokens.promptTokens).toBe(100);
      expect(STATE.tokens.completionTokens).toBe(50);
      expect(STATE.tokens.totalTokens).toBe(150);
    });

    it("should accumulate token usage across multiple API calls", () => {
      STATE.addUsage({ prompt_tokens: 100, completion_tokens: 50 });
      STATE.addUsage({ prompt_tokens: 200, completion_tokens: 100 });

      expect(STATE.tokens.promptTokens).toBe(300);
      expect(STATE.tokens.completionTokens).toBe(150);
      expect(STATE.tokens.totalTokens).toBe(450);
    });
  });

  describe("Cost calculation", () => {
    it("should calculate cost correctly", () => {
      // Default pricing: $2.50/1M input, $10.00/1M output
      // 1000 prompt tokens = $0.0025
      // 1000 completion tokens = $0.01
      const cost = STATE.calculateCost(1000, 1000);
      expect(cost).toBe(0.0125); // $0.0025 + $0.01
    });

    it("should calculate cost for given tokens", () => {
      const cost = STATE.calculateCost(100, 50);
      // 100/1000 * 0.0025 + 50/1000 * 0.01 = 0.00025 + 0.0005 = 0.00075
      expect(cost).toBe(0.00075);
    });

    it("should track total cost", () => {
      STATE.nextTurn();
      STATE.addUsage({ prompt_tokens: 1000, completion_tokens: 1000 });
      STATE.finalizeTurnCost();

      expect(STATE.totalCost).toBe(0.0125);
    });

    it("should track per-turn costs", () => {
      // Simulate turn 1
      STATE.nextTurn();
      STATE.addUsage({ prompt_tokens: 1000, completion_tokens: 500 });
      const turn1 = STATE.finalizeTurnCost();
      expect(turn1.turn).toBe(1);
      expect(turn1.cost).toBeCloseTo(0.0075, 4);

      // Simulate turn 2
      STATE.nextTurn();
      STATE.addUsage({ prompt_tokens: 500, completion_tokens: 500 });
      const turn2 = STATE.finalizeTurnCost();
      expect(turn2.turn).toBe(2);
      // 500 prompt = 500/1000*0.0025 = 0.00125
      // 500 completion = 500/1000*0.01 = 0.005
      // Total = 0.00625
      expect(turn2.cost).toBeCloseTo(0.00625, 4);

      expect(STATE.turnCosts).toHaveLength(2);
      // Turn 1: 0.0075, Turn 2: 0.00625, Total: 0.01375
      expect(STATE.totalCost).toBeCloseTo(0.01375, 4);
    });
  });

  describe("Current turn tokens", () => {
    it("should track current turn tokens separately", () => {
      STATE.addUsage({ prompt_tokens: 100, completion_tokens: 50 });
      
      const current = STATE.currentTurnTokens;
      expect(current.promptTokens).toBe(100);
      expect(current.completionTokens).toBe(50);

      // Session tokens should also be updated
      expect(STATE.tokens.promptTokens).toBe(100);
    });

    it("should reset current turn tokens after finalizeTurnCost", () => {
      STATE.nextTurn();
      STATE.addUsage({ prompt_tokens: 100, completion_tokens: 50 });
      STATE.finalizeTurnCost();

      expect(STATE.currentTurnTokens.promptTokens).toBe(0);
      expect(STATE.currentTurnTokens.completionTokens).toBe(0);
    });
  });

  describe("getCostSummary", () => {
    it("should return formatted summary", () => {
      STATE.nextTurn();
      STATE.addUsage({ prompt_tokens: 1500, completion_tokens: 750 });
      STATE.finalizeTurnCost();

      const summary = STATE.getCostSummary();
      expect(summary).toContain("2,250"); // total tokens
      expect(summary).toContain("$"); // cost
    });
  });
});

describe("UI Store", () => {
  beforeEach(() => {
    UI.reset();
  });

  it("should start with empty state", () => {
    const state = UI.get();
    expect(state.currentTool).toBeNull();
    expect(state.isToolRunning).toBe(false);
    expect(state.accumulatedText).toBe("");
    expect(state.turn).toBe(0);
  });

  it("should set current tool", () => {
    UI.setCurrentTool("readFile", { path: "test.txt" });

    const state = UI.get();
    expect(state.currentTool).toBe("readFile");
    expect(state.currentToolInput).toEqual({ path: "test.txt" });
    expect(state.isToolRunning).toBe(true);
  });

  it("should clear current tool", () => {
    UI.setCurrentTool("readFile");
    UI.clearCurrentTool();

    const state = UI.get();
    expect(state.currentTool).toBeNull();
    expect(state.isToolRunning).toBe(false);
  });

  it("should accumulate text", () => {
    UI.appendText("Hello ");
    UI.appendText("World");

    const state = UI.get();
    expect(state.accumulatedText).toBe("Hello World");
  });

  it("should clear text", () => {
    UI.appendText("Hello");
    UI.clearText();

    const state = UI.get();
    expect(state.accumulatedText).toBe("");
  });

  it("should set turn number", () => {
    UI.setTurn(5);
    expect(UI.get().turn).toBe(5);
  });

  it("should notify subscribers on change", () => {
    let notifyCount = 0;
    UI.subscribe(() => notifyCount++);

    UI.setCurrentTool("test");
    expect(notifyCount).toBe(1);

    UI.clearCurrentTool();
    expect(notifyCount).toBe(2);

    UI.appendText("a");
    expect(notifyCount).toBe(3);
  });

  it("should return unsubscribe function", () => {
    let count = 0;
    const unsub = UI.subscribe(() => count++);

    UI.setCurrentTool("test");
    expect(count).toBe(1);

    unsub();
    UI.setCurrentTool("test2");
    expect(count).toBe(1); // Should not increment after unsubscribe
  });
});
