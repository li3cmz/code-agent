# Memory — Stage 6 Implementation

## Overview

Stage 6 implements persistent project context loading via `AGENTS.md` and `CLAUDE.md` files, following Claude Code's memory system (ch11 Memory).

## Files Created/Modified

### New Files

- `src/core/memory.ts` — Core memory module
- `test/memory.test.ts` — Unit tests

### Modified Files

- `src/core/state.ts` — Added `memoryFiles` field
- `src/prompts/system.ts` — Integrated memory context into system prompt
- `src/cli.ts` — Added `:memory` command and startup loading

## Features

### File Scanning

At startup, the agent scans from the current working directory up to the repository root (identified by `.git` directory) for:
- `AGENTS.md` — Agent-specific instructions
- `CLAUDE.md` — Claude-specific instructions

### Frontmatter Support

Memory files can include optional YAML frontmatter:

```markdown
---
version: 1.0
priority: high
---

# Agent Guidelines

Your content here...
```

The frontmatter is parsed and stored separately from the body content.

### System Prompt Integration

Loaded memory content is automatically injected into the system prompt under the "Project Context" section, making it available to the model on every turn.

### CLI Commands

- `:memory` — Display loaded memory files and their content previews

## Usage

1. Create an `AGENTS.md` or `CLAUDE.md` file in your project root
2. Run the CLI — memory files are automatically loaded
3. Use `:memory` to see what was loaded

## Example

```markdown
---
version: 1.0
---

# Agent Guidelines

## Coding Standards
- Always use TypeScript
- Prefer functional programming patterns
- Write tests for all new code

## Tool Usage
- Use readFile for reading files
- Use writeEditFile for modifications
```

## Design Notes

- **Mirrors Claude Code's memory system** (ch11 Memory)
- Memory files are scanned once at startup, not on every turn
- Content is injected into the system prompt for full context
- Supports walking up the directory tree to find memory files in parent directories
