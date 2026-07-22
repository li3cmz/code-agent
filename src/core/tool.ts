/**
 * Tool system — interface, registry, and executor.
 *
 * Mirrors Claude Code's tool abstraction (ch06 Tools). A Tool has:
 * - name, description, JSON schema (zod-validated input)
 * - execute() — the actual implementation
 * - permission() — classifies as read vs mutate
 * - render() — optional UI presentation
 */

import { z } from "zod";

/** Input schema for a tool — zod-validated before execute(). */
export type ToolInput<T extends z.ZodSchema> = z.infer<T>;

/** Classification of what a tool does. */
export type ToolPermission = "read" | "mutate";

/** A tool definition. */
export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  permission: () => ToolPermission;
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>;
  render?: (input: unknown, result: ToolResult) => string;
}

export interface ToolContext {
  cwd: string;
}

/** Result of tool execution. */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/** Registry of all available tools. */
class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** List all tool names and their descriptions (for system prompt). */
  getManifest(): { name: string; description: string; input_schema: unknown }[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}

/** Global tool registry instance. */
export const toolRegistry = new ToolRegistry();

/** Validate tool input against schema, return parsed input or throw. */
export function validateToolInput(
  tool: Tool,
  raw: unknown
): unknown {
  return tool.inputSchema.parse(raw);
}

/**
 * Execute a tool by name with validated input.
 * Returns the result or throws if tool not found / validation fails.
 */
export async function executeTool(
  name: string,
  rawInput: unknown,
  context: ToolContext
): Promise<ToolResult> {
  const tool = toolRegistry.get(name);
  if (!tool) {
    return { success: false, output: "", error: `Unknown tool: ${name}` };
  }

  try {
    const input = validateToolInput(tool, rawInput);
    return await tool.execute(input, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: message };
  }
}
