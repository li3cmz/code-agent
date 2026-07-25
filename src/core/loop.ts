/**
 * Query loop — the heart of the agent.
 *
 * Async generator: stream model → collect tool calls → execute → append results → loop.
 * Yields typed messages. Returns a discriminated Terminal union.
 *
 * Mirrors Claude Code's query loop (ch05 Agent Loop).
 */

import { getModelClient } from "./provider.js";
import { toolRegistry, executeTool, type Tool } from "./tool.js";
import { STATE } from "./state.js";
import { checkPermission, getEffectiveModeOnce, type PermissionMode } from "./permissions.js";
import type { ChatMessage, Terminal } from "./messages.js";
import { buildSystemPrompt } from "../prompts/system.js";

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
  onApprovalRequest?: (tool: Tool, input: unknown) => Promise<boolean>;
  /** Callback for streaming text chunks. */
  onTextChunk?: (chunk: string) => void;
}

export type QueryYield =
  | { type: "text"; content: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; result: { success: boolean; output: string; error?: string } }
  | { type: "turn"; turn: number };

/**
 * Main query loop — async generator.
 *
 * Usage:
 *   for await (const event of query({ userMessage: "Hello" })) {
 *     // handle event
 *   }
 */
export async function* loop(options: QueryOptions): AsyncGenerator<QueryYield, Terminal, unknown> {
  const { userMessage, maxTurns = STATE.maxTurns, permissionMode = "default", onApprovalRequest, onTextChunk } = options;

  // Get effective mode BEFORE reset (supports temporary one-shot mode)
  const effectiveMode = permissionMode === "default"
    ? getEffectiveModeOnce()
    : permissionMode;

  const { client, model } = await getModelClient();

  STATE.reset();

  // Build message history - use OpenAI message format
  const messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }> = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: userMessage },
  ];

  let iterations = 0;

  while (iterations < maxTurns) {
    STATE.nextTurn();
    yield { type: "turn", turn: STATE.turn };

    // Call the model
    const tools = toolRegistry.getManifest();
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

    let assistantMessage = "";
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    // Stream the response
    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        assistantMessage += delta.content;
        onTextChunk?.(delta.content);
        yield { type: "text", content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          // First chunk has id, subsequent chunks have index
          const tcIndex = tc.index ?? 0;

          // Try to find existing by id (first chunk) or index (subsequent chunks)
          let existing = toolCalls.find((t) => t.id === tc.id);
          if (!existing && tc.id) {
            // New tool call - create entry
            existing = { id: tc.id, name: tc.function?.name || "", arguments: "" };
            toolCalls.push(existing);
          } else if (!existing && tcIndex < toolCalls.length) {
            // Use index for subsequent chunks (Azure OpenAI streams by index)
            existing = toolCalls[tcIndex];
          }

          // Add arguments if present
          if (existing && tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
          }
        }
      }
    }

    // Add assistant message to history (must include tool_calls if present)
    if (assistantMessage || toolCalls.length > 0) {
      const assistantMsg: {
        role: "assistant";
        content?: string;
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      } = { role: "assistant" };

      if (assistantMessage) {
        assistantMsg.content = assistantMessage;
      }

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
    const parsedToolCalls = toolCalls.map((tc) => {
      let input: unknown;
      try {
        input = JSON.parse(tc.arguments);
      } catch {
        input = {};
      }
      return { tc, input };
    });

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
    // First, yield tool_start for all read tools
    for (const { tc, input } of readCalls) {
      yield { type: "tool_start", tool: tc.name, input };
    }

    // Execute read tools in parallel
    const readResults = await Promise.all(
      readCalls.map(async ({ tc, input }) => {
        const tool = toolRegistry.get(tc.name);
        if (!tool) {
          return { tc, result: { success: false, output: "", error: `Unknown tool: ${tc.name}` } };
        }

        // Check permissions for read tools (usually allowed, but check anyway)
        const permission = checkPermission(tool, effectiveMode);
        if (!permission.allowed) {
          if (onApprovalRequest) {
            const approved = await onApprovalRequest(tool, input);
            if (!approved) {
              return { tc, result: { success: false, output: "", error: "User denied permission" } };
            }
          } else {
            return { tc, result: { success: false, output: "", error: permission.reason } };
          }
        }

        const { result } = await executeToolWithRetry(tc.name, input, { cwd: STATE.cwd });
        return { tc, result };
      })
    );

    // Yield tool_result for all read tools and add to messages
    for (const { tc, result } of readResults) {
      yield { type: "tool_result", tool: tc.name, result };
      messages.push({
        role: "tool",
        content: result.success ? result.output : JSON.stringify({ error: result.error }),
        tool_call_id: tc.id,
        name: tc.name,
      } as any);
    }

    // Execute mutate tools serially
    for (const { tc, input } of mutateCalls) {
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

      // Execute the tool with retry
      const { result } = await executeToolWithRetry(tc.name, input, { cwd: STATE.cwd });
      yield { type: "tool_result", tool: tc.name, result };

      messages.push({
        role: "tool",
        content: result.success ? result.output : JSON.stringify({ error: result.error }),
        tool_call_id: tc.id,
        name: tc.name,
      } as any);
    }

    iterations++;
  }

  return { kind: "max_turns", reason: "max_turns_exhausted" };
}
