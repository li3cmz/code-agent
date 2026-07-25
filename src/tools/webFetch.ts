/**
 * webFetch tool — fetch content from a URL.
 *
 * Tool permission: read (safe, no approval needed).
 */

import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../core/tool.js";

export const inputSchema = z.object({
  url: z.string().url().describe("URL to fetch content from"),
});

type Input = z.infer<typeof inputSchema>;

export const webFetchTool: Tool = {
  name: "webFetch",
  description: "Fetch content from a URL. Returns the response text. For HTML pages, returns the raw HTML. For APIs, returns the JSON/text response.",
  inputSchema,
  permission: () => "read",
  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input) as Input;
    
    try {
      const response = await fetch(parsed.url, {
        headers: {
          "User-Agent": "CodeAgent/1.0",
        },
      });
      
      if (!response.ok) {
        return { 
          success: false, 
          output: "", 
          error: `HTTP ${response.status}: ${response.statusText}` 
        };
      }
      
      const text = await response.text();
      
      // Truncate very long responses
      const maxLength = 50000;
      const truncated = text.length > maxLength 
        ? text.slice(0, maxLength) + `\n\n... (truncated, total ${text.length} chars)`
        : text;
      
      return { success: true, output: truncated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Fetch failed: ${message}` };
    }
  },
};
