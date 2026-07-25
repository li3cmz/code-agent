# Permission System

## 概述

权限系统采用 **模式驱动 (mode-driven)** 的审批机制，结合 **工具权限模型 (tool permission model)** 共同决策是否允许工具执行。

## 工具权限模型

每个工具根据其行为被分类为：

| 类型 | 描述 | 示例 |
|------|------|------|
| `read` | 只读操作，不修改系统状态 | 读取文件、搜索代码 |
| `mutate` | 修改操作，会改变系统状态 | 写入文件、执行 shell 命令 |

工具通过 `permission()` 方法声明自己的类型。

## 权限模式 (PermissionMode)

| 模式 | 读工具 (read) | writeEditFile | shell | 已批准的 tool |
|------|---------------|---------------|-------|---------------|
| `default` | ✓ | prompt | prompt | ✓ (任意) |
| `plan` | ✓ | ✗ | ✗ | ✗ |
| `acceptEdits` | ✓ | ✓ | prompt | ✓ |
| `dontAsk` | ✓ | ✓ | ✓ | ✓ |

**说明：**
- ✓ = 自动允许
- ✗ = 阻止执行
- prompt = 需要用户确认

## 决策流程图

```
用户输入请求
    │
    ▼
┌─────────────────────────────────────────────┐
│ 获取有效模式 (effectiveMode)                 │
│                                             │
│ 1. 显式传入 permissionMode?                  │
│    └─ 是 → 使用传入的 mode                   │
│    └─ 否 → 调用 getEffectiveModeOnce()      │
│             ├─ 有临时模式? → 返回并清除      │
│             └─ 无临时模式? → 返回 STATE.mode │
└─────────────────────────────────────────────┘
    │
    ▼
对于每个 tool call:
    │
    ▼
┌─────────────────────────────────────────────┐
│ checkPermission(tool, effectiveMode)        │
│                                             │
│ 1. 工具已在本会话批准?                       │
│    └─ 是 → 允许执行                          │
│                                             │
│ 2. effectiveMode = dontAsk?                 │
│    └─ 是 → 允许执行                          │
│                                             │
│ 3. effectiveMode = plan?                    │
│    └─ 是 → 工具权限 = mutate?               │
│            ├─ 是 → 拒绝 (Plan mode blocks   │
│            │         all mutating tools)    │
│            └─ 否 → 允许执行                  │
│                                             │
│ 4. effectiveMode = acceptEdits?             │
│    └─ 是 → 工具 = writeEditFile?            │
│            ├─ 是 → 允许执行                  │
│            └─ 否 → 继续判断                  │
│                                             │
│ 5. 工具权限 = mutate?                       │
│    └─ 是 → 拒绝 (需要用户 prompt)            │
│                                             │
│ 6. 其他情况                                  │
│    └─ → 允许执行                            │
└─────────────────────────────────────────────┘
    │
    ▼
需要用户批准?
    ├─ 是 → 调用 onApprovalRequest 回调
    └─ 否 → 执行工具
```

## 决策条件矩阵

| Mode \ Tool | read | writeEditFile | shell | 已批准工具 |
|-------------|------|---------------|-------|------------|
| `default` | ✓ | prompt | prompt | ✓ |
| `plan` | ✓ | ✗ | ✗ | ✗ |
| `acceptEdits` | ✓ | ✓ | prompt | ✓ |
| `dontAsk` | ✓ | ✓ | ✓ | ✓ |

## 设置权限的方式

### CLI 命令

```
:plan            - 永久切换到 plan 模式
:default         - 切换到 default 模式
:accept-edits    - 切换到 acceptEdits 模式
:yes             - 切换到 dontAsk 模式
:once <mode>    - 临时设置，只对下一次请求有效
                 (可用参数: plan/default/accept-edits/yes)
:status          - 查看当前模式和已批准的工具
:revoke [tool]  - 撤销工具批准 (可指定具体工具)
```

### API 调用

```typescript
import { 
  setPermissionMode, 
  setTempPermissionMode,
  checkPermission,
  approveTool 
} from "./core/permissions.js";

// 永久设置模式
setPermissionMode("plan");

// 临时设置（单次有效）
setTempPermissionMode("acceptEdits");

// 批准工具（本次会话有效）
approveTool("writeEditFile");
```

## 核心函数

| 函数 | 作用 |
|------|------|
| `getEffectiveMode(override?)` | 获取当前模式，支持 override 覆盖 |
| `getEffectiveModeOnce()` | 获取临时模式，使用后自动清除 |
| `setPermissionMode(mode)` | 永久设置权限模式 |
| `setTempPermissionMode(mode)` | 设置临时模式（单次有效） |
| `checkPermission(tool, mode)` | 检查工具是否允许执行 |
| `approveTool(name)` | 批准某工具（本次会话有效） |
| `revokeTool(name)` | 撤销工具批准 |
| `revokeAllTools()` | 撤销所有工具批准 |
| `getPermissionMode()` | 获取当前权限模式 |
| `getModeDisplay()` | 获取模式显示字符串 |

## 临时权限 (One-shot Permission)

临时权限通过 `:once` 命令设置，仅对下一次请求有效：

```
> :once yes
Temporary mode set: dontAsk (will be used for next request only)

> Hello world    # 这次请求使用 dontAsk 模式
... 

> Hello again    # 下次请求恢复默认模式
```

实现原理：
1. `setTempPermissionMode(mode)` 将临时模式存入 `STATE._tempMode`
2. `loop()` 在处理请求前调用 `getEffectiveModeOnce()`
3. `getEffectiveModeOnce()` 返回临时模式并立即清除
4. 后续请求不再使用临时模式
