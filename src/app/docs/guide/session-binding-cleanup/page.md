---
dimensions:
  type:
    primary: getting-started
    detail: operations
  level: intermediate
standard_title: 会话绑定清理工具
language: zh
---

# 会话绑定清理工具

会话绑定清理工具是一个命令行脚本，用于批量清除指定供应商的 Session 绑定数据。该工具适用于供应商下线、紧急维护或调试场景。

{% callout type="warning" title="操作不可撤销" %}
清理操作会永久删除 Redis 中的会话绑定数据，请务必在执行前确认操作范围。建议先使用 `--dry-run` 参数预览将要清理的内容。
{% /callout %}

---

## 运行前提

在运行会话绑定清理工具前，请确保：

| 前提条件 | 说明 |
|----------|------|
| 安装 Bun | 工具使用 Bun 运行时，需要先安装 Bun |
| 环境变量 | 正确加载 `.env` 文件，确保 Redis 和数据库连接配置正确 |
| 工作目录 | 必须在 claude-code-hub 仓库根目录下执行脚本 |
| Redis 可用 | Redis 服务必须运行且可连接 |

---

## 功能概述

该工具可以根据以下条件筛选并清理 Session 绑定：

- **按优先级**：清除低于指定优先级的供应商绑定
- **按供应商 ID**：清除指定供应商的绑定
- **按名称**：模糊匹配供应商名称
- **按类型**：筛选特定类型的供应商

---

## 使用方法

### 交互式模式（推荐）

不带任何参数运行脚本，进入交互式引导模式：

```bash
bun run scripts/clear-session-bindings.ts
```

交互式模式会引导您：
1. 选择筛选方式
2. 输入筛选条件
3. 预览将要清理的供应商
4. 确认执行清理

### 命令行模式

直接通过参数指定筛选条件：

```bash
# 按优先级筛选（清除 priority < 5 的供应商绑定）
bun run scripts/clear-session-bindings.ts --priority 5

# 指定供应商 ID（多个 ID 用逗号分隔）
bun run scripts/clear-session-bindings.ts --id 1,2,3

# 按名称模糊匹配
bun run scripts/clear-session-bindings.ts --name "cubence"

# 按供应商类型筛选
bun run scripts/clear-session-bindings.ts --type claude

# 组合条件
bun run scripts/clear-session-bindings.ts --type claude --priority 10
```

---

## 命令行参数

| 参数 | 简写 | 类型 | 说明 |
|------|------|------|------|
| `--priority` | `-p` | number | 优先级阈值，清除 priority 小于该值的供应商绑定 |
| `--id` | - | string | 供应商 ID 列表，多个 ID 用逗号分隔 |
| `--name` | - | string | 供应商名称模糊匹配 |
| `--type` | - | string | 供应商类型筛选 |
| `--yes` | `-y` | flag | 跳过确认提示，直接执行 |
| `--dry-run` | - | flag | 预览模式，仅显示将要清理的内容，不实际执行 |

{% callout type="note" title="条件组合逻辑" %}
当同时指定多个筛选条件时，系统采用 **AND（与）** 逻辑：供应商必须同时满足所有条件才会被选中进行清理。

例如：`--type claude --priority 10` 表示清理**同时满足**类型为 claude **且** priority < 10 的供应商绑定。
{% /callout %}

### 供应商类型选项

`--type` 参数支持以下值：

| 类型值 | 说明 |
|--------|------|
| `claude` | Anthropic 官方 API |
| `claude-auth` | Claude 中转服务 |
| `codex` | OpenAI Codex/Response API |
| `gemini` | Google Gemini API |
| `gemini-cli` | Gemini CLI 格式 |
| `openai-compatible` | OpenAI 兼容 API |

---

## 使用示例

### 预览模式

在实际清理前，建议先使用 `--dry-run` 查看将要清理的内容：

```bash
bun run scripts/clear-session-bindings.ts --priority 5 --dry-run
```

输出示例：

```
[DRY RUN] 以下供应商的 Session 绑定将被清理：

ID    名称              类型         优先级
----  ----------------  -----------  ------
3     备用供应商-A       claude       3
5     测试供应商         claude-auth  1

共 2 个供应商，预计清理 15 个 Session 绑定

[DRY RUN] 实际未执行任何清理操作
```

### 自动化场景

在脚本或 CI/CD 中使用时，添加 `-y` 参数跳过确认：

```bash
bun run scripts/clear-session-bindings.ts --id 3,5 -y
```

---

## 清理的数据

执行清理时，工具会删除以下 Redis 数据：

### Session 相关 Key

| Key 格式 | 说明 |
|----------|------|
| `session:{sessionId}:provider` | Session 绑定的供应商 ID |
| `session:{sessionId}:info` | Session 基本信息 |
| `session:{sessionId}:usage` | Session 使用统计 |
| `session:{sessionId}:key` | Session 使用的 API Key |
| `session:{sessionId}:last_seen` | 最后活跃时间 |
| `session:{sessionId}:messages` | Session 消息记录（如启用存储） |
| `session:{sessionId}:response` | Session 响应记录（如启用存储） |
| `session:{sessionId}:concurrent_count` | 并发计数 |

### ZSet 成员

| ZSet Key | 说明 |
|----------|------|
| `global:active_sessions` | 全局活跃 Session 集合 |
| `provider:{providerId}:active_sessions` | 供应商活跃 Session 集合 |
| `key:{keyId}:active_sessions` | API Key 活跃 Session 集合 |

---

## 使用场景

### 供应商下线

当某个供应商需要永久下线时，清理其绑定可以确保现有 Session 不会继续尝试使用该供应商：

```bash
bun run scripts/clear-session-bindings.ts --id 3 -y
```

### 紧急维护

当供应商出现严重问题需要紧急切换时，清理绑定可以强制所有 Session 重新选择供应商：

```bash
bun run scripts/clear-session-bindings.ts --name "问题供应商" -y
```

### 批量清理低优先级供应商

在调整供应商优先级后，清理低优先级供应商的绑定：

```bash
bun run scripts/clear-session-bindings.ts --priority 10 -y
```

### 调试与测试

在开发环境中清理特定类型供应商的绑定：

```bash
bun run scripts/clear-session-bindings.ts --type codex --dry-run
```

---

## 注意事项

### 执行时机

- **建议在低峰期执行**：清理操作可能影响正在进行的 Session
- **避免频繁执行**：频繁清理会导致用户体验下降（需要重新建立 Session）

### 影响范围

- 清理后，受影响的 Session 将在下次请求时重新选择供应商
- 已建立的 WebSocket 连接不受影响，但新请求会触发重新绑定
- 不会影响请求日志数据

### 权限要求

- 需要有 Redis 连接权限
- 需要有数据库读取权限（用于查询供应商信息）

---

## 相关功能

- [活跃 Session](/docs/guide/sessions) - 查看和管理当前活跃会话
- [供应商管理](/docs/guide/settings-providers) - 配置供应商参数
- [数据管理](/docs/guide/settings-data) - 数据导出和清理
