/**
 * CLI — REPL entry point.
 *
 * Interactive readline interface that streams the query loop output.
 */

import * as readline from "readline";
import { query } from "./core/query.js";
import { STATE } from "./core/state.js";
import { approveTool } from "./core/permissions.js";
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
 * Prompt the user for approval of a mutating tool.
 */
async function promptApproval(toolName: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  Approve ${toolName}? (y/n/a = always for this session): `,
      (answer) => {
        const a = answer.trim().toLowerCase();
        if (a === "a") {
          approveTool(toolName);
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
    for await (const event of query({
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
        // console.log(`\n--- Turn ${event.turn} ---`);
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
}

/**
 * Main REPL loop.
 */
function startREPL() {
  printWelcome();

  rl.setPrompt("> ");

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === ":quit" || input === ":exit") {
      rl.close();
      return;
    }

    if (input === ":reset") {
      STATE.reset();
      console.log("Session reset.\n");
      rl.prompt();
      return;
    }

    if (input === ":plan") {
      STATE.planMode = true;
      console.log("Plan mode enabled (read-only).\n");
      rl.prompt();
      return;
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
