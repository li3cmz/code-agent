/**
 * readFile tool — read the contents of a file.
 *
 * Tool permission: read (safe, no approval needed).
 */

import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../core/tool.js";

export const inputSchema = z.object({
  path: z.string().describe("Path to the file to read"),
});

type Input = z.infer<typeof inputSchema>;

export const readFileTool: Tool = {
  name: "readFile",
  description: "Read the contents of a file. Returns the file contents or an error.",
  inputSchema,
  permission: () => "read",
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input) as Input;
    try {
      // Resolve path relative to cwd
      const filePath = path.isAbsolute(parsed.path)
        ? parsed.path
        : path.resolve(context.cwd, parsed.path);

      // Basic sandbox check - don't allow paths outside cwd
      if (!filePath.startsWith(context.cwd)) {
        return { success: false, output: "", error: "Access denied: path is outside the allowed directory" };
      }

      const content = await fs.readFile(filePath, "utf-8");
      return { success: true, output: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: message };
    }
  },
};
