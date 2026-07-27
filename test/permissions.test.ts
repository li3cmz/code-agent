/**
 * Tests for permission system.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { checkPermission, setPermissionMode, getPermissionMode, approveTool, revokeTool, revokeAllTools, getModeDisplay } from "../src/core/permissions.js";
import { STATE } from "../src/core/state.js";

// Mock tool for testing
const mockReadTool = {
  name: "readFile",
  description: "Read a file",
  inputSchema: {} as any,
  permission: () => "read" as const,
  execute: async () => ({ success: true, output: "test" }),
};

const mockWriteTool = {
  name: "writeEditFile",
  description: "Write a file",
  inputSchema: {} as any,
  permission: () => "mutate" as const,
  execute: async () => ({ success: true, output: "test" }),
};

const mockShellTool = {
  name: "shell",
  description: "Execute shell command",
  inputSchema: {} as any,
  permission: () => "mutate" as const,
  execute: async () => ({ success: true, output: "test" }),
};

describe("Permission System", () => {
  beforeEach(() => {
    STATE.reset();
  });

  describe("checkPermission", () => {
    it("should allow read tools in default mode", () => {
      setPermissionMode("default");
      const result = checkPermission(mockReadTool);
      expect(result.allowed).toBe(true);
    });

    it("should block mutating tools in default mode without approval", () => {
      setPermissionMode("default");
      const result = checkPermission(mockWriteTool);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("requires approval");
    });

    it("should allow mutating tools after session approval", () => {
      setPermissionMode("default");
      approveTool("writeEditFile");
      const result = checkPermission(mockWriteTool);
      expect(result.allowed).toBe(true);
    });

    it("should block all mutating tools in plan mode", () => {
      setPermissionMode("plan");
      const writeResult = checkPermission(mockWriteTool);
      expect(writeResult.allowed).toBe(false);
      expect(writeResult.reason).toContain("Plan mode");

      const shellResult = checkPermission(mockShellTool);
      expect(shellResult.allowed).toBe(false);
    });

    it("should allow read tools in plan mode", () => {
      setPermissionMode("plan");
      const result = checkPermission(mockReadTool);
      expect(result.allowed).toBe(true);
    });

    it("should auto-approve writeEditFile in acceptEdits mode", () => {
      setPermissionMode("acceptEdits");
      const writeResult = checkPermission(mockWriteTool);
      expect(writeResult.allowed).toBe(true);

      // But shell should still require approval
      const shellResult = checkPermission(mockShellTool);
      expect(shellResult.allowed).toBe(false);
    });

    it("should allow all tools in dontAsk mode", () => {
      setPermissionMode("dontAsk");
      const writeResult = checkPermission(mockWriteTool);
      expect(writeResult.allowed).toBe(true);

      const shellResult = checkPermission(mockShellTool);
      expect(shellResult.allowed).toBe(true);
    });

    // Bubble mode tests (for sub-agents)
    it("should allow read tools in bubble mode", () => {
      setPermissionMode("bubble");
      const result = checkPermission(mockReadTool);
      expect(result.allowed).toBe(true);
    });

    it("should block mutating tools in bubble mode", () => {
      setPermissionMode("bubble");
      const writeResult = checkPermission(mockWriteTool);
      expect(writeResult.allowed).toBe(false);
      expect(writeResult.reason).toContain("sub-agent requires approval");

      const shellResult = checkPermission(mockShellTool);
      expect(shellResult.allowed).toBe(false);
      expect(shellResult.reason).toContain("sub-agent requires approval");
    });
  });

  describe("setPermissionMode", () => {
    it("should set and get permission mode", () => {
      expect(getPermissionMode()).toBe("default");

      setPermissionMode("plan");
      expect(getPermissionMode()).toBe("plan");

      setPermissionMode("acceptEdits");
      expect(getPermissionMode()).toBe("acceptEdits");

      setPermissionMode("dontAsk");
      expect(getPermissionMode()).toBe("dontAsk");

      setPermissionMode("bubble");
      expect(getPermissionMode()).toBe("bubble");
    });
  });

  describe("getModeDisplay", () => {
    it("should return empty string for default mode", () => {
      setPermissionMode("default");
      expect(getModeDisplay()).toBe("");
    });

    it("should return [plan] for plan mode", () => {
      setPermissionMode("plan");
      expect(getModeDisplay()).toBe("[plan]");
    });

    it("should return [acceptEdits] for acceptEdits mode", () => {
      setPermissionMode("acceptEdits");
      expect(getModeDisplay()).toBe("[acceptEdits]");
    });

    it("should return [yes] for dontAsk mode", () => {
      setPermissionMode("dontAsk");
      expect(getModeDisplay()).toBe("[yes]");
    });

    it("should return [bubble] for bubble mode", () => {
      setPermissionMode("bubble");
      expect(getModeDisplay()).toBe("[bubble]");
    });
  });

  describe("approveTool / revokeTool", () => {
    it("should approve a tool for the session", () => {
      approveTool("shell");
      expect(STATE.approvedTools.has("shell")).toBe(true);
    });

    it("should revoke a specific tool", () => {
      approveTool("shell");
      approveTool("writeEditFile");
      revokeTool("shell");
      expect(STATE.approvedTools.has("shell")).toBe(false);
      expect(STATE.approvedTools.has("writeEditFile")).toBe(true);
    });

    it("should revoke all tools", () => {
      approveTool("shell");
      approveTool("writeEditFile");
      revokeAllTools();
      expect(STATE.approvedTools.size).toBe(0);
    });
  });
});
