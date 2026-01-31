---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 会话管理
language: zh
---

# 会话管理

会话管理是 Claude Code Hub 的核心功能之一，它确保来自同一会话的连续请求被路由到同一个 AI 供应商，从而最大化缓存命中率、降低成本，并提供一致的用户体验。

## 核心概念

### 什么是 Session

Session（会话）代表用户与 AI 之间的一段连续对话。在 Claude Code Hub 中，Session 具有以下特征：

- **唯一标识**：每个 Session 拥有唯一的 `session_id`
- **供应商绑定**：Session 会与首次成功响应的供应商建立绑定关系
- **5 分钟 TTL**：Session 默认存活 5 分钟，每次请求会刷新过期时间（滑动窗口）
- **并发追踪**：系统会追踪每个 Session 的并发请求数量

### Session 生命周期

```
请求到达
    ↓
SessionGuard.ensure()
    ↓
提取/生成 Session ID
    ↓
获取或创建 Session（带并发检查）
    ↓
追踪 Session（Redis ZSET）
    ↓
存储 Session 信息
    ↓
绑定到供应商（首次成功请求后）
    ↓
TTL 刷新（每次请求延长 5 分钟）
```

## Session 识别机制

系统通过多层策略识别 Session：

### 1. 客户端提供的 Session ID（优先）

Claude Code 等客户端会在请求中传递 Session 标识：

- **`metadata.user_id`**：格式为 `{user}_session_{sessionId}`，Claude Code 主要使用此方式
- **`metadata.session_id`**：直接传递 Session ID

### 2. Codex Session 提取

对于 OpenAI/Codex 请求，系统会从 headers 或 body 中提取稳定的 Session 标识。

### 3. 内容哈希降级方案

当客户端未提供 Session ID 时，系统会计算 messages 内容的 SHA-256 哈希作为降级方案：

{% callout type="warning" title="注意" %}
内容哈希方案存在局限性：不同会话如果开头内容相似可能产生相同哈希。因此强烈建议客户端主动传递 `metadata.session_id` 或 `metadata.user_id`。
{% /callout %}

### 4. 确定性 Session ID

基于请求指纹生成（API Key 前缀 + User-Agent + 客户端 IP），用于无客户端 Session 时的稳定绑定。

## 5 分钟 TTL 与会话绑定

### TTL 机制

Session TTL（Time To Live）默认为 **300 秒（5 分钟）**，通过环境变量配置：

```bash
SESSION_TTL=300  # 单位：秒
```

**滑动窗口刷新**：每次请求会刷新 Session 及其绑定信息的 TTL，确保活跃会话不会过期。

**TTL 设计考量**：

| 因素 | 说明 |
|------|------|
| **缓存效率** | 5 分钟足够覆盖多轮对话，充分利用供应商的 prompt caching |
| **资源清理** | 足够短以防止 Redis 内存泄漏 |
| **故障转移响应** | 允许在供应商故障时快速迁移 Session |

### 供应商绑定策略

Session 与供应商的绑定遵循以下规则：

1. **首次成功绑定**：使用 Redis `SET NX` 原子操作，确保只有第一个成功的请求能建立绑定
2. **后续请求复用**：同一会话的后续请求优先使用已绑定的供应商
3. **智能故障转移**：
   - 原供应商熔断时，自动切换到备用供应商并更新绑定
   - 新供应商优先级更高时，允许迁移以获得更好服务

```
Session A ──→ Provider X（首次成功，建立绑定）
    │
    ├──→ 5 分钟内再次请求 → 复用 Provider X
    │
    ├──→ Provider X 熔断 → 切换到 Provider Y → 更新绑定
    │
    └──→ 5 分钟无活动 → Session 过期 → 下次请求新建 Session
```

## 短上下文并发检测

为防止并发短任务污染缓存，系统实现了短上下文检测机制：

### 触发条件

- 消息数量 ≤ 2 条（`SHORT_CONTEXT_THRESHOLD`）
- 该 Session 已有其他并发请求正在处理

### 处理逻辑

```
场景 A：短上下文 + 无并发请求
   └─→ 允许复用 Session（可能是长对话的开始）

场景 B：短上下文 + 有并发请求
   └─→ 强制新建 Session（并发短任务，避免缓存污染）
```

### 配置

```bash
SHORT_CONTEXT_THRESHOLD=2              # 短上下文阈值（消息数）
ENABLE_SHORT_CONTEXT_DETECTION=true    # 启用检测（默认开启）
```

## Redis 数据结构

Session 数据存储在 Redis 中，主要 key 包括：

### Session 绑定信息

```
session:{sessionId}:provider  →  providerId（供应商绑定）
session:{sessionId}:key       →  keyId（API Key 绑定）
session:{sessionId}:last_seen →  timestamp（最后活跃时间）
session:{sessionId}:info      →  Hash（Session 元数据）
```

### 活跃 Session 集合（ZSET）

```
global:active_sessions              →  所有活跃 Session
key:{keyId}:active_sessions         →  按 API Key 分组
provider:{providerId}:active_sessions →  按供应商分组
user:{userId}:active_sessions       →  按用户分组
```

### 并发计数

```
session:{sessionId}:concurrent_count →  当前并发请求数（TTL: 10 分钟）
session:{sessionId}:seq              →  请求序号计数器
```

## 配置选项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `SESSION_TTL` | `300` | Session 过期时间（秒） |
| `STORE_SESSION_MESSAGES` | `false` | 是否存储消息内容（`true` 原样存储，`false` 脱敏存储） |
| `SHORT_CONTEXT_THRESHOLD` | `2` | 短上下文检测的消息数阈值 |
| `ENABLE_SHORT_CONTEXT_DETECTION` | `true` | 是否启用短上下文并发检测 |

## 故障处理

### Redis 不可用（Fail-Open）

所有 Redis 操作都实现了降级策略：

```typescript
const redis = getRedisClient();
if (!redis || redis.status !== "ready") {
  return; // 不阻塞请求，继续处理
}
```

当 Redis 不可用时：
- Session 绑定无法建立，每次请求可能选择不同供应商
- 限流检查降级，不限制请求
- 并发计数返回 0

### 并发绑定竞态条件

使用 Redis `SET ... NX` 确保原子性：

```typescript
const result = await redis.set(key, providerId, "EX", SESSION_TTL, "NX");
if (result !== "OK") {
  // 已被其他请求绑定，跳过
}
```

## 监控与调试

### 活跃 Session 列表

通过管理后台可查看当前活跃 Session：

- Session ID、用户、API Key
- 绑定的供应商
- 请求序号、Token 使用量
- 会话持续时间

### 决策链记录

每个 Session 会记录完整的供应商选择决策链，包括：

- 选择原因（Session 复用、初始选择、重试成功等）
- 供应商权重、优先级
- 熔断器状态
- 错误信息（如果失败）

决策链存储在 `message_request.provider_chain` 字段，可用于故障排查。

## 最佳实践

1. **客户端传递 Session ID**：在请求 `metadata` 中包含 `session_id` 或 `user_id`，确保会话连续性

2. **合理设置 TTL**：
   - 长对话场景：保持默认 5 分钟
   - 高频短任务：可适当缩短 TTL

3. **监控 Redis 状态**：Session 功能依赖 Redis，建议监控 Redis 连接状态

4. **理解缓存机制**：Session 绑定的主要目的是利用供应商的 prompt caching，降低 API 成本
