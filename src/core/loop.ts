/**
 * Query loop — the heart of the agent.
 *
 * Async generator: stream model → collect tool calls → execute → append results → loop.
 * Yields typed messages. Returns a discriminated Terminal union.
 *
 * Mirrors Claude Code's query loop (ch05 Agent Loop).
 */

import { getModelClient } from "./provider.js";
import { toolRegistry, executeTool } from "./tool.js";
import { STATE } from "./state.js";
import { UI } from "./ui.js";
import { checkPermission, getEffectiveModeOnce, type PermissionMode } from "./permissions.js";
import type { ChatMessage, Terminal } from "./messages.js";
import { buildSystemPrompt } from "../prompts/system.js";
import { streamResponse } from "./streaming.js";
import { parseToolCallArguments, type ToolCall } from "./tool-executor.js";

/** Maximum retries for tool execution on validation error */
const MAX_TOOL_RETRIES = 2;

/**
 * Execute a tool with retry on validation error.
 * Returns the result and whether it's a retryable error.
 */
async function executeToolWithRetry(
  toolName: string,
  input: unknown,
  context: { cwd: string }
): Promise<{ result: { success: boolean; output: string; error?: string }; retries: number }> {
  let retries = 0;

  while (retries <= MAX_TOOL_RETRIES) {
    const result = await executeTool(toolName, input, context);

    // Success or non-validation error - return
    if (result.success || !isValidationError(result.error)) {
      return { result, retries };
    }

    // Validation error - retry
    retries++;
    if (retries <= MAX_TOOL_RETRIES) {
      console.log(`  ⚠️  Tool ${toolName} validation failed (attempt ${retries}/${MAX_TOOL_RETRIES}): ${result.error}`);
    }
  }

  // All retries exhausted - return last result
  const finalResult = await executeTool(toolName, input, context);
  return { result: finalResult, retries: MAX_TOOL_RETRIES };
}

/**
 * Check if an error is a validation error (retryable).
 */
function isValidationError(error?: string): boolean {
  if (!error) return false;
  const validationPatterns = [
    "Required",
    "expected",
    "received undefined",
    "invalid",
    "must be",
    "schema",
  ];
  return validationPatterns.some((p) => error.toLowerCase().includes(p.toLowerCase()));
}

export interface QueryOptions {
  /** Initial user message. */
  userMessage: string;
  /** Maximum turns (defaults to STATE.maxTurns). */
  maxTurns?: number;
  /** Permission mode (defaults to 'default'). */
  permissionMode?: PermissionMode;
  /** Callback for user approval prompts. */
  onApprovalRequest?: (tool: any, input: unknown) => Promise<boolean>;
  /** Callback for streaming text chunks. */
  onTextChunk?: (chunk: string) => void;
  /** Optional tool name filter for sub-agents */
  allowedTools?: Set<string>;
  /** Optional custom system prompt (for sub-agents) */
  customSystemPrompt?: string;
}

export type QueryYield =
  | { type: "text"; content: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; result: { success: boolean; output: string; error?: string } }
  | { type: "turn"; turn: number }
  | { type: "usage"; promptTokens: number; completionTokens: number; totalTokens: number; cost: number }
  | { type: "turn_end"; turn: number; tokens: number; cost: number };

/**
 * Main query loop — async generator.
 *
 * Usage:
 *   for await (const event of query({ userMessage: "Hello" })) {
 *     // handle event
 *   }
 */
export async function* loop(options: QueryOptions): AsyncGenerator<QueryYield, Terminal, unknown> {
  const {
    userMessage,
    maxTurns = STATE.maxTurns,
    permissionMode: initialPermissionMode = "default",
    onApprovalRequest,
    onTextChunk,
    allowedTools,
    customSystemPrompt,
  } = options;

  // Get effective mode BEFORE reset (supports temporary one-shot mode)
  const effectiveMode = initialPermissionMode === "default"
    ? getEffectiveModeOnce()
    : initialPermissionMode;

  const { client, model } = await getModelClient();

  STATE.reset();
  UI.reset();

  // Build message history - use custom or default system prompt
  const systemPrompt = customSystemPrompt || buildSystemPrompt();
  const messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  let iterations = 0;

  while (iterations < maxTurns) {
    STATE.nextTurn();
    UI.setTurn(STATE.turn);
    yield { type: "turn", turn: STATE.turn };

    // Get tool manifest (filtered for sub-agents)
    const allTools = toolRegistry.getManifest();
    const tools = allowedTools 
      ? allTools.filter(t => allowedTools.has(t.name))
      : allTools;

    // Call the model
    const response = await client.chat.completions.create({
      model,
      messages: messages as any,
      tools: tools.length > 0 ? tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as Record<string, unknown>,
        },
      })) : undefined,
      stream: true,
    });

    // Stream the response using shared utility
    let toolCalls: ToolCall[] = [];
    let assistantMessage = "";
    const { content } = await streamResponse(
      response,
      (text) => {
        assistantMessage += text;
        onTextChunk?.(text);
        UI.appendText(text);
        // We can't yield here directly - handle after stream completes
      },
      (tcs) => { toolCalls = tcs; }
    );
    assistantMessage = content;

    // Yield accumulated text
    if (assistantMessage) {
      yield { type: "text", content: assistantMessage };
    }

    // Add assistant message to history (must include tool_calls if present)
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

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      return { kind: "done", reason: "completed" };
    }

    // Parse tool inputs
    const parsedToolCalls = toolCalls.map((tc) => ({
      tc,
      input: parseToolCallArguments(tc),
    }));

    // Separate into read (parallel) and mutate (serial) tool calls
    const readCalls = parsedToolCalls.filter((p) => {
      const tool = toolRegistry.get(p.tc.name);
      return tool && tool.permission() === "read";
    });
    const mutateCalls = parsedToolCalls.filter((p) => {
      const tool = toolRegistry.get(p.tc.name);
      return !tool || tool.permission() === "mutate";
    });

    // Execute read tools in parallel
    for (const { tc, input } of readCalls) {
      UI.setCurrentTool(tc.name, input);
      yield { type: "tool_start", tool: tc.name, input };

      const tool = toolRegistry.get(tc.name);
      if (!tool) {
        const result = { success: false, output: "", error: `Unknown tool: ${tc.name}` };
        yield { type: "tool_result", tool: tc.name, result };
        messages.push({
          role: "tool",
          content: result.success ? result.output : JSON.stringify({ error: result.error }),
          tool_call_id: tc.id,
          name: tc.name,
        } as any);
        continue;
      }

      // Check permissions for read tools (usually allowed, but check anyway)
      const permission = checkPermission(tool, effectiveMode);
      if (!permission.allowed) {
        if (onApprovalRequest) {
          const approved = await onApprovalRequest(tool, input);
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

      const { result } = await executeToolWithRetry(tc.name, input, { cwd: STATE.cwd });
      yield { type: "tool_result", tool: tc.name, result };
      messages.push({
        role: "tool",
        content: result.success ? result.output : JSON.stringify({ error: result.error }),
        tool_call_id: tc.id,
        name: tc.name,
      } as any);
    }

    // Clear current tool
    UI.clearCurrentTool();

    // Execute mutate tools serially
    for (const { tc, input } of mutateCalls) {
      UI.setCurrentTool(tc.name, input);
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
      const permission = checkPermission(tool, effectiveMode);
      if (!permission.allowed) {
        // Need user approval
        if (onApprovalRequest) {
          const approved = await onApprovalRequest(tool, input);
          if (!approved) {
            const result = { success: false, output: "", error: "User denied permission" };
            UI.clearCurrentTool();
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
          UI.clearCurrentTool();
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

      // Execute the tool with retry
      const { result } = await executeToolWithRetry(tc.name, input, { cwd: STATE.cwd });
      UI.clearCurrentTool();
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
