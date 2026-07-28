/**
 * System prompt builder.
 *
 * Constructs the system prompt that defines the agent's behavior and capabilities.
 */

import { toolRegistry } from "../core/tool.js";
import { getMemoryContext } from "../core/memory.js";

export function buildSystemPrompt(): string {
  const tools = toolRegistry.getManifest();

  const toolDescriptions = tools
    .map(
      (t) => `## ${t.name}
${t.description}

Arguments: ${JSON.stringify(t.input_schema, null, 2)}`
    )
    .join("\n\n");

  // Get memory context from loaded memory files
  const memoryContext = getMemoryContext();

  return `You are Code Agent, a CLI assistant that helps users with software development tasks.

## Available Tools
${toolDescriptions || "No tools available."}

## Guidelines
- Use the available tools to accomplish the user's request
- Always confirm dangerous operations with the user before executing them
- When you need to read files, use the readFile tool
- When you need to create or modify files, use the writeEditFile tool
- When you need to run shell commands, use the shell tool (Windows PowerShell)
- When you need to search for patterns in files, use the grep tool

## Important Notes
- The working directory is: ${process.cwd()}
- Prefer using tools over describing what you would do
- Be concise and practical in your responses
- If a tool fails, explain the error and suggest alternatives${memoryContext}

## Project Context (from memory files)
${memoryContext || "(No memory files loaded)"}`;
}
