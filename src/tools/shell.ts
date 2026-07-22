/**
 * shell tool — execute shell commands.
 *
 * Tool permission: mutate (requires approval).
 * Uses PowerShell on Windows.
 */

import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../core/tool.js";

const execAsync = promisify(exec);

export const inputSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  cwd: z.string().optional().describe("Working directory for the command (defaults to current cwd)"),
  timeout: z.number().optional().default(30000).describe("Timeout in milliseconds (default 30000)"),
});

type Input = z.infer<typeof inputSchema>;

export const shellTool: Tool = {
  name: "shell",
  description: "Execute a shell command. Uses PowerShell on Windows.",
  inputSchema,
  permission: () => "mutate",
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = inputSchema.parse(input) as Input;
    try {
      const cwd = parsed.cwd || context.cwd;

      // Security: basic check to prevent dangerous commands
      const dangerousPatterns = [
        /rm\s+-rf\s+\//i,
        /format\s+/i,
        /del\s+\/[sqf]\s+/i,
        /Remove-Item\s+-Recurse\s+-Force\s+\\/i,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(parsed.command)) {
          return {
            success: false,
            output: "",
            error: "Blocked potentially dangerous command",
          };
        }
      }

      // Use PowerShell on Windows, bash/sh on others
      const isWindows = process.platform === "win32";
      const shell = isWindows ? "powershell" : "/bin/sh";

      const { stdout, stderr } = await execAsync(parsed.command, {
        cwd,
        shell,
        timeout: parsed.timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      const output = stdout || stderr;
      return { success: true, output: output || "(command completed with no output)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Check for timeout
      if (message.includes("timeout")) {
        return { success: false, output: "", error: "Command timed out" };
      }
      return { success: false, output: "", error: message };
    }
  },
};
