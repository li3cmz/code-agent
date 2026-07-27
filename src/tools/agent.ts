/**
 * Agent tool — spawn a sub-agent to handle a task.
 *
 * This tool allows the parent agent to delegate work to a sub-agent
 * with its own execution loop and potentially restricted tools.
 */

import { z } from "zod";
import { runSubAgent, type SubAgentResult } from "../core/agent-runner.js";
import { toolRegistry } from "../core/tool.js";
import type { Tool, ToolResult, ToolContext } from "../core/tool.js";

/** Input schema for the agent tool. */
const agentInputSchema = z.object({
  /** The task to delegate to the sub-agent. */
  task: z.string().describe("The task description for the sub-agent"),
  /** Optional list of tool names available to the sub-agent. */
  tools: z.array(z.string()).optional().describe("List of tool names available to the sub-agent (default: all)"),
  /** Maximum turns for the sub-agent. */
  maxTurns: z.number().min(1).max(100).optional().default(20).describe("Maximum turns for the sub-agent"),
});

type AgentInput = z.infer<typeof agentInputSchema>;

/**
 * Get all registered tool names for reference.
 */
function getAvailableToolNames(): string[] {
  return toolRegistry.getAll().map(t => t.name);
}

/** Agent tool implementation. */
export const agentTool: Tool = {
  name: "agent",
  description: "Spawn a sub-agent to handle a task. The sub-agent runs its own query loop with independent history. Use this for complex multi-step tasks that benefit from isolation.",
  inputSchema: agentInputSchema,
  permission: () => "mutate", // Agent spawns new execution - always treated as mutation

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    // Parse and validate input
    const parsed = agentInputSchema.parse(input);
    const { task, tools, maxTurns } = parsed;

    // Validate tools if specified
    const availableTools = getAvailableToolNames();
    if (tools) {
      const invalidTools = tools.filter(t => !availableTools.includes(t));
      if (invalidTools.length > 0) {
        return {
          success: false,
          output: "",
          error: `Unknown tools: ${invalidTools.join(", ")}. Available: ${availableTools.join(", ")}`,
        };
      }
    }

    // Run the sub-agent
    const result: SubAgentResult = await runSubAgent({
      task,
      tools,
      maxTurns,
      permissionMode: "bubble",
    });

    // Format output
    if (result.success) {
      return {
        success: true,
        output: formatSubAgentResult(result),
      };
    } else {
      return {
        success: false,
        output: formatSubAgentResult(result),
        error: result.error,
      };
    }
  },

  render(input: unknown, result: ToolResult): string {
    const typed = input as AgentInput;
    const taskPreview = typed.task.slice(0, 50) + (typed.task.length > 50 ? "..." : "");
    const toolCount = typed.tools?.length ?? 0;
    
    if (result.success) {
      return `Agent: "${taskPreview}" (tools: ${toolCount || "all"}) - completed`;
    } else {
      return `Agent: "${taskPreview}" - failed: ${result.error}`;
    }
  },
};

/**
 * Format sub-agent result for display.
 */
function formatSubAgentResult(result: SubAgentResult): string {
  const parts: string[] = [];
  
  if (result.toolCalls !== undefined) {
    parts.push(`${result.toolCalls} tool calls`);
  }
  
  if (result.output) {
    // Truncate long outputs
    const output = result.output.length > 500 
      ? result.output.slice(0, 500) + "..."
      : result.output;
    parts.push(`Output: ${output}`);
  }
  
  if (result.error) {
    parts.push(`Error: ${result.error}`);
  }
  
  return parts.join(" | ") || (result.success ? "Completed" : "Failed");
}
