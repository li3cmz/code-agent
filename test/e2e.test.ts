import { describe, it, expect } from "vitest";
import { toolRegistry } from "../src/core/tool.js";
import * as tools from "../src/tools/index.js";
import { loop } from "../src/core/loop.js";

void tools; // Ensure registered

describe("E2E tool calling", () => {
  it("should call readFile tool when asked to read a file", async () => {
    const events: string[] = [];
    let toolSuccess = false;

    for await (const event of loop({
      userMessage: "read src/cli.ts",
      maxTurns: 2,
      onTextChunk: () => {}, // ignore text
    })) {
      if (event.type === "tool_start") {
        events.push(`tool_start: ${event.tool}`);
      }
      if (event.type === "tool_result") {
        events.push(`tool_result: ${event.tool} success=${event.result.success}`);
        if (event.tool === "readFile" && event.result.success) {
          toolSuccess = true;
        }
      }
    }

    // Should have successfully called readFile tool
    expect(toolSuccess).toBe(true);
  }, 30000);
});
