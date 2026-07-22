/**
 * writeEditFile tool — create or edit files.
 *
 * Tool permission: mutate (requires approval).
 */

import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../core/tool.js";

export const inputSchema = z.object({
  path: z.string().describe("Path to the file to create or edit"),
  content: z.string().describe("Content to write to the file"),
  append: z.boolean().optional().default(false).describe("Append to file instead of overwriting"),
});

type Input = z.infer<typeof inputSchema>;

export const writeEditFileTool: Tool = {
  name: "writeEditFile",
  description: "Create a new file or overwrite an existing file with new content.",
  inputSchema,
  permission: () => "mutate",
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input) as Input;
    try {
      // Resolve path relative to cwd
      const filePath = path.isAbsolute(parsed.path)
        ? parsed.path
        : path.resolve(context.cwd, parsed.path);

      // Basic sandbox check
      if (!filePath.startsWith(context.cwd)) {
        return { success: false, output: "", error: "Access denied: path is outside the allowed directory" };
      }

      // Ensure parent directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      if (parsed.append) {
        await fs.appendFile(filePath, parsed.content, "utf-8");
      } else {
        await fs.writeFile(filePath, parsed.content, "utf-8");
      }

      const action = parsed.append ? "appended to" : "written to";
      return { success: true, output: `Successfully ${action} ${filePath}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: message };
    }
  },
};
