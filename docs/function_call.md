# Function Calling

## 什么是 Function Calling

模型有**工具意识**，需要调工具时能返回符合格式的工具调用。

```
模型看见工具定义
       ↓
知道能调哪些工具、各自需要什么参数
       ↓
判断这轮对话要不要调工具
       ↓
要调 → 返回 { name: "xxx", arguments: "{...}" }
不要调 → 直接回文本
```

模型本身不执行工具，只是"告诉系统要调哪个、传什么参数"。执行是我们的事情。

---

## 传统聊天 vs Function Calling

### 传统聊天
```
用户: "你好"
模型: "你好！有什么可以帮你的？"

用户: "今天天气怎么样"
模型: "我无法获取实时天气信息..."
```
模型只能生成文本，无法执行实际操作。

### Function Calling
```
用户: "帮我读取 src/cli.ts"
模型: 识别需要调用 readFile 工具
       ↓
       发送 tool_calls: { name: "readFile", arguments: '{"path":"src/cli.ts"}' }
       ↓
我们的系统执行工具，返回结果
       ↓
模型: "文件内容如下: ..."
```

---

## 核心概念

| 概念 | 说明 |
|------|------|
| **Function** | 你定义的工具（readFile, writeEditFile, glob 等） |
| **Calling** | 模型"调用"这些工具，不是它自己执行，而是告诉我们执行 |

模型说: "我要调 readFile，参数是 path=src/cli.ts"
                ↓
我们的代码: 执行工具，返回结果

---

## 实现方式

### 1. 定义工具 (Tool)

```typescript
const readFileTool = {
  name: "readFile",
  description: "Read file contents",
  inputSchema: z.object({ path: z.string() }),
  execute: async (input) => { ... }
};
```

### 2. 注册到模型 (tools 参数)

```typescript
const response = await client.chat.completions.create({
  model: "gpt-5-mini",
  messages,
  tools: [{
    type: "function",
    function: {
      name: "readFile",
      description: "Read file contents",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    }
  }]
});
```

### 3. 解析工具调用

```typescript
for (const tc of toolCalls) {
  const args = JSON.parse(tc.arguments);  // 解析参数
  const result = await executeTool(tc.name, args);  // 执行
}
```

---

## 完整流程

```
用户输入
    ↓
模型决定: 需要调用工具？
    ↓
┌─ 不需要 → 直接回复文本
└─ 需要 → 返回 tool_calls
              ↓
         我们解析参数 (JSON.parse)
              ↓
         校验参数 (Zod schema)
              ↓
         执行工具 (readFile, shell, glob...)
              ↓
         返回结果给模型
              ↓
         模型生成最终回复
```

---

## 当前实现

| 组件 | 文件 | 功能 |
|------|------|------|
| 工具定义 | `src/tools/*.ts` | 每个工具的 name, description, inputSchema, execute |
| 工具注册 | `src/tools/index.ts` | 注册所有工具到 registry |
| 工具执行 | `src/core/tool.ts` | validateToolInput + executeTool |
| 循环逻辑 | `src/core/loop.ts` | 解析 tool_calls，执行工具，聚合结果 |

---

## 参数处理现状

### 解析 (loop.ts)
```typescript
const parsedToolCalls = toolCalls.map((tc) => {
  let input: unknown;
  try {
    input = JSON.parse(tc.arguments);
  } catch {
    input = {};  // 解析失败兜底
  }
  return { tc, input };
});
```

### 校验 (tool.ts)
```typescript
export async function executeTool(name, rawInput, context) {
  const tool = toolRegistry.get(name);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  try {
    const input = validateToolInput(tool, rawInput);  // Zod 校验
    return await tool.execute(input, context);
  } catch (err) {
    return { success: false, error: err.message };  // 校验失败返回错误
  }
}
```

**现状:**
- ✓ JSON 解析失败有兜底
- ✓ Zod schema 校验
- ✓ 校验失败返回错误结果
- ❌ 无重试机制
- ❌ 无错误反馈给模型

---

## 模型要求

| 要求 | 说明 |
|------|------|
| 支持 Function Calling | gpt-3.5+ / claude 3+ 都支持 |
| 工具定义格式 | JSON Schema |
| 参数格式 | 必须是有效 JSON |

当前使用 **gpt-5-mini** (Azure 部署)，完全支持 Function Calling。

---

## 扩展思考

### 可以改进的点

1. **错误反馈循环** - 把工具执行错误喂回给模型，让它修正参数
2. **重试机制** - 参数错误时自动重试 N 次
3. **参数提取** - 如果模型没返回 JSON，尝试从 text 中提取
4. **并行优化** - 多个工具调用时的依赖解析和推测执行
