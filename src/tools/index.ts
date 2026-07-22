/**
 * Tool registry wiring.
 *
 * Import and register all tools here.
 */

import { toolRegistry } from "../core/tool.js";
import { readFileTool } from "./readFile.js";
import { writeEditFileTool } from "./writeEditFile.js";
import { shellTool } from "./shell.js";
import { grepTool } from "./grep.js";

// Register all tools
toolRegistry.register(readFileTool);
toolRegistry.register(writeEditFileTool);
toolRegistry.register(shellTool);
toolRegistry.register(grepTool);

// Re-export for convenience
export { toolRegistry };
