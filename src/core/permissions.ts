/**
 * Permission system — basic gate for mutating tools.
 *
 * Stage 1: Basic prompt-before-mutate.
 * Stage 2: Full mode-driven approvals (default / plan / acceptEdits / dontAsk).
 */

import { STATE } from "./state.js";
import type { Tool } from "./tool.js";

export type PermissionMode = "default" | "plan" | "acceptEdits" | "dontAsk";

/**
 * Check if a tool should be allowed to run.
 * Returns { allowed: true } or { allowed: false; reason: string }.
 */
export function checkPermission(
  tool: Tool,
  mode: PermissionMode = STATE.planMode ? "plan" : "default"
): { allowed: boolean; reason?: string } {
  // In plan mode, block all mutations
  if (mode === "plan" && tool.permission() === "mutate") {
    return { allowed: false, reason: "Plan mode blocks all mutating tools" };
  }

  // In dontAsk mode, allow everything
  if (mode === "dontAsk") {
    return { allowed: true };
  }

  // In acceptEdits mode, allow edits automatically
  if (mode === "acceptEdits" && tool.name === "writeEditFile") {
    return { allowed: true };
  }

  // Default: check if already approved for this session
  if (STATE.approvedTools.has(tool.name)) {
    return { allowed: true };
  }

  // Default mode: prompt for mutating tools
  if (tool.permission() === "mutate") {
    return {
      allowed: false,
      reason: `requires approval: ${tool.name} is a mutating tool`,
    };
  }

  return { allowed: true };
}

/**
 * Approve a tool for the remainder of this session.
 */
export function approveTool(toolName: string): void {
  STATE.approvedTools.add(toolName);
}

/**
 * Set the permission mode.
 */
export function setPermissionMode(mode: PermissionMode): void {
  STATE.planMode = mode === "plan";
}
