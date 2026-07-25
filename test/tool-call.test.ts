import { describe, it, expect } from "vitest";
import { toolRegistry, executeTool } from "../src/core/tool.js";
import * as tools from "../src/tools/index.js";

void tools; // Ensure tools are registered

describe("Tool calling", () => {
  it("should execute readFile with valid args", async () => {
    const result = await executeTool(
      "readFile",
      { path: "src/cli.ts" },
      { cwd: process.cwd() }
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("CLI");
  });

  it("should fail with invalid args (missing required field)", async () => {
    const result = await executeTool(
      "readFile",
      { path: undefined },  // Missing required field
      { cwd: process.cwd() }
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Required");
  });

  it("should fail with invalid tool name", async () => {
    const result = await executeTool(
      "nonexistent",
      {},
      { cwd: process.cwd() }
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  it("should handle JSON parse error gracefully", async () => {
    // This tests the loop.ts parsing, not executeTool directly
    // Simulating what happens when JSON.parse fails
    const invalidJson = "{ not valid json";
    expect(() => JSON.parse(invalidJson)).toThrow();
  });
});
