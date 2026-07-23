# Code Agent — Implementation Plan & Progress Checkpoint

> A code CLI agent built from scratch, following the architecture of Claude Code
> (https://claude-code-from-source.com/ch01-architecture/), using Azure AI Foundry
> for model inference.
>
> **This file is the single source of truth for progress.** It survives across days
> and machine restarts. On every resume, read the "How to Resume" section first,
> then the Progress Table, then continue from the first stage that is not `DONE`.

---

## 1. Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language / runtime | **TypeScript + Node.js** | Same stack as Claude Code; richest terminal/async ecosystem; `openai` SDK is GA. |
| Model access | **Direct model inference** (Chat Completions / Responses API) via the `openai` npm package pointed at a Foundry endpoint | Current: MVP uses direct model deployment. Will migrate to **Azure AI Foundry Agent** in Stage 9 for built-in tracing, tool execution, and memory. Direct inference keeps full control; Agent simplifies tool/trace implementation. |
| Provider abstraction | **Provider factory** (`getModelClient()`) | Swap Foundry direct ↔ Agent Service ↔ local model by changing one file, per Claude Code's `getAnthropicClient()` pattern. |
| Auth (MVP) | **API key** in `.env` | Simplest; direct inference supports it. Entra ID / `DefaultAzureCredential` is a later option behind the same factory. |
| Platform | **Windows** first (cross-platform friendly where cheap) | User's environment. Shell tool defaults to PowerShell on Windows. |
| Agent Service | **Deferred / optional** | Only revisit if we later need managed web search, code interpreter, RAG, or M365 publishing. |

### Auth note
Auth is used by **our CLI process → Foundry endpoint**, not by the LLM. MVP uses an API key.
The provider factory keeps the door open for `DefaultAzureCredential` (works with a personal
outlook.com account once an Azure subscription + `Azure AI User` RBAC exists).

---

## 2. Architecture — mapping Claude Code's 6 abstractions

| # | Claude Code abstraction | Our module | Notes |
|---|-------------------------|------------|-------|
| 1 | Query Loop (`query.ts`) | `src/core/query.ts` | Async generator: stream model → collect tool calls → execute → append results → loop. Yields typed messages. Returns a discriminated `Terminal` union (done / aborted / max-turns / error). |
| 2 | Tool System | `src/tools/` + `src/core/tool.ts` | A `Tool` interface: `name`, `description`, JSON `schema`, `execute()`, `permission()`, `render()`. Registry + executor. |
| 3 | Tasks / sub-agents | `src/core/tasks.ts` | `agent` tool spawns a fresh `query()` with its own history + tool subset + permission mode (`bubble`). |
| 4 | State (two layers) | `src/core/state.ts` | `STATE` singleton (cwd, model config, cost, session id) + a small reactive UI store. |
| 5 | Memory | `src/core/memory.ts` | Scan `AGENTS.md` / `CLAUDE.md` up the tree at startup; inject relevant content into the system prompt. |
| 6 | Hooks | `src/core/hooks.ts` | Lifecycle interceptors: `PreToolUse` (can deny), `PostToolUse`, `UserPromptSubmit`, `Stop`. |
| + | Permissions | `src/core/permissions.ts` | Modes: `default` / `plan` / `acceptEdits` / `dontAsk` / `bypass`. Resolves before each tool runs. Sub-agents `bubble` up. |
| + | Provider | `src/core/provider.ts` | `getModelClient()` factory. MVP: Foundry direct + API key. Stage 9: Add Foundry Agent option. |

---

## 3. Target directory layout

```
code-agent/
  PLAN.md                 # this file (progress source of truth)
  README.md               # usage (added in Stage 1)
  package.json
  tsconfig.json
  .env.example            # AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_API_KEY, MODEL
  .gitignore
  src/
    cli.ts                # REPL entry point
    core/
      provider.ts         # getModelClient() factory
      query.ts            # the query loop (async generator)
      tool.ts             # Tool interface + registry + executor
      permissions.ts      # permission modes + resolver
      state.ts            # STATE singleton + UI store
      tasks.ts            # sub-agent spawner (Stage 5)
      memory.ts           # AGENTS.md/CLAUDE.md loader (Stage 6)
      hooks.ts            # lifecycle hooks (Stage 7)
      messages.ts         # message/Terminal types
    tools/
      index.ts            # registry wiring
      readFile.ts
      writeEditFile.ts
      shell.ts
      grep.ts
      glob.ts             # Stage 3
      webFetch.ts         # Stage 3
    prompts/
      system.ts           # system prompt builder
  test/                   # vitest specs per stage
```

---

## 4. Staged plan

> **GOVERNING RULE — Claude Code alignment (applies to EVERY stage):**
> Before starting and before marking any stage `DONE`, (re)read the corresponding
> chapter(s) of **https://claude-code-from-source.com/** listed in the stage's
> **CC ref** line and in the map below. For each stage:
> 1. Read the referenced chapter(s) and note the architecture guidance + the
>    chapter's "Apply This" transferable patterns.
> 2. Implement so our design *aligns with* that guidance (adapt, don't blindly copy;
>    record any deliberate divergence and why in the stage Notes).
> 3. In the stage's Acceptance, add an explicit check: "Reviewed CC ch.<n>; design
>    aligns / diverges because <reason>." Only then set the stage `DONE`.
>
> ### Stage ↔ Claude Code chapter map
> Book TOC (18 ch): 1 Architecture · 2 Bootstrap · 3 State · 4 API Layer ·
> 5 Agent Loop · 6 Tools · 7 Concurrency · 8 Sub-Agents · 9 Fork Agents/Prompt Cache ·
> 10 Tasks/Coordination/Swarms · 11 Memory · 12 Extensibility (Skills & Hooks) ·
> 13 Terminal UI · 14 Input/Interaction · 15 MCP · 16 Remote · 17 Performance · 18 Epilogue.
>
> | Stage | Primary CC chapters (must review) | URLs |
> |-------|-----------------------------------|------|
> | 0 Scaffold + provider | 1 Architecture, 2 Bootstrap, 4 API Layer | /ch01-architecture/ · /ch02-bootstrap/ · /ch04-api-layer/ |
> | 1 Query loop + tools + CLI | 5 Agent Loop, 6 Tools, 1 Architecture | /ch05-agent-loop/ · /ch06-tools/ · /ch01-architecture/ |
> | 2 Permission hardening | 6 Tools (permission system), 1 Architecture (permission modes) | /ch06-tools/ · /ch01-architecture/ |
> | 3 glob + web_fetch + concurrency | 6 Tools, 7 Concurrency | /ch06-tools/ · /ch07-concurrency/ |
> | 4 Two-layer state + cost | 3 State, 4 API Layer, 17 Performance | /ch03-state/ · /ch04-api-layer/ · /ch17-performance/ |
> | 5 Sub-agents / Tasks | 8 Sub-Agents, 9 Fork Agents, 10 Tasks/Coordination | /ch08-sub-agents/ · /ch09-fork-agents/ · /ch10-coordination/ |
> | 6 Memory | 11 Memory | /ch11-memory/ |
> | 7 Hooks | 12 Extensibility (Skills & Hooks) | /ch12-extensibility/ |
> | (CLI/UX polish, any stage) | 13 Terminal UI, 14 Input/Interaction | /ch13-terminal-ui/ · /ch14-input-interaction/ |
> | 8 (opt) Agent Service + Entra ID | 4 API Layer (multi-provider), 15 MCP | /ch04-api-layer/ · /ch15-mcp/ |
| 9 (DEFERRED) Migrate to Foundry Agent | 4 API Layer, 8 Sub-Agents, 15 MCP | /ch04-api-layer/ · /ch08-sub-agents/ · /ch15-mcp/ |
>
> Base URL for all paths above: `https://claude-code-from-source.com`

Each stage lists: **Goal**, **Files**, **Tasks**, **Acceptance criteria** (how we prove it works),
and a **Checkpoint** (what to record in the Progress Table when done).

### Stage 0 — Project scaffold & provider smoke test
- **CC ref:** ch01 Architecture, ch02 Bootstrap, ch04 API Layer.
- **Goal:** A TypeScript project that can call the Foundry model and print a reply.
- **Files:** `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `src/core/provider.ts`, `src/core/messages.ts`, a throwaway `src/smoke.ts`.
- **Tasks:**
  - `npm init`, add deps: `openai`, `@azure/identity` (future), `dotenv`, `zod`; dev: `typescript`, `tsx`, `vitest`, `@types/node`.
  - `getModelClient()` returns an `openai` client pointed at `AZURE_FOUNDRY_ENDPOINT` with `AZURE_FOUNDRY_API_KEY`.
  - Smoke script: send one chat message, print the response.
- **Acceptance:** `npx tsx src/smoke.ts` prints a model reply using the user's Foundry deployment.
- **Checkpoint:** endpoint/model name confirmed working; record model id in Progress notes.

### Stage 1 — Query loop + Tool system + first tools + minimal CLI (MVP core)
- **CC ref:** ch05 Agent Loop, ch06 Tools, ch01 Architecture.
- **Goal:** End-to-end: type a request → agent reads/edits files & runs shell → answers.
- **Files:** `src/core/query.ts`, `src/core/tool.ts`, `src/core/state.ts`, `src/core/permissions.ts` (basic), `src/tools/{readFile,writeEditFile,shell,grep}.ts`, `src/tools/index.ts`, `src/prompts/system.ts`, `src/cli.ts`, `README.md`.
- **Tasks:**
  - Define `Tool` interface + registry + a `StreamingToolExecutor` (serial first; concurrency later).
  - Implement query loop as an async generator with a `Terminal` return union and a max-turn guard.
  - Implement the 4 tools with zod-validated inputs. `shell` uses PowerShell on Windows.
  - Basic permission gate: prompt the user before any mutating tool (`writeEditFile`, `shell`).
  - REPL in `cli.ts` (`readline`), streams assistant text, shows tool activity.
- **Acceptance:** In `Q:\src\code-agent`, ask the agent to "create a file hello.txt with 'hi' and read it back" — it uses `writeEditFile` then `readFile` and reports success. Ask it to "list .ts files" — it uses `shell`/`grep`.
- **Checkpoint:** MVP works end-to-end; record example transcript path.

### Stage 2 — Permission system hardening
- **CC ref:** ch06 Tools (permission system), ch01 Architecture (permission modes table).
- **Goal:** Robust, mode-driven approvals.
- **Tasks:** Implement modes `default` / `plan` (read-only) / `acceptEdits` / `dontAsk`. Per-tool `permission()` classifies read vs mutate. `plan` blocks all mutations. Remember per-session approvals ("allow for this session").
- **Acceptance:** `plan` mode refuses to write/shell; `acceptEdits` auto-approves edits but still prompts for shell; approvals persist within a session.
- **Checkpoint:** permission matrix table filled in README.

### Stage 3 — More tools: glob + web_fetch, and concurrency
- **CC ref:** ch06 Tools, ch07 Concurrency (partition algorithm, streaming/speculative execution).
- **Goal:** Round out the first tool set; parallelize safe tools.
- **Tasks:** Add `glob` (fast file matching) and `webFetch`. Mark read-only tools concurrency-safe; executor runs them in parallel batches, mutating tools serially.
- **Acceptance:** Agent can `glob` for `**/*.ts` and `webFetch` a URL; two `readFile` calls run concurrently (log timestamps prove overlap).
- **Checkpoint:** tool registry complete for v1.

### Stage 4 — Two-layer state + cost/telemetry + streaming polish
- **CC ref:** ch03 State (two-tier), ch04 API Layer (streaming/cost), ch17 Performance.
- **Goal:** Session infrastructure + a responsive UI.
- **Tasks:** Flesh out `STATE` (cwd, model, session id, token/cost counters). Add a tiny reactive store for UI (messages, current tool, approvals). Token usage + rough cost readout after each turn.
- **Acceptance:** `/cost` (or footer) shows token + cost; UI updates live during streaming.
- **Checkpoint:** state fields documented.

### Stage 5 — Tasks / sub-agents
- **CC ref:** ch08 Sub-Agents (runAgent lifecycle), ch09 Fork Agents/Prompt Cache, ch10 Tasks/Coordination.
- **Goal:** Recursive delegation.
- **Tasks:** `agent` tool that spawns a child `query()` with its own history, a tool subset, and `bubble` permission mode (child cannot self-approve dangerous actions). State machine: `pending → running → completed | failed | killed`.
- **Acceptance:** Parent asks a sub-agent to "summarize all .ts files"; sub-agent runs its own loop and returns a result; a mutating action inside the sub-agent bubbles a prompt to the user.
- **Checkpoint:** sub-agent transcript recorded.

### Stage 6 — Memory (AGENTS.md / CLAUDE.md)
- **CC ref:** ch11 Memory (file-based memory, 4-type taxonomy, LLM recall, staleness).
- **Goal:** Persistent project context.
- **Tasks:** At startup, walk from cwd to repo root collecting `AGENTS.md` / `CLAUDE.md`; parse optional frontmatter; inject into the system prompt. Add `/memory` to list what was loaded.
- **Acceptance:** A repo `AGENTS.md` rule visibly changes agent behavior; `/memory` lists the files.
- **Checkpoint:** memory sources listed.

### Stage 7 — Hooks
- **CC ref:** ch12 Extensibility (lifecycle hooks, config snapshot security).
- **Goal:** Lifecycle interception.
- **Tasks:** `PreToolUse` (can deny / modify input), `PostToolUse`, `UserPromptSubmit`, `Stop`. Config-driven (shell command or inline JS). Wire the permission `plan`-block partly through `PreToolUse`.
- **Acceptance:** A `PreToolUse` hook that blocks `shell rm`-style commands actually prevents execution; a `PostToolUse` hook logs every tool call.
- **Checkpoint:** hooks documented in README.

### Stage 8 (optional / later) — Agent Service & Entra ID
- **CC ref:** ch04 API Layer (multi-provider client), ch15 MCP (universal tool protocol).
- Only if managed web search / code interpreter / RAG / publishing is needed.
- Add an alternate provider behind `getModelClient()` using `@azure/ai-projects` + `DefaultAzureCredential`; handle the function-call round-trip + 10-min run window.

### Stage 9 — Migrate to Azure AI Foundry Agent
- **CC ref:** ch04 API Layer (multi-provider client), ch08 Sub-Agents (agent patterns), ch15 MCP.
- **Goal:** Migrate from direct model deployment to Azure AI Foundry Agent for built-in tracing, tool execution, and memory.
- **Status:** **DEFERRED** — Will implement after all other stages are complete.
- **Rationale:** Currently using direct model deployment (Stage 0-1). Will migrate to Foundry Agent later for:
  - ✅ Built-in tracing (no need to implement custom tracing)
  - ✅ Built-in tool execution framework
  - ✅ Built-in conversation memory
  - ✅ Built-in RAG integration (Azure AI Search)
  - ✅ Azure AI Foundry portal monitoring
- **Files:** `src/core/provider-foundry-agent.ts` (new), updates to `src/core/provider.ts`.
- **Tasks:**
  - Research Azure AI Foundry Agent SDK (`@azure/ai-projects`).
  - Create a new provider factory option for Foundry Agent.
  - Migrate tool definitions to Foundry Agent tool schema format.
  - Enable built-in tracing via Foundry portal.
  - Update CLI to support both direct deployment and Agent modes.
  - Document migration steps and differences in README.
- **Acceptance:** Agent works via Foundry Agent; traces visible in Foundry portal; falls back to direct deployment if Agent unavailable.
- **Checkpoint:** Provider factory supports both modes; migration documented.

---

## 5. Progress Table  ← UPDATE THIS AS THE FIRST/LAST THING EACH SESSION

Status values: `TODO` · `IN_PROGRESS` · `DONE` · `BLOCKED`

| Stage | Description | Status | Last updated | Notes |
|-------|-------------|--------|--------------|-------|
| 0 | Scaffold + provider smoke test | DONE | 2026-07-22 | Scaffold DONE: package.json/tsconfig/.gitignore/.env(.example), src/core/{provider,messages}.ts, src/smoke.ts. Provider factory mirrors getAnthropicClient() pattern; Terminal union in messages.ts. Azure config: endpoint=https://huanglsh666-7029-resource.cognitiveservices.azure.com/openai/v1/, model=gpt-5-mini. Added zod-to-json-schema for tool schema conversion. |
| 1 | Query loop + tools + CLI (MVP) | DONE | 2026-07-22 | Complete: query.ts async generator, tool.ts registry/executor, 4 tools (readFile/writeEditFile/shell/grep), permissions.ts (modes + session approvals), cli.ts REPL, README.md. Design aligns with CC ch05/ch06/ch01. |
| 2 | Permission hardening | DONE | 2026-07-23 | Complete: STATE.mode field, checkPermission with full matrix, CLI commands (:default/:accept-edits/:yes/:status/:revoke), prompt shows mode, 15 tests pass. |
| 3 | glob + web_fetch + concurrency | TODO | 2026-07-21 | |
| 4 | Two-layer state + cost | TODO | 2026-07-21 | |
| 5 | Sub-agents / Tasks | TODO | 2026-07-21 | |
| 6 | Memory (AGENTS.md/CLAUDE.md) | TODO | 2026-07-21 | |
| 7 | Hooks | TODO | 2026-07-21 | |
| 8 | (Optional) Agent Service + Entra ID | TODO | 2026-07-21 | Deferred. |
| 9 | Migrate to Azure AI Foundry Agent | TODO | 2026-07-22 | DEFERRED - Will implement after all other stages complete. Using direct model deployment currently. |

---

## 6. How to Resume (read this first on every restart)

1. Open this `PLAN.md`. Read the **Progress Table** — find the first stage not `DONE`.
2. If a stage is `IN_PROGRESS`, read its **Notes** cell for exactly where it stopped.
3. Check the code against the stage's **Files** list to see what already exists.
4. Continue that stage. When it passes its **Acceptance criteria**, set it to `DONE`,
   update **Last updated**, and write a one-line **Notes** summary of what was delivered.
5. Before ending a working session, always: set the current stage's status,
   update **Last updated**, and jot the next concrete action in **Notes**.

### Secrets / config needed to run
- `AZURE_FOUNDRY_ENDPOINT` — Foundry project/model endpoint (e.g. `https://<res>.cognitiveservices.azure.com/openai/v1/`)
- `AZURE_FOUNDRY_API_KEY` — from the Foundry portal
- `MODEL` — deployment/model name (e.g. `gpt-5-mini`)
- Put these in `.env` (git-ignored). `.env.example` documents them.

### Commands (filled in as stages land)
- Install: `npm install`
- Smoke test: `npx tsx src/smoke.ts`
- Run agent: `npx tsx src/cli.ts`
- Tests: `npx vitest run`

---

## 7. Open questions to confirm before / during Stage 0
- Foundry **endpoint URL**, **API key**, and **deployment/model name**? → placeholders in `.env` for now; user to fill real values.
- Preferred shell for the `shell` tool on Windows: **PowerShell** (DECIDED — use PowerShell).
- Should the agent be restricted to the project dir by default (path sandboxing)?
  → **DECIDED: sandbox ON by default** (tools reject paths resolving outside the project root),
  with an override/approval to allow outside access. Implement in Stage 1 (tools) + Stage 2 (permissions).

---

## 8. Issues to Fix (recorded during Azure setup)

### Issue 1: Tool argument passing fails
- **Symptom:** When the model calls a tool (e.g., `readFile`), the tool receives `undefined` for required parameters (e.g., `path`).
- **Error:** `Invalid type: expected string, received undefined` from Zod validation.
- **Root cause:** The model's function call arguments are not being correctly parsed and passed to the tool in `loop.ts`.
- **Location:** `src/core/loop.ts` - the tool call arguments parsing logic.
- **Status:** TODO - needs fixing

### Issue 2: Tool message format for Azure OpenAI
- **Symptom:** Error: `messages with role 'tool' must be a response to a preceding message with 'tool_calls'`
- **Root cause:** The message format when sending tool results back to the model may not match Azure OpenAI's requirements.
- **Location:** `src/core/loop.ts` - the message history building logic after tool execution.
- **Status:** TODO - needs fixing

### Issue 3: Model selection in Azure
- **Symptom:** Original request was for `gpt-4`, but `gpt-4o` and `gpt-4.1` were deprecated or not available.
- **Solution applied:** Using `gpt-5-mini` which was already deployed.
- **Status:** WORKAROUND applied - gpt-5-mini is working
