---
title: 活跃会话监控
description: 了解 Claude Code Hub 的活跃会话监控系统，包括会话识别、并发控制、生命周期管理和终止操作。
nextjs:
  metadata:
    title: 活跃会话监控
    description: Claude Code Hub 活跃会话监控文档
---

# 活跃会话监控

活跃会话监控是 Claude Code Hub 的核心运维功能，让你能够实时追踪和管理正在进行的 AI 对话会话。通过监控面板，你可以查看当前系统中所有活跃会话的状态、识别异常流量模式，并在必要时主动终止会话。

## 核心概念

### 什么是活跃会话

活跃会话（Active Session）代表当前正在进行中的 AI 对话。一个会话被认定为"活跃"的条件是：

- 会话在过去 5 分钟内有活动
- 会话信息存储在 Redis 中且未过期
- 会话被记录在全局活跃会话集合中

每个活跃会话都包含以下关键信息：

| 字段 | 说明 |
|------|------|
| Session ID | 会话唯一标识符 |
| 用户 | 发起会话的用户名称和 ID |
| API Key | 使用的 API Key 名称和 ID |
| 供应商 | 当前绑定的供应商名称和 ID |
| 模型 | 实际使用的 AI 模型 |
| API 类型 | `chat` 或 `codex` |
| 开始时间 | 会话首次请求的时间戳 |
| Token 使用量 | 输入、输出、缓存 Token 数量 |
| 成本 | 会话产生的费用（USD） |
| 状态 | `in_progress`、`completed` 或 `error` |
| 并发数 | 当前正在处理的并发请求数 |

### 会话生命周期

会话从创建到过期经历以下阶段：

```
请求到达
    ↓
SessionGuard 分配 Session ID
    ↓
存储 Session Info 到 Redis
    ↓
添加到活跃会话集合（ZSET）
    ↓
选择 Provider
    ↓
原子性并发检查（Lua Script）
    ↓
请求处理中...
    ↓
响应完成
    ↓
更新 Session Usage
    ↓
刷新 TTL（滑动窗口延长 5 分钟）
    ↓
5 分钟无活动
    ↓
自动过期清理
```

## 会话识别机制

系统通过多层降级策略识别会话，确保在各种场景下都能正确追踪对话连续性。

### 第一层：客户端传递 Session ID

Claude Code 等客户端会在请求中传递 Session 标识，这是首选的识别方式：

- **`metadata.user_id`**：格式为 `"{user}_session_{sessionId}"`，Claude Code 主要使用此方式
- **`metadata.session_id`**：直接传递 Session ID

```json
{
  "metadata": {
    "user_id": "alice_session_abc123",
    "session_id": "abc123"
  }
}
```

### 第二层：Codex Session 提取

对于 OpenAI/Codex 请求，系统会从 headers 或 body 中提取稳定的 Session 标识：

```typescript
// 从 prompt_cache_key 提取
const codexSessionId = `codex_${promptCacheKey}`;
```

### 第三层：确定性 Session ID 生成

当客户端未提供 Session ID 时，系统基于请求指纹生成稳定的标识：

- API Key 前缀（前 10 位）
- User-Agent
- 客户端 IP（`x-forwarded-for` / `x-real-ip`）

### 第四层：内容哈希匹配（降级方案）

作为最后的降级手段，系统计算 messages 前 3 条内容的 SHA-256 哈希，截取前 16 字符作为标识：

{% callout type="warning" title="注意" %}
内容哈希方案存在局限性：不同会话如果开头内容相似可能产生相同哈希。强烈建议客户端主动传递 `metadata.session_id` 或 `metadata.user_id`。
{% /callout %}

## 短上下文并发检测

为防止并发短任务污染缓存，系统实现了智能的短上下文检测机制。

### 触发条件

当同时满足以下条件时触发检测：

- 消息数量 ≤ 2 条（`SHORT_CONTEXT_THRESHOLD`）
- 该 Session 已有其他并发请求正在处理

### 处理逻辑

```
场景 A：短上下文 + 无并发请求
   └─→ 允许复用 Session（可能是长对话的开始）

场景 B：短上下文 + 有并发请求
   └─→ 强制新建 Session（并发短任务，避免缓存污染）
```

### 配置选项

```bash
# 短上下文阈值（消息数）
SHORT_CONTEXT_THRESHOLD=2

# 是否启用短上下文并发检测
ENABLE_SHORT_CONTEXT_DETECTION=true
```

## 会话追踪架构

系统采用 Redis Sorted Set（ZSET）管理会话生命周期，支持基于时间戳的自动过期。

### Redis 数据结构

**活跃会话集合（ZSET）**：

```
global:active_sessions              →  所有活跃 Session（score = timestamp）
key:{keyId}:active_sessions         →  按 API Key 分组
provider:{providerId}:active_sessions →  按供应商分组
user:{userId}:active_sessions       →  按用户分组
```

**Session 绑定信息**：

```
session:{sessionId}:provider  →  providerId（供应商绑定）
session:{sessionId}:key       →  keyId（API Key 绑定）
session:{sessionId}:last_seen →  timestamp（最后活跃时间）
session:{sessionId}:info      →  Hash（Session 元数据）
```

**并发计数**：

```
session:{sessionId}:concurrent_count →  当前并发请求数（TTL: 10 分钟）
session:{sessionId}:seq              →  请求序号计数器
```

### 自动清理机制

系统通过以下方式自动清理过期会话：

1. **ZREMRANGEBYSCORE**：清理 5 分钟前的过期会话
2. **EXISTS 验证**：批量验证 `session:${sessionId}:info` 是否存在
3. **TTL 刷新**：每次请求自动刷新 Session 及其绑定信息的 TTL

## 并发控制策略

### 会话级并发计数

每个 Session 维护独立的并发计数器：

```typescript
// 请求开始时增加计数
await SessionTracker.incrementConcurrentCount(sessionId);

// 请求结束时减少计数（在 finally 块中确保执行）
await SessionTracker.decrementConcurrentCount(sessionId);
```

### 供应商级并发限制

使用 Lua 脚本实现原子性检查 + 追踪：

```lua
-- 1. 清理过期 session
-- 2. 检查 session 是否已追踪
-- 3. 检查当前并发数是否超限
-- 4. 如果未超限，追踪新 session
```

**限制配置**：

每个供应商可配置 `limitConcurrentSessions`（0 表示无限制）：

```typescript
// src/lib/validation/schemas.ts
limitConcurrentSessions: z.coerce
  .number()
  .int("并发 Session 上限必须是整数")
  .min(0, "并发 Session 上限不能为负数")
  .max(1000, "并发 Session 上限不能超过 1000")
  .optional()
  .default(0),
```

## 监控面板

### 访问方式

在管理后台导航到"活跃会话"页面，即可查看实时监控数据。

### 面板功能

**会话列表**：

- 显示所有活跃会话的详细信息
- 支持按用户、供应商、API Key 筛选
- 实时刷新（默认 5 秒间隔）

**会话详情**：

- 点击会话可查看详细信息
- 查看会话内的消息内容（需权限）
- 查看请求历史列表

**终止操作**：

- 单个会话终止
- 批量会话终止（分块处理，每批 20 个）

### 权限控制

{% callout type="note" title="权限说明" %}
- **管理员**：可查看和终止所有会话
- **普通用户**：只能查看自己的会话，无法访问其他用户的数据
- **终止操作**：同样需要权限验证，并记录安全日志
{% /callout %}

## API 端点

### 获取活跃会话列表

```
POST /api/actions/active-sessions/getActiveSessions
```

返回当前所有活跃会话的摘要信息。

### 获取会话详情

```
POST /api/actions/active-sessions/getSessionDetails
Body: { sessionId: string, requestSequence?: number }
```

获取指定会话的详细信息。

### 获取会话消息内容

```
POST /api/actions/active-sessions/getSessionMessages
Body: { sessionId: string }
```

获取会话的消息内容（受权限控制）。

### 获取会话内请求列表

```
POST /api/actions/active-sessions/getSessionRequests
Body: { sessionId: string, page?: number, pageSize?: number, order?: "asc" | "desc" }
```

分页获取会话内的所有请求记录。

### 终止单个会话

```
POST /api/actions/active-sessions/terminateActiveSession
Body: { sessionId: string }
```

立即终止指定的活跃会话。

### 批量终止会话

```
POST /api/actions/active-sessions/terminateActiveSessionsBatch
Body: { sessionIds: string[] }
```

批量终止多个会话，采用分块处理避免并发过高。

### 获取所有会话（分页）

```
POST /api/actions/active-sessions/getAllSessions
Body: { activePage?: number, inactivePage?: number, pageSize?: number }
```

获取所有会话（包括活跃和非活跃），支持分别分页。

## 会话终止机制

### 单会话终止

终止会话时会删除所有相关的 Redis key：

```typescript
await SessionManager.terminateSession(sessionId);
```

**删除的 key 包括**：

- `session:${sessionId}:provider`
- `session:${sessionId}:key`
- `session:${sessionId}:info`
- `session:${sessionId}:concurrent_count`
- `session:${sessionId}:messages`
- `session:${sessionId}:response`
- 从所有 ZSET 中移除该 session

### 批量终止

采用分块处理策略，每批 20 个，避免并发过高：

```typescript
await SessionManager.terminateSessionsBatch(sessionIds);
```

### 终止后的影响

会话终止后：

1. 该 Session 的所有绑定信息被清除
2. 后续请求将重新进行供应商选择
3. 已建立的 prompt cache 可能失效
4. 正在进行的请求可能受到影响

{% callout type="warning" title="谨慎操作" %}
终止会话会中断正在进行的对话。建议在以下场景使用：
- 供应商故障需要强制重新路由
- 识别到异常流量需要立即阻断
- 用户请求删除其会话数据
{% /callout %}

## 配置选项

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SESSION_TTL` | 300 | Session TTL（秒），默认 5 分钟 |
| `SHORT_CONTEXT_THRESHOLD` | 2 | 短上下文阈值（消息数） |
| `ENABLE_SHORT_CONTEXT_DETECTION` | true | 是否启用短上下文并发检测 |
| `STORE_SESSION_MESSAGES` | false | 是否原样存储消息内容（false 则脱敏） |

### 数据库配置

**供应商并发限制**：

在供应商配置页面设置 `limitConcurrentSessions`：

- 0：无限制（默认）
- 1-1000：具体的并发上限

## 故障处理

### Redis 不可用降级

当 Redis 不可用时，系统采用 Fail Open 策略：

```typescript
if (!redis || redis.status !== "ready") {
  logger.trace("SessionTracker: Redis not ready, returning 0 for concurrent count");
  return 0; // Fail Open
}
```

**降级行为**：

- 生成新的 Session ID（不依赖 Redis）
- 并发计数返回 0
- 允许请求继续处理
- Session 绑定无法建立，每次请求可能选择不同供应商

### 并发绑定竞态条件

使用 Redis SET NX 原子操作避免并发绑定冲突：

```typescript
const result = await redis.set(
  key,
  providerId.toString(),
  "EX",
  SessionManager.SESSION_TTL,
  "NX" // Only set if not exists
);
```

### 类型冲突自动修复

当 Redis key 类型不匹配时（如旧版本使用 Set，新版本使用 ZSET）：

```typescript
if (err.message?.includes("WRONGTYPE")) {
  logger.warn("SessionTracker: Type conflict detected, auto-fixing");
  await SessionTracker.initialize(); // 删除旧数据
  return;
}
```

## 监控指标

### 实时指标

| 指标名 | 说明 | 数据来源 |
|--------|------|----------|
| 活跃会话数 | 当前正在进行的会话数量 | `global:active_sessions` ZSET |
| 并发请求数 | 正在处理的请求数量 | `session:${id}:concurrent_count` |
| 供应商负载 | 每个供应商的活跃会话数 | `provider:${id}:active_sessions` |
| 用户活跃度 | 每个用户的活跃会话数 | `user:${id}:active_sessions` |
| Key 活跃度 | 每个 Key 的活跃会话数 | `key:${id}:active_sessions` |

### 聚合指标

| 指标名 | 说明 | 计算方式 |
|--------|------|----------|
| 总 Token 数 | 会话的输入+输出+缓存 Token | 数据库聚合查询 |
| 总成本 | 会话产生的费用（USD） | 数据库聚合查询 |
| 请求次数 | 会话内的请求数量 | `session:${id}:seq` |
| 持续时间 | 从首次请求到最后一次请求的时间 | 数据库聚合查询 |
| 平均响应时间 | 所有请求的平均耗时 | 数据库聚合查询 |

## 性能优化

### 缓存策略

1. **活跃会话列表缓存**：2 秒 TTL，减少数据库查询
2. **会话详情缓存**：1 秒 TTL，平衡实时性和性能
3. **批量查询**：使用 `aggregateMultipleSessionStats` 避免 N+1 问题
4. **批量并发计数**：`getConcurrentCountBatch` 一次性获取多个会话的并发数

### 分页处理

`getAllSessions` 支持分页：

- 活跃和非活跃会话分别分页
- 每页默认 20 条，最大 200 条
- 使用数据库聚合查询确保数据一致性

## 安全考虑

### 权限验证

所有 Session 相关 API 都进行严格的权限验证：

1. **登录检查**：验证用户是否已登录
2. **角色检查**：区分管理员和普通用户
3. **所有权验证**：普通用户只能访问自己的 Session
4. **安全日志**：记录越权访问尝试

```typescript
if (!isAdmin && sessionStats.userId !== currentUserId) {
  logger.warn(
    `[Security] User ${currentUserId} attempted to access session ${sessionId} owned by user ${sessionStats.userId}`
  );
  return {
    ok: false,
    error: "无权访问该 Session",
  };
}
```

### 数据脱敏

消息内容存储受 `STORE_SESSION_MESSAGES` 环境变量控制：

- `false`（默认）：对 message 内容进行脱敏，显示为 `[REDACTED]`
- `true`：原样存储 message 内容

## 最佳实践

### 1. 监控关键指标

建议重点关注以下指标：

- **并发会话数突增**：可能表示流量异常或攻击
- **单个用户会话过多**：可能表示该用户的应用存在问题
- **供应商负载不均**：可能需要调整供应商权重或优先级

### 2. 合理配置 TTL

根据使用场景调整 `SESSION_TTL`：

- 长对话场景：保持默认 5 分钟
- 高频短任务：可适当缩短 TTL 以加快资源释放
- 低频使用场景：可适当延长 TTL 以提高缓存命中率

### 3. 谨慎终止会话

终止会话会产生以下影响：

- 中断正在进行的对话
- 导致 prompt cache 失效
- 增加后续请求的延迟（需要重新选择供应商）

建议在以下场景使用终止功能：

- 供应商故障需要强制重新路由
- 识别到异常流量需要立即阻断
- 用户明确请求删除其会话数据

### 4. 监控 Redis 状态

Session 功能依赖 Redis，建议：

- 监控 Redis 连接状态
- 设置 Redis 内存使用告警
- 定期清理过期数据

## 故障排查

### 会话数显示为 0

1. 检查 Redis 连接状态
2. 验证 `SESSION_TTL` 配置
3. 查看是否有活跃请求正在处理
4. 检查 Redis key 类型是否正确（应为 ZSET）

### 会话终止失败

1. 确认你有足够的权限
2. 检查 Redis 连接状态
3. 查看安全日志中的错误信息

### 并发计数不准确

1. 检查 Redis 是否可用
2. 验证 `session:${id}:concurrent_count` key 是否存在
3. 查看是否有请求异常退出（未执行 finally 块）

## 相关文档

- [会话管理](/docs/proxy/session-management) - Session 生命周期和绑定机制
- [仪表盘实时指标](/docs/monitoring/dashboard) - 系统整体监控
- [日志查询与筛选](/docs/monitoring/logs) - 查看会话内的请求详情
- [供应商管理](/docs/providers/crud) - 配置供应商并发限制
