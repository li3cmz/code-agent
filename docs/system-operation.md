# System Operation

## 并发模式 (Concurrency Patterns)

> 参考: Claude Code ch07 Concurrency

当前实现：基础并行执行（读工具并行，突变工具串行）

### 1. Partition (分区)

将大任务拆分成多个子任务并行执行。

```
场景: 读取 100 个文件
方案: 拆成 10 批，每批 10 个文件，并行处理
```

**实现要点：**
- 输入分片 (input partitioning)
- 并行执行子任务
- 结果聚合 (result aggregation)

```typescript
// 示例伪代码
async function partitionExecute<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const batches = chunk(items, batchSize);
  const results = await Promise.all(batches.map(processor));
  return results.flat();
}
```

### 2. Speculative (推测执行)

并行尝试多个可行方案，第一个返回有效结果后取消其他。

```
场景: 多个可能成功的命令
方案: 同时执行，谁先成功用谁
```

**实现要点：**
- 方案队列
- 竞态条件处理
- 取消其他分支

```typescript
// 示例伪代码
async function speculativeExecute<T>(
  tasks: Array<() => Promise<T>>
): Promise<T> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    
    tasks.forEach(async (task) => {
      try {
        const result = await task();
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      } catch (e) {
        if (!resolved) {
          reject(e);
        }
      }
    });
  });
}
```

### 3. 当前实现 (基础版)

```typescript
// 读工具并行
const readResults = await Promise.all(
  readCalls.map(async ({ tc, input }) => {
    return await executeTool(tc.name, input, { cwd: STATE.cwd });
  })
);

// 突变工具串行
for (const { tc, input } of mutateCalls) {
  await executeTool(tc.name, input, { cwd: STATE.cwd });
}
```

### 4. 未来扩展

如需实现 Partition/Speculative 模式：

1. **Partition** - 在 tool executor 层添加 batch 处理
2. **Speculative** - 在 loop 层添加多路径探索
3. 需要修改 tool 定义支持返回"部分结果"和"取消信号"

---

## 工具生命周期

```
用户输入
    ↓
loop() 获取 effectiveMode
    ↓
模型返回 tool_calls
    ↓
分离: readCalls / mutateCalls
    ↓
readCalls 并行执行 → 结果聚合
    ↓
mutateCalls 串行执行 → 依次执行
    ↓
结果加入消息历史
    ↓
下一轮模型调用
```

---

## 权限检查点

| 阶段 | 检查 |
|------|------|
| tool_call 前 | `checkPermission(tool, effectiveMode)` |
| 拒绝时 | 是否有 `onApprovalRequest` 回调? |
| 批准后 | 工具执行，结果加入消息历史 |
