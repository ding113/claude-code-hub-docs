---
dimensions:
  type:
    primary: implementation
    detail: configuration
  level: intermediate
standard_title: Session 管理
language: zh
---

# Session 管理

Claude Code Hub 实现了一套完整的会话管理机制，确保长对话场景下请求被路由到同一供应商，避免上下文不一致问题。本文档详细介绍 Session 管理的核心原理和实现细节。

---

## 会话黏性原理

### 5 分钟 TTL (Time-To-Live)

Session 的核心设计是基于 **5 分钟滑动窗口** 的生命周期管理：

```typescript
private static readonly SESSION_TTL = parseInt(process.env.SESSION_TTL || "300"); // 5 分钟
```

**设计原理**：

- **滑动窗口**：每次请求都会刷新 Session 的 TTL，只要对话持续活跃，Session 就不会过期
- **自动过期**：5 分钟无活动后 Session 自动释放，避免资源浪费
- **可配置**：通过环境变量 `SESSION_TTL` 可自定义过期时间（单位：秒）

**TTL 刷新时机**：

1. 请求开始时（`SessionGuard.ensure()`）
2. 供应商选择成功后（`SessionTracker.updateProvider()`）
3. 响应完成时（`SessionTracker.refreshSession()`）

### 供应商绑定策略

Session 与供应商的绑定采用 **SET NX（原子操作）** 策略，确保并发安全：

```typescript
// 使用 SET ... NX 保证只有第一次绑定成功（原子操作）
const result = await redis.set(
  key,
  providerId.toString(),
  "EX",
  this.SESSION_TTL,
  "NX" // Only set if not exists
);
```

**绑定规则**：

| 场景 | 行为 | 原因 |
|------|------|------|
| 首次绑定 | 使用 SET NX 绑定 | 避免并发请求覆盖 |
| 故障转移成功 | 无条件更新绑定 | 减少缓存切换开销 |
| 新供应商优先级更高 | 迁移到新供应商 | 优先使用高优先级供应商 |
| 原供应商已熔断 | 更新到备用供应商 | 保证服务可用性 |
| 原供应商健康且优先级相同/更高 | 保持原绑定 | 尽量使用主供应商 |

### 缓存命中优化

Session 数据存储在 Redis 中，采用多级 Key 结构优化查询效率：

```
session:{sessionId}:provider   # 绑定的供应商 ID
session:{sessionId}:key        # 关联的 API Key ID
session:{sessionId}:info       # 详细信息（Hash 结构）
session:{sessionId}:usage      # 使用量统计（Hash 结构）
session:{sessionId}:last_seen  # 最后活跃时间戳
```

**缓存策略**：

- **热数据优先**：供应商绑定关系作为核心热数据，查询复杂度 O(1)
- **批量操作**：使用 Pipeline 批量读写，减少网络往返
- **懒加载**：详细信息仅在监控页面需要时加载

---

## Session ID 机制

### ID 生成算法

Session ID 采用 **时间戳 + 随机数** 的混合生成策略：

```typescript
static generateSessionId(): string {
  const timestamp = Date.now().toString(36);  // 时间戳转 36 进制
  const random = crypto.randomBytes(6).toString("hex");  // 6 字节随机数
  return `sess_${timestamp}_${random}`;
}
```

**格式示例**：`sess_lxyz123_a1b2c3d4e5f6`

**设计考量**：

- **唯一性**：时间戳 + 12 位随机数，碰撞概率极低
- **可读性**：`sess_` 前缀便于日志识别
- **紧凑性**：36 进制时间戳节省字符长度
- **不可预测**：随机数部分防止枚举攻击

### ID 传递方式

系统支持多种 Session ID 传递方式，按优先级排序：

**优先级 1：从 metadata.user_id 提取（Claude Code 主要方式）**

```typescript
// 格式: "user_identifier_session_actual_session_id"
const userId = metadataObj.user_id;
const sessionMarker = "_session_";
const markerIndex = userId.indexOf(sessionMarker);
if (markerIndex !== -1) {
  const extractedSessionId = userId.substring(markerIndex + sessionMarker.length);
  return extractedSessionId;
}
```

**优先级 2：从 metadata.session_id 直接读取**

```typescript
if (typeof metadataObj.session_id === "string") {
  return metadataObj.session_id;
}
```

**优先级 3：基于请求指纹生成确定性 ID**

```typescript
// 组合：API Key 前缀 + User-Agent + 客户端 IP
const parts = [userAgent, ip, apiKeyPrefix].filter(Boolean);
const hash = crypto.createHash("sha256").update(parts.join(":")).digest("hex");
return `sess_${hash.substring(0, 32)}`;
```

**优先级 4：基于消息内容哈希（降级方案）**

```typescript
// 计算前 3 条消息的 SHA-256 哈希
const combined = contents.join("|");
const hash = crypto.createHash("sha256").update(combined).digest("hex");
return hash.substring(0, 16);
```

### 客户端适配

| 客户端 | 传递方式 | 说明 |
|--------|----------|------|
| Claude Code | metadata.user_id | 格式：`{user}_session_{sessionId}` |
| Codex CLI | 请求指纹生成 | 基于 User-Agent + IP |
| Cursor IDE | metadata.session_id | 直接传递 |
| 自定义客户端 | 任意方式 | 推荐使用 metadata.session_id |

---

## 短上下文检测

### 检测阈值

系统实现了 **短上下文并发检测** 机制，解决并发短任务的供应商绑定冲突：

```typescript
private static readonly SHORT_CONTEXT_THRESHOLD = parseInt(
  process.env.SHORT_CONTEXT_THRESHOLD || "2"
);
private static readonly ENABLE_SHORT_CONTEXT_DETECTION =
  process.env.ENABLE_SHORT_CONTEXT_DETECTION !== "false";
```

**配置选项**：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `SHORT_CONTEXT_THRESHOLD` | 2 | 短上下文消息数阈值 |
| `ENABLE_SHORT_CONTEXT_DETECTION` | true | 是否启用检测 |

### 自动释放策略

当检测到 **短上下文 + 并发请求** 时，系统强制创建新 Session：

```typescript
if (this.ENABLE_SHORT_CONTEXT_DETECTION && messagesLength <= this.SHORT_CONTEXT_THRESHOLD) {
  const concurrentCount = await SessionTracker.getConcurrentCount(clientSessionId);

  if (concurrentCount > 0) {
    // 场景B：有并发请求 -> 这是并发短任务 -> 强制新建 session
    const newId = this.generateSessionId();
    return newId;
  }

  // 场景A：无并发 -> 这可能是长对话的开始 -> 允许复用
}
```

**场景分析**：

| 消息数 | 并发数 | 行为 | 原因 |
|--------|--------|------|------|
| <= 2 | > 0 | 新建 Session | 并发短任务需独立路由 |
| <= 2 | = 0 | 复用 Session | 可能是长对话开始 |
| > 2 | 任意 | 复用 Session | 已建立对话上下文 |

### 重新分配逻辑

并发计数通过 Redis 原子操作管理：

```typescript
// 请求开始时增加计数
static async incrementConcurrentCount(sessionId: string): Promise<void> {
  const key = `session:${sessionId}:concurrent_count`;
  await redis.incr(key);
  await redis.expire(key, 600); // 10 分钟 TTL
}

// 请求结束时减少计数
static async decrementConcurrentCount(sessionId: string): Promise<void> {
  const key = `session:${sessionId}:concurrent_count`;
  const newCount = await redis.decr(key);
  if (newCount <= 0) {
    await redis.del(key); // 清理无用 key
  }
}
```

---

## Redis 存储

### Session 数据结构

Session 信息采用 **Hash + String** 混合存储策略：

**基础绑定信息（String）**：

```
session:{sessionId}:provider  -> "123"          # 供应商 ID
session:{sessionId}:key       -> "456"          # API Key ID
session:{sessionId}:last_seen -> "1699012345678" # 最后活跃时间戳
```

**详细信息（Hash）**：

```
session:{sessionId}:info
  - userName: "alice"
  - userId: "1"
  - keyId: "456"
  - keyName: "production-key"
  - model: "claude-sonnet-4-20250514"
  - apiType: "chat"
  - startTime: "1699012345678"
  - status: "in_progress"
  - providerId: "123"
  - providerName: "anthropic-main"
```

**使用量统计（Hash）**：

```
session:{sessionId}:usage
  - status: "completed"
  - inputTokens: "1000"
  - outputTokens: "500"
  - cacheCreationInputTokens: "200"
  - cacheReadInputTokens: "100"
  - costUsd: "0.0123"
  - statusCode: "200"
```

### 过期清理

系统采用 **双重过期机制** 确保数据及时清理：

**1. Redis TTL 自动过期**：

```typescript
// 所有 session 相关 key 设置 5 分钟 TTL
pipeline.setex(key, this.SESSION_TTL, value);
```

**2. ZSET 时间戳清理**：

```typescript
// SessionTracker 使用 Sorted Set 管理活跃 session
// score = 时间戳，定期清理过期条目
await redis.zremrangebyscore(key, "-inf", fiveMinutesAgo);
```

**3. 集合级兜底 TTL**：

```typescript
// 全局集合设置 1 小时兜底 TTL
pipeline.expire("global:active_sessions", 3600);
```

### 并发安全

Session 操作的并发安全通过以下机制保证：

**1. 原子绑定操作**：

```typescript
// SET NX 保证只有首个请求成功绑定
await redis.set(key, value, "EX", ttl, "NX");
```

**2. Pipeline 批量操作**：

```typescript
// 多个操作打包执行，减少竞态窗口
const pipeline = redis.pipeline();
pipeline.zadd("global:active_sessions", now, sessionId);
pipeline.expire("global:active_sessions", 3600);
await pipeline.exec();
```

**3. 类型检查与自动修复**：

```typescript
// 检测到类型冲突时自动清理
if (err.message?.includes("WRONGTYPE")) {
  await this.initialize(); // 删除旧格式数据
}
```

**4. Fail-Open 降级策略**：

```typescript
// Redis 不可用时降级处理，不阻塞请求
if (!redis || redis.status !== "ready") {
  return this.generateSessionId(); // 生成新 session
}
```

---

## 最佳实践

### 环境变量配置

```bash
# Session 相关配置
SESSION_TTL=300                         # Session 过期时间（秒），默认 5 分钟
SHORT_CONTEXT_THRESHOLD=2               # 短上下文检测阈值
ENABLE_SHORT_CONTEXT_DETECTION=true     # 启用短上下文检测
STORE_SESSION_MESSAGES=false            # 是否存储消息内容（调试用）
```

### 客户端集成建议

1. **推荐传递 session_id**：通过 `metadata.session_id` 显式传递，避免依赖内容哈希
2. **保持会话连续**：在同一对话中使用相同的 session_id
3. **并发请求处理**：并行请求建议使用不同的 session_id

### 监控指标

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| 活跃 Session 数 | 当前正在使用的会话数量 | 根据服务器规模设定 |
| Session 复用率 | 复用已有 Session 的请求比例 | < 50% 需关注 |
| 平均 Session 时长 | 从创建到过期的平均时间 | 异常波动需关注 |
| 供应商切换次数 | 同一 Session 内切换供应商的次数 | > 2 次需调查原因 |

---

## 相关文档

- [智能路由](/docs/intelligent-routing) - 供应商选择与负载均衡
- [熔断器](/docs/circuit-breaker) - 故障隔离与自动恢复
- [限流配置](/docs/rate-limiting) - 请求频率控制
