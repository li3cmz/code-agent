/**
 * Tasks / Sub-agents system.
 *
 * Implements recursive delegation per Claude Code (ch08 Sub-Agents, ch09 Fork Agents, ch10 Tasks/Coordination).
 * 
 * A SubAgent runs its own query loop with:
 * - Independent message history
 * - Configurable tool subset
 * - "bubble" permission mode (cannot self-approve dangerous actions)
 */

import { toolRegistry } from "./tool.js";
import { STATE } from "./state.js";
import { checkPermission, type PermissionMode } from "./permissions.js";
import type { Terminal } from "./messages.js";

/** Query yield types (without Terminal since that's the return type) */
type QueryYield =
  | { type: "text"; content: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; result: { success: boolean; output: string; error?: string } }
  | { type: "turn"; turn: number }
  | { type: "usage"; promptTokens: number; completionTokens: number; totalTokens: number; cost: number }
  | { type: "turn_end"; turn: number; tokens: number; cost: number };

/** SubAgent execution state. */
export type SubAgentStatus = "pending" | "running" | "completed" | "failed" | "killed";

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
  permissionMode?: PermissionMode;
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

  // Create a filtered registry for the sub-agent
  // We handle this in the loop by checking tool permissions
  const toolNames = new Set(availableTools.map(t => t.name));

  let toolCallCount = 0;
  let finalOutput = "";

  try {
    // Create a modified loop that filters tools
    const subAgentLoop = createSubAgentLoop({
      task,
      allowedTools: toolNames,
      maxTurns,
      permissionMode,
      onApprovalRequest,
      onTextChunk,
    });

    // Run the sub-agent loop
    // Note: The loop returns Terminal after yielding all events
    // We handle this via for-await-of which will throw after the generator returns

    let lastTurnEnd: { tokens: number } | null = null;

    try {
      for await (const event of subAgentLoop) {
        switch (event.type) {
          case "text":
            finalOutput += event.content;
            break;
          case "tool_start":
            toolCallCount++;
            break;
          case "tool_result":
            if (!event.result.success) {
              // Tool failed, but continue - sub-agent might recover
            }
            break;
          case "turn_end":
            // Track token usage from sub-agent
            lastTurnEnd = { tokens: event.tokens };
            STATE.addUsage({
              prompt_tokens: event.tokens,
              completion_tokens: 0,
              total_tokens: event.tokens,
            });
            break;
        }
      }
    } catch (e) {
      // The loop throws when it returns - this is expected
      // Check if it's the terminal return value
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

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: finalOutput,
      error: `Sub-agent error: ${message}`,
      toolCalls: toolCallCount,
    };
  }
}

/** Create a modified query loop for sub-agent execution. */
function createSubAgentLoop(options: {
  task: string;
  allowedTools: Set<string>;
  maxTurns: number;
  permissionMode: PermissionMode;
  onApprovalRequest?: (tool: string, input: unknown) => Promise<boolean>;
  onTextChunk?: (chunk: string) => void;
}): AsyncGenerator<QueryYield, Terminal, unknown> {
  const { task, allowedTools, maxTurns, permissionMode, onApprovalRequest, onTextChunk } = options;

  // Create a custom loop that filters tools for the sub-agent
  return createFilteredLoop({
    userMessage: task,
    maxTurns,
    permissionMode,
    allowedTools,
    onApprovalRequest,
    onTextChunk,
  });
}

/**
 * Create a filtered loop that only allows specific tools.
 * This wraps the main loop but filters tool manifest.
 */
async function* createFilteredLoop(options: {
  userMessage: string;
  maxTurns: number;
  permissionMode: PermissionMode;
  allowedTools: Set<string>;
  onApprovalRequest?: (tool: string, input: unknown) => Promise<boolean>;
  onTextChunk?: (chunk: string) => void;
}): AsyncGenerator<QueryYield, Terminal, unknown> {
  const { 
    userMessage, 
    maxTurns, 
    permissionMode, 
    allowedTools,
    onApprovalRequest, 
    onTextChunk 
  } = options;

  const { client, model } = await import("./provider.js").then(m => m.getModelClient());
  const { buildSystemPrompt } = await import("../prompts/system.js");

  STATE.reset();
  
  // Build message history
  const messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }> = [
    { role: "system", content: buildSystemPrompt() + "\n\n[Sub-agent mode: You are a sub-agent. You must request approval for any mutation tool.]" },
    { role: "user", content: userMessage },
  ];

  let iterations = 0;

  while (iterations < maxTurns) {
    STATE.nextTurn();
    
    // Get filtered tool manifest
    const allTools = toolRegistry.getManifest();
    const filteredTools = allTools.filter(t => allowedTools.has(t.name));

    yield { type: "turn", turn: STATE.turn };

    // Call the model with filtered tools
    const response = await client.chat.completions.create({
      model,
      messages: messages as any,
      tools: filteredTools.length > 0 ? filteredTools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as Record<string, unknown>,
        },
      })) : undefined,
      stream: true,
    });

    let assistantMessage = "";
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    // Stream response
    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        assistantMessage += delta.content;
        onTextChunk?.(delta.content);
        yield { type: "text", content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const tcIndex = tc.index ?? 0;
          
          let existing = toolCalls.find(t => t.id === tc.id);
          if (!existing && tc.id) {
            existing = { id: tc.id, name: tc.function?.name || "", arguments: "" };
            toolCalls.push(existing);
          } else if (!existing && tcIndex < toolCalls.length) {
            existing = toolCalls[tcIndex];
          }

          if (existing && tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
          }
        }
      }
    }

    // Clear text for next response
    if (assistantMessage || toolCalls.length > 0) {
      const assistantMsg: {
        role: "assistant";
        content: string;
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      } = { role: "assistant", content: assistantMessage || "" };

      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      messages.push(assistantMsg);
    }

    // No tool calls - we're done
    if (toolCalls.length === 0) {
      return { kind: "done", reason: "completed" };
    }

    // Parse tool inputs
    const parsedToolCalls = toolCalls.map((tc) => {
      let input: unknown;
      try {
        input = JSON.parse(tc.arguments);
      } catch {
        input = {};
      }
      return { tc, input };
    });

    // Execute tools
    for (const { tc, input } of parsedToolCalls) {
      yield { type: "tool_start", tool: tc.name, input };

      const tool = toolRegistry.get(tc.name);
      if (!tool) {
        const result = { success: false, output: "", error: `Unknown tool: ${tc.name}` };
        yield { type: "tool_result", tool: tc.name, result };
        messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: tc.id,
          name: tc.name,
        } as any);
        continue;
      }

      // Check permissions
      const permission = checkPermission(tool, permissionMode);
      if (!permission.allowed) {
        // Bubble mode: need parent approval
        if (onApprovalRequest) {
          const approved = await onApprovalRequest(tc.name, input);
          if (!approved) {
            const result = { success: false, output: "", error: "User denied permission" };
            yield { type: "tool_result", tool: tc.name, result };
            messages.push({
              role: "tool",
              content: JSON.stringify(result),
              tool_call_id: tc.id,
              name: tc.name,
            } as any);
            continue;
          }
        } else {
          const result = { success: false, output: "", error: permission.reason };
          yield { type: "tool_result", tool: tc.name, result };
          messages.push({
            role: "tool",
            content: JSON.stringify(result),
            tool_call_id: tc.id,
            name: tc.name,
          } as any);
          continue;
        }
      }

      // Execute tool
      const { executeTool } = await import("./tool.js");
      const result = await executeTool(tc.name, input, { cwd: STATE.cwd });
      yield { type: "tool_result", tool: tc.name, result };

      messages.push({
        role: "tool",
        content: result.success ? result.output : JSON.stringify({ error: result.error }),
        tool_call_id: tc.id,
        name: tc.name,
      } as any);
    }

    // Finalize turn cost
    const turnCost = STATE.finalizeTurnCost();
    yield {
      type: "turn_end",
      turn: STATE.turn,
      tokens: turnCost.totalTokens,
      cost: turnCost.cost,
    };

    iterations++;
  }

  return { kind: "max_turns", reason: "max_turns_exhausted" };
}

/**
 * Check if a tool is allowed for a sub-agent.
 */
export function isToolAllowed(toolName: string, allowedTools: Set<string>): boolean {
  return allowedTools.has(toolName);
}
