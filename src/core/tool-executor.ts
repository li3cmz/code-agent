/**
 * Tool executor — shared logic for tool execution.
 */

import { toolRegistry, executeTool } from "./tool.js";
import { STATE } from "./state.js";
import { checkPermission, type PermissionMode } from "./permissions.js";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Parse tool call arguments from JSON string.
 */
export function parseToolCallArguments(toolCall: ToolCall): unknown {
  try {
    return JSON.parse(toolCall.arguments);
  } catch {
    return {};
  }
}

/**
 * Execute a single tool with permission check and message building.
 * 
 * Used by both main loop and sub-agents.
 */
export async function executeToolWithContext(options: {
  toolCall: ToolCall;
  permissionMode: PermissionMode;
  messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }>;
  onApprovalRequest?: (tool: string, input: unknown) => Promise<boolean>;
  yield: (event: { type: "tool_start"; tool: string; input: unknown } | { type: "tool_result"; tool: string; result: { success: boolean; output: string; error?: string } }) => void;
}): Promise<{ done: boolean }> {
  const { toolCall, permissionMode, messages, onApprovalRequest, yield: yieldEvent } = options;
  const input = parseToolCallArguments(toolCall);

  yieldEvent({ type: "tool_start", tool: toolCall.name, input });

  const tool = toolRegistry.get(toolCall.name);
  if (!tool) {
    const result = { success: false, output: "", error: `Unknown tool: ${toolCall.name}` };
    yieldEvent({ type: "tool_result", tool: toolCall.name, result });
    messages.push({
      role: "tool",
      content: JSON.stringify(result),
      tool_call_id: toolCall.id,
      name: toolCall.name,
    } as any);
    return { done: false };
  }

  // Check permissions
  const permission = checkPermission(tool, permissionMode);
  if (!permission.allowed) {
    if (onApprovalRequest) {
      const approved = await onApprovalRequest(toolCall.name, input);
      if (!approved) {
        const result = { success: false, output: "", error: "User denied permission" };
        yieldEvent({ type: "tool_result", tool: toolCall.name, result });
        messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
          name: toolCall.name,
        } as any);
        return { done: false };
      }
    } else {
      const result = { success: false, output: "", error: permission.reason };
      yieldEvent({ type: "tool_result", tool: toolCall.name, result });
      messages.push({
        role: "tool",
        content: JSON.stringify(result),
        tool_call_id: toolCall.id,
        name: toolCall.name,
      } as any);
      return { done: false };
    }
  }

  // Execute the tool
  const result = await executeTool(toolCall.name, input, { cwd: STATE.cwd });
  yieldEvent({ type: "tool_result", tool: toolCall.name, result });

  messages.push({
    role: "tool",
    content: result.success ? result.output : JSON.stringify({ error: result.error }),
    tool_call_id: toolCall.id,
    name: toolCall.name,
  } as any);

  return { done: false };
}
