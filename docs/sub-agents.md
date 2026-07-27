# Stage 5: Sub-Agents 实现文档

## 概述

Stage 5 实现了**子代理 (Sub-Agent)** 机制，允许主 Agent 将复杂任务委托给独立运行的子代理。子代理拥有独立的执行环境，包括独立的消息历史、受限的工具集，以及 "bubble" 权限模式。

这种设计灵感来自 Claude Code 的子代理架构 (ch08-ch10)，让主 Agent 能够像"项目经理"一样委派任务，同时保持对危险操作的控制。

---

## 架构组件

```
┌─────────────────────────────────────────────────────────────┐
│                        Main Loop (loop.ts)                   │
│                  主 Agent 的查询循环                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Tool (tools/agent.ts)              │
│         触发子代理的工具，被主 Agent 调用                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Sub-Agent Runner (core/agent-runner.ts)         │
│         运行子代理的核心逻辑，调用 loop()                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     loop() (core/loop.ts)                    │
│              子代理自己的查询循环（复用主循环）                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心文件说明

### 1. tools/agent.ts — Agent 工具

Agent Tool 是主 Agent 调用子代理的入口点：

```typescript
export const agentTool: Tool = {
  name: "agent",
  description: "Spawn a sub-agent to handle a task...",
  inputSchema: agentInputSchema,  // task, tools, maxTurns
  permission: () => "mutate",     // 始终视为 mutation
  
  async execute(input, context) {
    const result = await runSubAgent({
      task,
      tools,
      maxTurns,
      permissionMode: "bubble",
    });
  }
};
```

**输入参数：**
- `task`: 子代理需要完成的任务描述
- `tools`: 可选，指定子代理可用的工具列表
- `maxTurns`: 最大轮次，默认 20

### 2. core/agent-runner.ts — 子代理运行器

子代理的核心运行逻辑：

```typescript
export async function runSubAgent(options: SubAgentOptions): Promise<SubAgentResult> {
  // 1. 过滤可用工具
  const availableTools = allowedTools 
    ? toolRegistry.getAll().filter(t => allowedTools.includes(t.name))
    : toolRegistry.getAll();

  // 2. 构建自定义 system prompt
  const customSystemPrompt = buildSystemPrompt() + 
    "\n\n[Sub-agent mode: You must request approval for any mutation tool.]";

  // 3. 复用主 loop，但传入受限参数
  for await (const event of loop({
    userMessage: task,
    maxTurns,
    permissionMode: "bubble",   // 关键：气泡权限模式
    allowedTools: toolNames,    // 限制工具集
    customSystemPrompt,
    onApprovalRequest,
    onTextChunk,
  })) {
    // 处理事件...
  }
}
```

### 3. core/loop.ts — 查询循环（复用）

子代理复用主 Agent 的查询循环，通过参数区分：

```typescript
for await (const event of loop({
  userMessage: task,           // 子代理的任务
  maxTurns,                    // 最大轮次
  permissionMode: "bubble",    // 气泡权限模式
  allowedTools: toolNames,     // 过滤后的工具集
  customSystemPrompt,          // 自定义 system prompt
})) {
  // 处理事件...
}
```

---

## 核心概念

### 1. 独立消息历史

子代理拥有完全独立的消息历史，不继承主 Agent 的对话上下文：

- 每个子代理从零开始构建 `messages` 数组
- 专注于自己的任务，不受主对话干扰
- 避免上下文污染，保持任务边界清晰

### 2. 工具子集 (Tool Subset)

通过 `allowedTools` 参数限制子代理可用的工具：

```typescript
// 只给子代理读取类工具
tools: ["Read", "Glob", "Grep"]

// 或给编辑类工具
tools: ["Read", "Edit", "Write", "Bash"]
```

这确保子代理只能访问完成任务的必要工具，提高安全性。

### 3. Bubble 权限模式

这是关键设计：**子代理不能自行批准危险操作**

```typescript
// loop.ts 中的权限检查
const permission = checkPermission(tool, effectiveMode);
if (!permission.allowed) {
  if (onApprovalRequest) {
    // 权限拒绝 → 向上传递请求给用户
    const approved = await onApprovalRequest(tool, input);
    // ...
  }
}
```

当子代理尝试执行 mutation 工具时：
- 权限检查失败
- `onApprovalRequest` 回调被触发
- 请求向上传递给主 Agent 或用户批准

---

## 数据流示例

```
User: "帮我分析这个项目的代码结构并生成文档"

Main Agent:
  → agent tool 被调用
    ├── task: "分析代码结构并生成文档"
    ├── tools: ["Glob", "Read", "Write"]  // 只给必要工具
    └── maxTurns: 20
    
  → Sub-Agent 启动
    ├── Glob 扫描文件结构 ✓ (read 权限，自动允许)
    │
    ├── Read 读取关键文件 ✓ (read 权限，自动允许)
    │
    └── Write 生成文档 ✗ (mutate 权限，需要用户批准!)
         → onApprovalRequest 触发
         → 请求传递到主 Agent/用户
         → 批准后执行
         
  → 结果返回给主 Agent
```

---

## 为什么这样设计？

| 特性 | 目的 |
|------|------|
| **独立消息历史** | 子代理专注任务，不受主对话干扰 |
| **工具子集** | 按任务限制能力（如只读任务不给编辑工具） |
| **Bubble 权限** | 子代理无法自行批准危险操作，必须向上传递 |
| **复用 loop** | 无需重写核心逻辑，减少维护成本 |

---

## STATE.cwd 用途

`STATE.cwd` 存储当前工作目录，用于所有工具执行时的上下文：

```typescript
// state.ts
cwd = process.cwd();

// loop.ts - 工具执行时传入 cwd
const { result } = await executeToolWithRetry(tc.name, input, { cwd: STATE.cwd });
```

这确保所有文件操作都基于项目根目录，保持一致性。

---

## 相关文档

- [function_call.md](./function_call.md) — 函数调用机制
- [permission.md](./permission.md) — 权限系统
- [streaming.md](./streaming.md) — 流式响应
- [system-optimization.md](./system-optimization.md) — 系统优化
