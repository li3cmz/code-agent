/**
 * Tasks / Sub-agents system.
 *
 * Implements recursive delegation per Claude Code (ch08 Sub-Agents, ch09 Fork Agents, ch10 Tasks/Coordination).
 * 
 * A SubAgent runs its own query loop with:
 * - Independent message history
 * - Configurable tool subset
 * - "bubble" permission mode (cannot self-approve dangerous actions)
 * 
 * Reuses the main loop from loop.ts with custom options.
 */

import { loop, type QueryYield, type QueryOptions } from "./loop.js";
import { toolRegistry } from "./tool.js";
import { STATE } from "./state.js";
import { buildSystemPrompt } from "../prompts/system.js";
import type { Terminal } from "./messages.js";

/** Result from a sub-agent execution. */
export interface SubAgentResult {
  success: boolean;
  output: string;
  error?: string;
  toolCalls?: number;
  tokensUsed?: number;
}

/** Options for running a sub-agent. */
export interface SubAgentOptions {
  /** Task description for the sub-agent. */
  task: string;
  /** List of tool names available to the sub-agent (default: all). */
  tools?: string[];
  /** Maximum turns for the sub-agent. */
  maxTurns?: number;
  /** Permission mode for the sub-agent (default: bubble). */
  permissionMode?: "bubble";
  /** Callback for user approval requests (bubbled up). */
  onApprovalRequest?: (tool: string, input: unknown) => Promise<boolean>;
  /** Callback for streaming text. */
  onTextChunk?: (chunk: string) => void;
}

/**
 * Run a sub-agent with its own query loop.
 * 
 * The sub-agent operates independently with:
 * - Fresh message history (not inherited from parent)
 * - Tool subset restriction
 * - Bubble permission mode (all mutations require parent approval)
 * 
 * Reuses the main loop() with filtered tools and bubble permission mode.
 */
export async function runSubAgent(options: SubAgentOptions): Promise<SubAgentResult> {
  const {
    task,
    tools: allowedTools,
    maxTurns = 20,
    permissionMode = "bubble",
    onApprovalRequest,
    onTextChunk,
  } = options;

  // Determine available tools (filter registry by allowedTools)
  const availableTools = allowedTools 
    ? toolRegistry.getAll().filter(t => allowedTools.includes(t.name))
    : toolRegistry.getAll();

  if (availableTools.length === 0) {
    return {
      success: false,
      output: "",
      error: "No available tools for sub-agent",
    };
  }

  // Create tool name set for filtering
  const toolNames = new Set(availableTools.map(t => t.name));

  let toolCallCount = 0;
  let finalOutput = "";

  // Custom system prompt for sub-agent
  const customSystemPrompt = buildSystemPrompt() + 
    "\n\n[Sub-agent mode: You are a sub-agent. You must request approval for any mutation tool.]";

  try {
    // Reuse main loop with customizations
    for await (const event of loop({
      userMessage: task,
      maxTurns,
      permissionMode,
      allowedTools: toolNames,
      customSystemPrompt,
      onApprovalRequest,
      onTextChunk,
    })) {
      switch (event.type) {
        case "text":
          finalOutput += event.content;
          break;
        case "tool_start":
          toolCallCount++;
          break;
        case "tool_result":
          // Tool executed
          break;
        case "turn_end":
          // Track token usage from sub-agent
          STATE.addUsage({
            prompt_tokens: event.tokens,
            completion_tokens: 0,
            total_tokens: event.tokens,
          });
          break;
      }
    }
  } catch (e) {
    // The loop throws on terminal
    const err = e as { kind?: string; reason?: string };
    if (err.kind === "done") {
      return {
        success: true,
        output: finalOutput || "Task completed successfully",
        toolCalls: toolCallCount,
      };
    } else if (err.kind === "max_turns") {
      return {
        success: false,
        output: finalOutput,
        error: `Sub-agent reached max turns (${maxTurns})`,
        toolCalls: toolCallCount,
      };
    } else if (err.kind === "aborted") {
      return {
        success: false,
        output: finalOutput,
        error: "Sub-agent was aborted",
        toolCalls: toolCallCount,
      };
    }
    // Re-throw unknown errors
    throw e;
  }

  // If we exited normally without throwing, treat as success
  return {
    success: true,
    output: finalOutput || "Sub-agent finished",
    toolCalls: toolCallCount,
  };
}

/**
 * Check if a tool is allowed for a sub-agent.
 */
export function isToolAllowed(toolName: string, allowedTools: Set<string>): boolean {
  return allowedTools.has(toolName);
}
