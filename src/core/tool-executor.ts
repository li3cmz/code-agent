/**
 * Tool executor — shared logic for tool execution.
 */

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
