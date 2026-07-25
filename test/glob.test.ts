import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { globTool } from "../src/tools/glob.js";
import * as path from "path";
import * as fs from "fs/promises";

describe("glob tool", () => {
  const testDir = path.join(process.cwd(), "test", "temp-glob-test");

  beforeAll(async () => {
    // Create test directory structure
    await fs.mkdir(path.join(testDir, "src", "nested"), { recursive: true });
    await fs.writeFile(path.join(testDir, "file1.ts"), "");
    await fs.writeFile(path.join(testDir, "file2.js"), "");
    await fs.writeFile(path.join(testDir, "src", "file3.ts"), "");
    await fs.writeFile(path.join(testDir, "src", "nested", "file4.ts"), "");
  });

  afterAll(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should find all .ts files with ** pattern", async () => {
    const result = await globTool.execute(
      { pattern: "**/*.ts" },
      { cwd: testDir }
    );
    expect(result.success).toBe(true);
    const files = result.output.split("\n").filter(Boolean);
    expect(files).toContain("file1.ts");
    expect(files).toContain("src/file3.ts");
    expect(files).toContain("src/nested/file4.ts");
  });

  it("should find files in src directory", async () => {
    const result = await globTool.execute(
      { pattern: "src/*.ts" },
      { cwd: testDir }
    );
    expect(result.success).toBe(true);
    const files = result.output.split("\n").filter(Boolean);
    expect(files).toContain("src/file3.ts");
  });

  it("should filter by file extension", async () => {
    const result = await globTool.execute(
      { pattern: "**/*.js" },
      { cwd: testDir }
    );
    expect(result.success).toBe(true);
    const files = result.output.split("\n").filter(Boolean);
    expect(files).toContain("file2.js");
  });
});
