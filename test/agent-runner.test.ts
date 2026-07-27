/**
 * Tests for sub-agent / tasks system.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { isToolAllowed } from "../src/core/agent-runner.js";

describe("Tasks / Sub-agents", () => {
  describe("isToolAllowed", () => {
    it("should return true if tool is in allowed set", () => {
      const allowedTools = new Set(["readFile", "grep"]);
      expect(isToolAllowed("readFile", allowedTools)).toBe(true);
      expect(isToolAllowed("grep", allowedTools)).toBe(true);
    });

    it("should return false if tool is not in allowed set", () => {
      const allowedTools = new Set(["readFile", "grep"]);
      expect(isToolAllowed("shell", allowedTools)).toBe(false);
      expect(isToolAllowed("writeEditFile", allowedTools)).toBe(false);
    });

    it("should handle empty allowed set", () => {
      const allowedTools = new Set<string>();
      expect(isToolAllowed("readFile", allowedTools)).toBe(false);
    });
  });
});
