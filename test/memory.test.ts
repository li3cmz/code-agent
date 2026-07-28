import { describe, it, expect, beforeEach } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { scanMemoryFiles, buildMemoryContext, parseFrontmatter, findRepoRoot } from "../src/core/memory.js";
import { STATE } from "../src/core/state.js";

describe("Memory", () => {
  const testDir = path.join(process.cwd(), "test", "temp", "memory-test");

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    // Create a .git directory to mark it as a repo
    fs.mkdirSync(path.join(testDir, ".git"), { recursive: true });

    // Reset STATE cwd for testing
    STATE.cwd = testDir;
  });

  describe("findRepoRoot", () => {
    it("should find .git directory as repo root", () => {
      const result = findRepoRoot(testDir);
      expect(result).toBe(testDir);
    });

    it("should return null when no .git found", () => {
      const result = findRepoRoot("/");
      expect(result).toBeNull();
    });
  });

  describe("parseFrontmatter", () => {
    it("should parse frontmatter correctly", () => {
      const content = `---
version: 1.0
priority: high
---

This is the body content.`;

      const { frontmatter, body } = parseFrontmatter(content);

      expect(frontmatter).toEqual({ version: "1.0", priority: "high" });
      expect(body).toBe("This is the body content.");
    });

    it("should return full content as body when no frontmatter", () => {
      const content = "No frontmatter here.";
      const { frontmatter, body } = parseFrontmatter(content);

      expect(frontmatter).toBeUndefined();
      expect(body).toBe(content);
    });
  });

  describe("scanMemoryFiles", () => {
    it("should find AGENTS.md in current directory", () => {
      fs.writeFileSync(path.join(testDir, "AGENTS.md"), "# Agents\n\nDo something.");

      const files = scanMemoryFiles(testDir);

      expect(files).toHaveLength(1);
      expect(files[0].path).toContain("AGENTS.md");
      expect(files[0].content).toContain("Do something");
    });

    it("should find CLAUDE.md in current directory", () => {
      fs.writeFileSync(path.join(testDir, "CLAUDE.md"), "# Claude\n\nBe helpful.");

      const files = scanMemoryFiles(testDir);

      expect(files).toHaveLength(1);
      expect(files[0].path).toContain("CLAUDE.md");
    });

    it("should find both AGENTS.md and CLAUDE.md", () => {
      fs.writeFileSync(path.join(testDir, "AGENTS.md"), "# Agents\n\nAgents content.");
      fs.writeFileSync(path.join(testDir, "CLAUDE.md"), "# Claude\n\nClaude content.");

      const files = scanMemoryFiles(testDir);

      expect(files).toHaveLength(2);
    });

    it("should scan parent directories", () => {
      // Create a subdirectory
      const subDir = path.join(testDir, "subdir");
      fs.mkdirSync(subDir, { recursive: true });

      // Create AGENTS.md in parent
      fs.writeFileSync(path.join(testDir, "AGENTS.md"), "# Parent Agents");

      const files = scanMemoryFiles(subDir);

      expect(files).toHaveLength(1);
      expect(files[0].path).toContain("AGENTS.md");
    });
  });

  describe("buildMemoryContext", () => {
    it("should return empty string for no files", () => {
      const result = buildMemoryContext([]);
      expect(result).toBe("");
    });

    it("should format memory files correctly", () => {
      const files = [
        { path: "/test/AGENTS.md", content: "Test content", frontmatter: {} },
      ];

      const result = buildMemoryContext(files);

      expect(result).toContain("##");
      expect(result).toContain("Test content");
    });
  });
});
