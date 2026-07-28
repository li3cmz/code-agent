/**
 * Memory module — file-based project context loading.
 *
 * Scans for AGENTS.md / CLAUDE.md files from cwd up to repo root.
 * Parses optional frontmatter and injects content into system prompt.
 *
 * Mirrors Claude Code's memory system (ch11 Memory).
 */

import * as fs from "fs";
import * as path from "path";
import { STATE } from "./state.js";

export interface MemoryFile {
  path: string;
  content: string;
  frontmatter?: Record<string, string>;
}

// In-memory store for loaded memory files
let loadedMemoryFiles: MemoryFile[] = [];

/**
 * Parse frontmatter from markdown content.
 * Frontmatter format:
 * ---
 * key: value
 * ---
 * content
 */
export function parseFrontmatter(content: string): { frontmatter?: Record<string, string>; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { body: content };
  }

  const frontmatterStr = match[1] ?? "";
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }

  return {
    frontmatter,
    body: content.slice(match[0].length),
  };
}

/**
 * Find the repo root (contains .git) by walking up from cwd.
 */
export function findRepoRoot(startDir: string): string | null {
  let current = startDir;

  while (true) {
    const gitDir = path.join(current, ".git");
    if (fs.existsSync(gitDir)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root
      return null;
    }

    current = parent;
  }
}

/**
 * Scan for memory files from startDir up to repo root.
 * Looks for: AGENTS.md, CLAUDE.md
 */
export function scanMemoryFiles(startDir: string): MemoryFile[] {
  const repoRoot = findRepoRoot(startDir);
  if (!repoRoot) {
    return [];
  }

  const memoryFiles: MemoryFile[] = [];
  const memoryFileNames = ["AGENTS.md", "CLAUDE.md"];

  let current = startDir;

  while (true) {
    for (const fileName of memoryFileNames) {
      const filePath = path.join(current, fileName);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);
        memoryFiles.push({
          path: filePath,
          content: body,
          frontmatter,
        });
      }
    }

    if (current === repoRoot) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return memoryFiles;
}

/**
 * Load memory files and store in STATE.
 * Called at startup to make memory available to the agent.
 */
export function loadMemory(): void {
  const cwd = STATE.cwd || process.cwd();
  const files = scanMemoryFiles(cwd);
  loadedMemoryFiles = files;

  // Also store in STATE for tracking
  STATE.memoryFiles = files;

  if (files.length > 0) {
    console.log(`\n📚 Memory loaded:`);
    for (const file of files) {
      const relativePath = path.relative(cwd, file.path);
      console.log(`   - ${relativePath}`);
    }
  }
}

/**
 * Get loaded memory files.
 */
export function getLoadedMemoryFiles(): MemoryFile[] {
  return loadedMemoryFiles;
}

/**
 * Build memory context for injection into system prompt.
 */
export function buildMemoryContext(memoryFiles: MemoryFile[]): string {
  if (memoryFiles.length === 0) {
    return "";
  }

  const sections = memoryFiles.map((file) => {
    const relativePath = path.relative(process.cwd(), file.path);
    return `## ${relativePath}\n\n${file.content.trim()}`;
  });

  return `\n\n${sections.join("\n\n")}\n`;
}

/**
 * Get memory context from loaded files.
 */
export function getMemoryContext(): string {
  return buildMemoryContext(loadedMemoryFiles);
}

/**
 * Get memory files info for the /memory command.
 */
export function getMemoryInfo(): string {
  if (loadedMemoryFiles.length === 0) {
    return "No memory files loaded.";
  }

  const lines = ["Loaded memory files:"];
  for (const file of loadedMemoryFiles) {
    const relativePath = path.relative(process.cwd(), file.path);
    const preview = file.content.slice(0, 100).replace(/\n/g, " ");
    lines.push(`  - ${relativePath} (${file.content.length} chars)`);
    lines.push(`    Preview: "${preview}${file.content.length > 100 ? "..." : ""}"`);
  }

  return lines.join("\n");
}
