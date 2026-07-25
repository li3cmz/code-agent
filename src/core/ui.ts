/**
 * Reactive UI Store — Layer 2 of two-layer state.
 *
 * Provides reactive updates for real-time UI feedback during streaming.
 * Subscribers get notified when state changes.
 */

type Listener = () => void;

/** UI state that changes during a turn. */
export interface UIState {
  /** Current tool being executed. */
  currentTool: string | null;
  /** Tool input being executed. */
  currentToolInput: unknown;
  /** Whether a tool is running. */
  isToolRunning: boolean;
  /** Accumulated text from model (for live display). */
  accumulatedText: string;
  /** Current turn number. */
  turn: number;
}

/** Reactive store for UI state. */
class UIStoreImpl {
  private state: UIState = {
    currentTool: null,
    currentToolInput: null,
    isToolRunning: false,
    accumulatedText: "",
    turn: 0,
  };

  private listeners: Set<Listener> = new Set();

  /** Get current state. */
  get(): UIState {
    return this.state;
  }

  /** Subscribe to state changes. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notify all listeners. */
  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Set current tool. */
  setCurrentTool(tool: string | null, input: unknown = null): void {
    this.state = {
      ...this.state,
      currentTool: tool,
      currentToolInput: input,
      isToolRunning: tool !== null,
    };
    this.notify();
  }

  /** Clear current tool (tool finished). */
  clearCurrentTool(): void {
    this.state = {
      ...this.state,
      currentTool: null,
      currentToolInput: null,
      isToolRunning: false,
    };
    this.notify();
  }

  /** Append text to accumulated text. */
  appendText(text: string): void {
    this.state = {
      ...this.state,
      accumulatedText: this.state.accumulatedText + text,
    };
    this.notify();
  }

  /** Clear accumulated text. */
  clearText(): void {
    this.state = {
      ...this.state,
      accumulatedText: "",
    };
    this.notify();
  }

  /** Set turn number. */
  setTurn(turn: number): void {
    this.state = {
      ...this.state,
      turn,
    };
    this.notify();
  }

  /** Reset all state. */
  reset(): void {
    this.state = {
      currentTool: null,
      currentToolInput: null,
      isToolRunning: false,
      accumulatedText: "",
      turn: 0,
    };
    this.notify();
  }
}

export const UI = new UIStoreImpl();

export type { UIStoreImpl };
