/**
 * CLI — REPL entry point.
 *
 * Interactive readline interface that streams the query loop output.
 */

import * as readline from "readline";
import { loop } from "./core/loop.js";
import { STATE } from "./core/state.js";
import { approveTool, setPermissionMode, getPermissionMode, revokeTool, revokeAllTools, getModeDisplay, type PermissionMode } from "./core/permissions.js";
import * as tools from "./tools/index.js";

// Ensure tools are registered
void tools;

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

/**
 * Get the prompt prefix showing current mode.
 */
function getPromptPrefix(): string {
  const modeDisplay = getModeDisplay();
  return modeDisplay ? `${modeDisplay} ` : "";
}

/**
 * Update the readline prompt.
 */
function updatePrompt(): void {
  rl.setPrompt(`${getPromptPrefix()}> `);
}

/**
 * Print available commands.
 */
function printCommands(): void {
  console.log(`
Available commands:
  :quit, :exit    Exit the CLI
  :reset          Reset the session (clears mode and approvals)
  :plan           Enable plan mode (read-only, blocks all mutations)
  :default       Switch to default mode (prompts for mutations)
  :accept-edits  Auto-approve file edits, prompt for shell commands
  :yes           Auto-approve all tools (dontAsk mode)
  :status         Show current mode and approved tools
  :revoke [tool] Revoke approval for a tool (or all if no arg)
`);
}

/**
 * Prompt the user for approval of a mutating tool.
 */
async function promptApproval(toolName: string): Promise<boolean> {
  const mode = getPermissionMode();
  const modeHint = mode !== "default" ? ` (mode: ${mode})` : "";

  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  Approve ${toolName}?${modeHint} (y/n/a = always for this session): `,
      (answer) => {
        const a = answer.trim().toLowerCase();
        if (a === "a") {
          approveTool(toolName);
          console.log(`  ✓ ${toolName} approved for this session`);
          resolve(true);
        } else {
          resolve(a === "y");
        }
      }
    );
  });
}

/**
 * Main interaction loop.
 */
async function runAgent(userMessage: string) {
  console.log("\n🤖 Thinking...\n");

  let fullText = "";

  try {
    for await (const event of loop({
      userMessage,
      onApprovalRequest: async (tool, _input) => {
        return await promptApproval(tool.name);
      },
      onTextChunk: (chunk) => {
        fullText += chunk;
        process.stdout.write(chunk);
      },
    })) {
      if (event.type === "tool_start") {
        console.log(`\n🔧 Using tool: ${event.tool}`);
      } else if (event.type === "tool_result") {
        if (event.result.success) {
          const preview = event.result.output.slice(0, 200);
          console.log(`\n✅ Result: ${preview}${event.result.output.length > 200 ? "..." : ""}`);
        } else {
          console.log(`\n❌ Error: ${event.result.error}`);
        }
      } else if (event.type === "turn") {
        console.log(`\n--- Turn ${event.turn} ---`);
      }
    }
  } catch (err) {
    console.error("\n❌ Fatal error:", err);
  }
}

/**
 * Print welcome message.
 */
function printWelcome() {
  console.clear();
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║         Code Agent - CLI                  ║");
  console.log("║  (Claude Code-inspired AI assistant)      ║");
  console.log("╚═══════════════════════════════════════════╝\n");
  console.log("Type your request and press Enter.");
  console.log("Type :quit or :exit to exit.\n");
  printCommands();
}

/**
 * Handle special commands starting with :.
 * Returns true if a command was handled, false otherwise.
 */
async function handleCommand(input: string): Promise<boolean> {
  const cmd = input.toLowerCase();

  if (cmd === ":quit" || cmd === ":exit") {
    rl.close();
    return true;
  }

  if (cmd === ":reset") {
    STATE.reset();
    console.log("Session reset (mode: default, approvals cleared).\n");
    updatePrompt();
    return true;
  }

  if (cmd === ":plan") {
    setPermissionMode("plan");
    console.log("Plan mode enabled (read-only, blocks all mutations).\n");
    updatePrompt();
    return true;
  }

  if (cmd === ":default") {
    setPermissionMode("default");
    console.log("Default mode enabled (prompts for mutations).\n");
    updatePrompt();
    return true;
  }

  if (cmd === ":accept-edits" || cmd === ":acceptedits" || cmd === ":accepted") {
    setPermissionMode("acceptEdits");
    console.log("acceptEdits mode enabled (auto-approves file edits, prompts for shell).\n");
    updatePrompt();
    return true;
  }

  if (cmd === ":yes" || cmd === ":y") {
    setPermissionMode("dontAsk");
    console.log("dontAsk mode enabled (auto-approves all tools).\n");
    updatePrompt();
    return true;
  }

  if (cmd === ":status") {
    const mode = getPermissionMode();
    const approved = Array.from(STATE.approvedTools);

    console.log(`\nCurrent mode: ${mode}`);
    if (approved.length > 0) {
      console.log(`Approved tools: ${approved.join(", ")}`);
    } else {
      console.log("Approved tools: (none)");
    }
    console.log("");

    // Print permission matrix
    console.log("Permission matrix:");
    console.log("  default     - prompts for writeEditFile, shell");
    console.log("  plan       - blocks all mutations (read-only)");
    console.log("  acceptEdits - auto-approves writeEditFile, prompts for shell");
    console.log("  dontAsk    - auto-approves all tools");
    console.log("");
    return true;
  }

  if (cmd === ":revoke") {
    revokeAllTools();
    console.log("All tool approvals revoked.\n");
    return true;
  }

  // :revoke <tool> - revoke specific tool
  if (cmd.startsWith(":revoke ")) {
    const toolName = input.slice(8).trim().toLowerCase();
    if (toolName) {
      revokeTool(toolName);
      console.log(`Approval revoked for: ${toolName}\n`);
    } else {
      console.log("Usage: :revoke <tool-name>\n");
    }
    return true;
  }

  if (cmd === ":help" || cmd === ":?") {
    printCommands();
    return true;
  }

  return false;
}

/**
 * Main REPL loop.
 */
function startREPL() {
  printWelcome();
  updatePrompt();
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle special commands
    if (input.startsWith(":")) {
      const handled = await handleCommand(input);
      if (handled) {
        rl.prompt();
        return;
      }
    }

    await runAgent(input);
    console.log("");
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n👋 Goodbye!");
    process.exit(0);
  });
}

// Start the CLI
startREPL();
