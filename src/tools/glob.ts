/**
 * glob tool — fast file matching using glob patterns.
 *
 * Tool permission: read (safe, no approval needed).
 */

import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../core/tool.js";

export const inputSchema = z.object({
  pattern: z.string().describe("Glob pattern (e.g., '**/*.ts', 'src/**/*.js')"),
  cwd: z.string().optional().describe("Working directory to search in (defaults to cwd)"),
});

type Input = z.infer<typeof inputSchema>;

export const globTool: Tool = {
  name: "glob",
  description: "Find files matching a glob pattern. Supports ** (recursive), * (any characters), ? (single character), [abc] (character class). Returns list of matching file paths.",
  inputSchema,
  permission: () => "read",
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input) as Input;
    
    const searchDir = parsed.cwd 
      ? path.isAbsolute(parsed.cwd) 
        ? parsed.cwd 
        : path.resolve(context.cwd, parsed.cwd)
      : context.cwd;

    // Basic sandbox check - don't allow paths outside cwd
    if (!searchDir.startsWith(context.cwd)) {
      return { success: false, output: "", error: "Access denied: path is outside the allowed directory" };
    }

    try {
      const matches = await walkDir(searchDir, parsed.pattern);
      const relativeMatches = matches.map(m => path.relative(searchDir, m));
      return { success: true, output: relativeMatches.join("\n") };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: message };
    }
  },
};

/**
 * Simple glob matching - walks directory and matches against pattern.
 * Supports: ** (recursive), * (any chars), ? (single char), [abc] (char class)
 */
async function walkDir(dir: string, pattern: string): Promise<string[]> {
  const results: string[] = [];

  // Convert glob pattern to regex
  const { regex, isRecursive } = globToRegex(pattern);

  await walk(dir);

  return results;

  async function walk(currentDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        // Check if current path matches
        const relativePath = path.relative(dir, fullPath);

        if (matchGlob(relativePath, pattern)) {
          if (entry.isFile()) {
            results.push(fullPath);
          }
        }

        // Recurse into directories
        if (entry.isDirectory()) {
          if (isRecursive || pattern.startsWith(entry.name + "/") || pattern === entry.name) {
            await walk(fullPath);
          }
        }
      }
    } catch {
      // Ignore permission errors
    }
  }
}

/**
 * Match a path against a glob pattern.
 */
function matchGlob(filePath: string, pattern: string): boolean {
  // Handle ** (match any number of path segments)
  if (pattern.startsWith("**/")) {
    const rest = pattern.slice(3);

    // For **/*.ts pattern, check if the file matches the rest at any point
    // e.g., file1.ts matches *.ts, src/file3.ts matches *.ts
    if (matchGlobSimple(filePath, rest)) {
      return true;
    }

    // For **/src/*.ts pattern, need to match path segments
    if (rest.includes("/")) {
      const parts = filePath.split("/");
      for (let i = 0; i < parts.length; i++) {
        const subPath = parts.slice(i).join("/");
        if (matchGlobSimple(subPath, rest)) {
          return true;
        }
      }
    }

    return false;
  }

  return matchGlobSimple(filePath, pattern);
}

/**
 * Simple glob matching (no ** support).
 */
function matchGlobSimple(filePath: string, pattern: string): boolean {
  // Convert glob to regex
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/\[(!?)(.*?)\]/g, (_, neg, chars) => {
      return neg ? `[^${chars}]` : `[${chars}]`;
    });

  // Anchor the pattern
  if (!pattern.startsWith("*") && !pattern.startsWith("?")) {
    regexStr = "^" + regexStr;
  }
  if (!pattern.endsWith("*") && !pattern.endsWith("?")) {
    regexStr += "$";
  }

  return new RegExp(regexStr, "i").test(filePath);
}

/**
 * Convert a glob pattern to regex.
 * Returns both the regex and whether it's recursive (**).
 */
function globToRegex(pattern: string): { regex: RegExp; isRecursive: boolean } {
  const isRecursive = pattern.startsWith("**");

  let regexStr = pattern
    // Escape special regex chars except glob special chars
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // Handle **
    .replace(/\*\*/g, "(:.*)?")
    // Handle *
    .replace(/\*/g, "[^/]*")
    // Handle ?
    .replace(/\?/g, ".")
    // Handle [abc]
    .replace(/\[(!?)(.*?)\]/g, (match, neg, chars) => {
      return neg ? `[^${chars}]` : `[${chars}]`;
    });

  // If pattern doesn't start with **, anchor it
  if (!pattern.startsWith("**")) {
    regexStr = "^" + regexStr;
  }

  // If pattern doesn't end with ** or *, anchor it
  if (!pattern.endsWith("**") && !pattern.endsWith("*")) {
    regexStr += "$";
  }

  return { regex: new RegExp(regexStr, "i"), isRecursive };
}
