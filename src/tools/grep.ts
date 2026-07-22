/**
 * grep tool — search for patterns in files.
 *
 * Tool permission: read (safe).
 */

import { z } from "zod";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../core/tool.js";

export const inputSchema = z.object({
  pattern: z.string().describe("Regular expression pattern to search for"),
  path: z.string().optional().describe("Path to search in (file or directory, defaults to cwd)"),
  include: z.string().optional().describe("Glob pattern for files to include (e.g., '*.ts')"),
  context: z.number().optional().default(0).describe("Number of context lines to show"),
});

type Input = z.infer<typeof inputSchema>;

// Simple grep implementation without external dependency
async function grepFiles(
  pattern: string,
  dirPath: string,
  includePattern?: string,
  contextLines: number = 0
): Promise<string> {
  const fs = await import("fs/promises");
  const results: string[] = [];
  const regex = new RegExp(pattern, "g");
  const maxResults = 100;

  async function walkDir(dir: string): Promise<void> {
    if (results.length >= maxResults) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dir, entry.name);

      // Skip node_modules and hidden directories
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        // Check include pattern
        if (includePattern) {
          const globMatch = matchGlob(entry.name, includePattern);
          if (!globMatch) continue;
        }

        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const lines = content.split("\n");
          let found = false;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line !== undefined && regex.test(line)) {
              found = true;
              const start = Math.max(0, i - contextLines);
              const end = Math.min(lines.length - 1, i + contextLines);

              let matchLines = "";
              for (let j = start; j <= end; j++) {
                const marker = j === i ? ">" : " ";
                matchLines += `${marker}${j + 1}: ${lines[j] ?? ""}\n`;
              }
              results.push(`${fullPath}:${i + 1}\n${matchLines}`);
            }
            regex.lastIndex = 0; // Reset regex state
          }
        } catch {
          // Skip files we can't read
        }
      }
    }
  }

  await walkDir(dirPath);
  return results.length > 0 ? results.join("\n---\n") : "No matches found";
}

// Simple glob matching
function matchGlob(filename: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regexPattern}$`).test(filename);
}

export const grepTool: Tool = {
  name: "grep",
  description: "Search for a pattern in files. Returns matching lines with context.",
  inputSchema,
  permission: () => "read",
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input) as Input;
    try {
      const searchPath = parsed.path
        ? path.isAbsolute(parsed.path)
          ? parsed.path
          : path.resolve(context.cwd, parsed.path)
        : context.cwd;

      // Basic sandbox check
      if (!searchPath.startsWith(context.cwd)) {
        return { success: false, output: "", error: "Access denied: path is outside the allowed directory" };
      }

      const output = await grepFiles(parsed.pattern, searchPath, parsed.include, parsed.context);
      return { success: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: message };
    }
  },
};
