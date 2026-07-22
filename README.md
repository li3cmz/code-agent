# Code Agent

A code CLI agent built from scratch, following the architecture of Claude Code, using Azure AI Foundry for model inference.

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in your Azure AI Foundry credentials:

```
AZURE_FOUNDRY_ENDPOINT=https://<your-resource>.openai.azure.com/openai/v1/
AZURE_FOUNDRY_API_KEY=your-api-key
MODEL=your-deployment-name
```

## Usage

Start the interactive CLI:

```bash
npm start
```

Or run with `npx tsx src/cli.ts`.

## Available Commands

- `:quit` or `:exit` — Exit the CLI
- `:reset` — Reset the session
- `:plan` — Enable plan mode (read-only, blocks all mutating tools)

## Available Tools

| Tool | Description | Permission |
|------|-------------|------------|
| `readFile` | Read file contents | Read (no approval) |
| `writeEditFile` | Create or edit files | Mutate (requires approval) |
| `shell` | Execute shell commands | Mutate (requires approval) |
| `grep` | Search for patterns in files | Read (no approval) |

## Architecture

This project follows Claude Code's architecture:

- **Query Loop** (`src/core/query.ts`) — Async generator that streams model responses, executes tools, and loops
- **Tool System** (`src/core/tool.ts`) — Interface, registry, and executor for tools
- **State** (`src/core/state.ts`) — Session state including working directory and turn counter
- **Permissions** (`src/core/permissions.ts`) — Mode-driven approval system

## License

MIT
# code-agent
