/**
 * Permission system — mode-driven approvals.
 *
 * Stage 1: Basic prompt-before-mutate.
 * Stage 2: Full mode-driven approvals (default / plan / acceptEdits / dontAsk).
 */

import { STATE } from "./state.js";
import type { Tool } from "./tool.js";

export type PermissionMode = "default" | "plan" | "acceptEdits" | "dontAsk" | "bubble";

/**
 * Get the current effective mode (from STATE or override).
 */
export function getEffectiveMode(override?: PermissionMode): PermissionMode {
  return override || STATE.mode;
}

/**
 * Get temporary permission mode once, then clear it (single-use).
 * Returns temp mode if set, otherwise falls back to STATE.mode.
 */
export function getEffectiveModeOnce(): PermissionMode {
  const tempMode = STATE.consumeTempMode();
  return tempMode || STATE.mode;
}

/**
 * Check if a tool should be allowed to run.
 * Returns { allowed: true } or { allowed: false; reason: string }.
 *
 * Permission matrix:
 * | Mode        | Read tools | writeEditFile | shell | Already approved |
 * |-------------|------------|---------------|-------|------------------|
 * | default     | ✓          | prompt        | prompt| ✓ (any tool)     |
 * | plan        | ✓          | ✗             | ✗     | ✗                |
 * | acceptEdits | ✓          | ✓             | prompt| ✓ (any tool)     |
 * | dontAsk     | ✓          | ✓             | ✓     | ✓                |
 * | bubble      | ✓          | prompt        | prompt| prompt (all need parent approval) |
 *
 * Bubble mode is used for sub-agents: they can request approval but cannot self-approve
 * any mutations - all must bubble up to the parent agent for approval.
 */
export function checkPermission(
  tool: Tool,
  mode?: PermissionMode
): { allowed: boolean; reason?: string } {
  const effectiveMode = getEffectiveMode(mode);
  const toolPerm = tool.permission();
  const toolName = tool.name;

  // Check if already approved for this session (any mode)
  if (STATE.approvedTools.has(toolName)) {
    return { allowed: true };
  }

  // In dontAsk mode, allow everything
  if (effectiveMode === "dontAsk") {
    return { allowed: true };
  }

  // In bubble mode (sub-agents), require approval for all mutations
  // The approval request bubbles up to the parent agent
  if (effectiveMode === "bubble") {
    if (toolPerm === "mutate") {
      return {
        allowed: false,
        reason: `sub-agent requires approval: ${toolName} is a mutating tool`,
      };
    }
    return { allowed: true };
  }

  // In plan mode, block all mutations
  if (effectiveMode === "plan") {
    if (toolPerm === "mutate") {
      return { allowed: false, reason: "Plan mode blocks all mutating tools" };
    }
    return { allowed: true };
  }

  // In acceptEdits mode, auto-approve writeEditFile only
  if (effectiveMode === "acceptEdits" && toolName === "writeEditFile") {
    return { allowed: true };
  }

  // Default mode: prompt for mutating tools
  if (toolPerm === "mutate") {
    return {
      allowed: false,
      reason: `requires approval: ${toolName} is a mutating tool`,
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
 * Revoke a tool's session-wide approval.
 */
export function revokeTool(toolName: string): void {
  STATE.approvedTools.delete(toolName);
}

/**
 * Revoke all session-wide approvals.
 */
export function revokeAllTools(): void {
  STATE.approvedTools.clear();
}

/**
 * Set the permission mode.
 */
export function setPermissionMode(mode: PermissionMode): void {
  STATE.mode = mode;
}

/**
 * Set a temporary permission mode (single-use).
 * Will be consumed by getEffectiveModeOnce() and then cleared.
 */
export function setTempPermissionMode(mode: PermissionMode): void {
  STATE.setTempMode(mode);
}

/**
 * Get current permission mode.
 */
export function getPermissionMode(): PermissionMode {
  return STATE.mode;
}

/**
 * Get mode display string for UI.
 */
export function getModeDisplay(): string {
  const mode = STATE.mode;
  switch (mode) {
    case "plan":
      return "[plan]";
    case "acceptEdits":
      return "[acceptEdits]";
    case "dontAsk":
      return "[yes]";
    case "bubble":
      return "[bubble]";
    default:
      return "";
  }
}
