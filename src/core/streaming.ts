/**
 * Streaming utilities — shared logic for streaming model responses.
 *
 * This module contains common streaming logic used by both
 * the main loop and sub-agents.
 */

import type { ChatCompletionChunk } from "openai/resources/index.js";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Stream tool calls from model response, accumulating arguments across chunks.
 * 
 * @param response - AsyncIterable of ChatCompletionChunk
 * @param onText - Callback for text content
 * @param onToolCall - Callback for each tool call (called when tool call is complete)
 * @returns The complete assistant message text
 */
export async function streamResponse<T>(
  response: AsyncIterable<T>,
  onText: (text: string) => void,
  onToolCall?: (toolCalls: ToolCall[]) => void
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  let assistantMessage = "";
  let toolCalls: ToolCall[] = [];

  for await (const chunk of response) {
    const delta = (chunk as any).choices[0]?.delta;
    
    if (delta?.content) {
      assistantMessage += delta.content;
      onText(delta.content);
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

  // Notify that tool calls are complete
  if (onToolCall && toolCalls.length > 0) {
    onToolCall(toolCalls);
  }

  return { content: assistantMessage, toolCalls };
}
