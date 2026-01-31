# 活跃会话监控 (Active Sessions Monitoring) - Round 2 Review

## Intent Analysis

### 功能定位
活跃会话监控是 claude-code-hub 系统的核心运维功能，用于实时追踪和管理正在进行的 AI 对话会话。该功能服务于以下目标：

1. **实时监控**：管理员可以查看当前系统中所有活跃的会话状态，包括用户、密钥、供应商、模型、Token 使用量、成本等关键指标
2. **并发控制**：防止单个供应商或用户占用过多资源，通过 Redis ZSET 实现精确的并发计数
3. **故障排查**：追踪会话生命周期，诊断请求路由问题，查看会话内的消息内容和响应
4. **资源管理**：主动终止异常会话，释放供应商资源，强制后续请求重新路由

### 用户场景
- **管理员视角**：需要全局视图查看所有用户的活跃会话，识别异常流量模式，批量终止可疑会话
- **普通用户视角**：只能查看自己会话的状态和历史，无法访问其他用户的数据
- **运维场景**：当某个供应商出现故障时，终止绑定到该供应商的会话，强制后续请求重新路由到其他可用供应商

### 核心需求
1. 准确识别和追踪会话（Session Identification）
2. 实时统计并发数量（Concurrent Counting）
3. 管理会话生命周期（Lifecycle Management）
4. 收集和展示会话指标（Metrics Collection）
5. 支持会话终止操作（Session Termination）
6. 权限隔离（管理员 vs 普通用户）

---

## Behavior Summary

### 会话识别机制

系统通过多层降级策略识别会话：

**第一层：客户端传递 Session ID**
- Claude Code 客户端通过 `metadata.user_id` 传递，格式为 `"{user}_session_{sessionId}"`
- 备选方案：直接从 `metadata.session_id` 读取
- Codex 请求通过 headers 和 body 提取稳定的 session_id（使用 `extractCodexSessionId` 函数）

**第二层：确定性 Session ID 生成**
当客户端未提供 session_id 时，基于请求指纹生成：
- API Key 前缀（前10位）
- User-Agent
- 客户端 IP（x-forwarded-for / x-real-ip）

**第三层：内容哈希匹配（降级方案）**
计算 messages 前3条内容的 SHA-256 哈希，截取前16字符作为标识。此方案不可靠，仅作为最后手段，并在日志中输出警告（TC-047）。

### 短上下文并发检测

系统实现了智能的短上下文检测机制（方案E）：

```typescript
// 当消息长度 <= SHORT_CONTEXT_THRESHOLD（默认2）时触发检测
if (messagesLength <= SessionManager.SHORT_CONTEXT_THRESHOLD) {
  // 检查该 session 是否有其他请求正在运行
  const concurrentCount = await SessionTracker.getConcurrentCount(clientSessionId);
  
  if (concurrentCount > 0) {
    // 场景B：有并发请求 → 这是并发短任务 → 强制新建 session
    return SessionManager.generateSessionId();
  }
  // 场景A：无并发 → 这可能是长对话的开始 → 允许复用
}
```

### 会话追踪架构

采用 Redis Sorted Set (ZSET) 管理会话生命周期：

**数据结构**：
- `global:active_sessions` (ZSET): score = timestamp, member = sessionId
- `key:${keyId}:active_sessions` (ZSET): Key级别的活跃会话
- `provider:${providerId}:active_sessions` (ZSET): Provider级别的活跃会话
- `user:${userId}:active_sessions` (ZSET): 用户级别的活跃会话

**自动清理机制**：
- 5分钟无活动视为过期（SESSION_TTL = 300秒，由环境变量配置）
- ZREMRANGEBYSCORE 清理过期会话
- 批量 EXISTS 验证 session:${sessionId}:info 是否存在

### 并发控制策略

**会话级并发计数**：
```typescript
// 请求开始时增加计数
await SessionTracker.incrementConcurrentCount(sessionId);

// 请求结束时减少计数（在 finally 块中）
await SessionTracker.decrementConcurrentCount(sessionId);
```

**供应商级并发限制**：
使用 Lua 脚本实现原子性检查 + 追踪：
```lua
-- 1. 清理过期 session
-- 2. 检查 session 是否已追踪
-- 3. 检查当前并发数是否超限
-- 4. 如果未超限，追踪新 session
```

**限制配置**：
- 每个供应商可配置 `limitConcurrentSessions`（0表示无限制）
- 支持批量检查多个供应商的并发限制（BATCH_CHECK_SESSION_LIMITS）

### 会话生命周期

```
[请求开始]
    ↓
[SessionGuard 分配 Session ID]
    ↓
[存储 Session Info 到 Redis]
    ↓
[添加到活跃会话集合]
    ↓
[选择 Provider]
    ↓
[原子性并发检查 (Lua Script)]
    ↓
[请求处理中...]
    ↓
[响应完成]
    ↓
[更新 Session Usage]
    ↓
[刷新 TTL（滑动窗口）]
    ↓
[5分钟后无活动]
    ↓
[自动过期清理]
```

### 会话终止机制

**单会话终止**：
```typescript
await SessionManager.terminateSession(sessionId);
```
删除所有相关 Redis key：
- session:${sessionId}:provider
- session:${sessionId}:key
- session:${sessionId}:info
- session:${sessionId}:concurrent_count
- session:${sessionId}:messages
- session:${sessionId}:response
- 从所有 ZSET 中移除

**批量终止**：
采用分块处理策略，每批20个，避免并发过高：
```typescript
await SessionManager.terminateSessionsBatch(sessionIds);
```

---

## Config/Commands

### 环境变量配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| SESSION_TTL | 300 | Session TTL（秒），默认5分钟 |
| SHORT_CONTEXT_THRESHOLD | 2 | 短上下文阈值（消息数） |
| ENABLE_SHORT_CONTEXT_DETECTION | true | 是否启用短上下文并发检测 |
| STORE_SESSION_MESSAGES | false | 是否原样存储消息内容（false则脱敏） |

### 数据库配置

**供应商并发限制配置**：
```typescript
// src/lib/validation/schemas.ts
limitConcurrentSessions: z.coerce
  .number()
  .int("并发Session上限必须是整数")
  .min(0, "并发Session上限不能为负数")
  .max(1000, "并发Session上限不能超过1000")
  .optional()
  .default(0),
```

### API 端点

**获取活跃 Session 列表**：
```
POST /api/actions/active-sessions/getActiveSessions
```

**获取 Session 详情**：
```
POST /api/actions/active-sessions/getSessionDetails
Body: { sessionId: string, requestSequence?: number }
```

**获取 Session 消息内容**：
```
POST /api/actions/active-sessions/getSessionMessages
Body: { sessionId: string }
```

**终止活跃 Session**：
```
POST /api/actions/active-sessions/terminateActiveSession
Body: { sessionId: string }
```

**批量终止 Session**：
```
POST /api/actions/active-sessions/terminateActiveSessionsBatch
Body: { sessionIds: string[] }
```

**获取所有 Session（分页）**：
```
POST /api/actions/active-sessions/getAllSessions
Body: { activePage?: number, inactivePage?: number, pageSize?: number }
```

**获取 Session 内请求列表**：
```
POST /api/actions/active-sessions/getSessionRequests
Body: { sessionId: string, page?: number, pageSize?: number, order?: "asc" | "desc" }
```

**检查 Session 是否有消息**：
```
POST /api/actions/active-sessions/hasSessionMessages
Body: { sessionId: string, requestSequence?: number }
```

---

## Edge Cases

### 1. Redis 不可用降级

当 Redis 不可用时，系统采用 Fail Open 策略：
- 生成新的 Session ID（不依赖 Redis）
- 并发计数返回 0
- 允许请求继续处理

```typescript
// src/lib/session-tracker.ts
if (!redis || redis.status !== "ready") {
  logger.trace("SessionTracker: Redis not ready, returning 0 for concurrent count");
  return 0; // Fail Open
}
```

### 2. 并发绑定竞态条件

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

### 3. 类型冲突自动修复

当 Redis key 类型不匹配时（如旧版本使用 Set，新版本使用 ZSET）：
```typescript
if (err.message?.includes("WRONGTYPE")) {
  logger.warn("SessionTracker: Type conflict detected, auto-fixing");
  await SessionTracker.initialize(); // 删除旧数据
  return;
}
```

### 4. 短上下文并发误判

场景：用户快速发送多条独立短消息
- 系统通过并发计数检测区分"长对话开始"和"并发短任务"
- 如果是并发短任务，强制新建 Session，避免相互干扰

### 5. 会话复用与限额检查

会话复用必须遵守限额，否则会绕过"达到限额即禁用"的语义：
```typescript
const costCheck = await RateLimitService.checkCostLimitsWithLease(provider.id, "provider", {
  limit_5h_usd: provider.limit5hUsd,
  limit_daily_usd: provider.limitDailyUsd,
  // ...
});

if (!costCheck.allowed) {
  return null; // 拒绝复用
}
```

### 6. Warmup 请求处理

Anthropic Warmup 请求不应计入并发会话：
```typescript
if (!warmupMaybeIntercepted) {
  void SessionTracker.trackSession(sessionId, keyId, session.authState?.user?.id);
}
```

### 7. Codex Session 特殊处理

Codex 使用 `prompt_cache_key` 作为 Session ID 来源：
```typescript
const codexSessionId = `codex_${promptCacheKey}`;
```

### 8. 权限隔离

- 管理员可查看所有 Session
- 普通用户只能查看自己的 Session
- 终止操作同样需要权限验证
- 每次 API 调用都进行权限检查并记录安全日志

### 9. 请求序号冲突

当 Redis 不可用时，使用改进的 fallback 策略：
```typescript
const fallbackSeq = (Date.now() % 1000000) + Math.floor(Math.random() * 1000);
```

### 10. 会话绑定信息 TTL 不一致

修复：每次 refreshSession 时同步刷新绑定信息 TTL：
```typescript
pipeline.expire(`session:${sessionId}:provider`, 300); // 5 分钟（秒）
pipeline.expire(`session:${sessionId}:key`, 300);
pipeline.setex(`session:${sessionId}:last_seen`, 300, now.toString());
```

---

## References

### 核心文件

**1. Session 管理器**
- 路径：`/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts`
- 功能：Session 创建、绑定、终止、信息存储
- 关键方法：
  - `getOrCreateSessionId()` - 获取或创建 Session ID
  - `bindSessionToProvider()` - 绑定到供应商（使用 SET NX）
  - `terminateSession()` - 终止会话
  - `terminateSessionsBatch()` - 批量终止会话
  - `storeSessionInfo()` - 存储会话信息
  - `updateSessionUsage()` - 更新使用量
  - `getNextRequestSequence()` - 获取请求序号（原子递增）
  - `updateSessionWithCodexCacheKey()` - Codex session 特殊处理

**2. Session 追踪器**
- 路径：`/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts`
- 功能：活跃会话集合管理、并发计数
- 关键方法：
  - `trackSession()` - 追踪会话（添加到 ZSET）
  - `updateProvider()` - 更新供应商信息
  - `refreshSession()` - 刷新会话时间戳和 TTL
  - `getGlobalSessionCount()` - 获取全局会话数
  - `getActiveSessions()` - 获取活跃会话列表
  - `incrementConcurrentCount()` - 增加并发计数
  - `decrementConcurrentCount()` - 减少并发计数
  - `getConcurrentCountBatch()` - 批量获取并发计数
  - `initialize()` - 初始化（清理旧格式数据）

**3. Session Guard**
- 路径：`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session-guard.ts`
- 功能：请求开始时分配 Session ID
- 关键逻辑：
  - 提取客户端 Session ID
  - Codex Session ID 补全
  - 调用 SessionManager 获取/创建 Session
  - 追踪会话到活跃集合
  - 存储 Session 详细信息（带重试机制）

**4. 类型定义**
- 路径：`/Users/ding/Github/claude-code-hub/src/types/session.ts`
- 定义：
```typescript
export interface ActiveSessionInfo {
  sessionId: string;
  userName: string;
  userId: number;
  keyId: number;
  keyName: string;
  providerId: number | null;
  providerName: string | null;
  model: string | null;
  apiType: "chat" | "codex";
  startTime: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens?: number;
  costUsd?: string;
  status: "in_progress" | "completed" | "error";
  statusCode?: number;
  errorMessage?: string;
  durationMs?: number;
  requestCount?: number;
  concurrentCount?: number;
}
```

**5. Lua 脚本**
- 路径：`/Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts`
- 功能：原子性并发检查
- 关键脚本：
  - `CHECK_AND_TRACK_SESSION` - 检查并追踪供应商会话
  - `BATCH_CHECK_SESSION_LIMITS` - 批量检查多个供应商

**6. 限流服务**
- 路径：`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`
- 功能：供应商级并发限制检查
- 关键方法：
```typescript
static async checkAndTrackProviderSession(
  providerId: number,
  sessionId: string,
  limit: number
): Promise<{ allowed: boolean; count: number; tracked: boolean; reason?: string }>
```

**7. 供应商选择器**
- 路径：`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`
- 功能：在供应商选择时进行并发检查
- 关键逻辑：
```typescript
const checkResult = await RateLimitService.checkAndTrackProviderSession(
  session.provider.id,
  session.sessionId,
  limit
);

if (!checkResult.allowed) {
  // 并发限制失败，尝试故障转移
}
```

**8. 活跃会话 Action**
- 路径：`/Users/ding/Github/claude-code-hub/src/actions/active-sessions.ts`
- 功能：提供获取和终止 Session 的 Server Actions
- 关键方法：
  - `getActiveSessions()` - 获取活跃会话列表（带缓存）
  - `getAllSessions()` - 获取所有会话（分页，活跃/非活跃分离）
  - `getSessionDetails()` - 获取会话详情
  - `getSessionMessages()` - 获取消息内容
  - `getSessionRequests()` - 获取会话内请求列表
  - `hasSessionMessages()` - 检查是否有消息
  - `terminateActiveSession()` - 终止单个会话
  - `terminateActiveSessionsBatch()` - 批量终止会话

**9. Session 统计**
- 路径：`/Users/ding/Github/claude-code-hub/src/lib/redis/session-stats.ts`
- 功能：获取当前活跃并发会话数量
```typescript
export async function getActiveConcurrentSessions(): Promise<number> {
  return await SessionTracker.getGlobalSessionCount();
}
```

**10. Session 缓存**
- 路径：`/Users/ding/Github/claude-code-hub/src/lib/cache/session-cache.ts`
- 功能：缓存活跃会话数据
- 缓存策略：
  - 活跃 Session 列表：2秒 TTL
  - Session 详情：1秒 TTL

**11. 前端组件**
- 路径：`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/sessions/`
- 组件：
  - `ActiveSessionsClient` - 活跃会话监控页面
  - `ActiveSessionsTable` - 会话列表表格
  - `SessionMessagesClient` - 会话消息详情页
- 路径：`/Users/ding/Github/claude-code-hub/src/components/customs/`
- 组件：
  - `ActiveSessionsList` - 活跃会话列表（概览面板）
  - `ActiveSessionsCards` - 会话卡片视图
  - `ConcurrentSessionsCard` - 并发数卡片
  - `SessionListItem` - 会话列表项
  - `SessionCard` - 会话卡片

### 代码片段

**Session ID 生成**：
```typescript
// /Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:171-175
static generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(6).toString("hex");
  return `sess_${timestamp}_${random}`;
}
```

**并发计数增加**：
```typescript
// /Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts:561-574
static async incrementConcurrentCount(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return;

  try {
    const key = `session:${sessionId}:concurrent_count`;
    await redis.incr(key);
    await redis.expire(key, 600); // 10 分钟 TTL

    logger.trace("SessionTracker: Incremented concurrent count", { sessionId });
  } catch (error) {
    logger.error("SessionTracker: Failed to increment concurrent count", { error, sessionId });
  }
}
```

**原子性并发检查 Lua 脚本**：
```lua
-- /Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts:26-60
local provider_key = KEYS[1]
local session_id = ARGV[1]
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = 300000  -- 5 分钟（毫秒）

-- 1. 清理过期 session
local five_minutes_ago = now - ttl
redis.call('ZREMRANGEBYSCORE', provider_key, '-inf', five_minutes_ago)

-- 2. 检查 session 是否已追踪
local is_tracked = redis.call('ZSCORE', provider_key, session_id)

-- 3. 获取当前并发数
local current_count = redis.call('ZCARD', provider_key)

-- 4. 检查限制
if limit > 0 and not is_tracked and current_count >= limit then
  return {0, current_count, 0}
end

-- 5. 追踪 session
redis.call('ZADD', provider_key, now, session_id)
redis.call('EXPIRE', provider_key, 3600)

-- 6. 返回成功
if is_tracked then
  return {1, current_count, 0}
else
  return {1, current_count + 1, 1}
end
```

**Session 终止**：
```typescript
// /Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:1900-1987
static async terminateSession(sessionId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") {
    return false;
  }

  try {
    // 1. 查询绑定信息
    const [providerIdStr, keyIdStr] = await Promise.all([
      redis.get(`session:${sessionId}:provider`),
      redis.get(`session:${sessionId}:key`),
    ]);

    const providerId = providerIdStr ? parseInt(providerIdStr, 10) : null;
    const keyId = keyIdStr ? parseInt(keyIdStr, 10) : null;

    // 2. 删除所有 Session 相关的 key
    const pipeline = redis.pipeline();
    pipeline.del(`session:${sessionId}:provider`);
    pipeline.del(`session:${sessionId}:key`);
    pipeline.del(`session:${sessionId}:info`);
    pipeline.del(`session:${sessionId}:last_seen`);
    pipeline.del(`session:${sessionId}:concurrent_count`);
    pipeline.del(`session:${sessionId}:messages`);
    pipeline.del(`session:${sessionId}:response`);

    // 3. 从 ZSET 中移除
    pipeline.zrem("global:active_sessions", sessionId);
    if (providerId) {
      pipeline.zrem(`provider:${providerId}:active_sessions`, sessionId);
    }
    if (keyId) {
      pipeline.zrem(`key:${keyId}:active_sessions`, sessionId);
    }

    const results = await pipeline.exec();

    // 4. 检查结果
    let deletedKeys = 0;
    if (results) {
      for (const [err, result] of results) {
        if (!err && typeof result === "number" && result > 0) {
          deletedKeys += result;
        }
      }
    }

    return deletedKeys > 0;
  } catch (error) {
    return false;
  }
}
```

**请求开始时增加并发计数**：
```typescript
// /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy-handler.ts:62-65
// 9. 增加并发计数（在所有检查通过后，请求开始前）- 跳过 count_tokens
if (session.sessionId && !session.isCountTokensRequest()) {
  await SessionTracker.incrementConcurrentCount(session.sessionId);
}
```

**请求结束时减少并发计数**：
```typescript
// /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy-handler.ts:94-97
} finally {
  // 11. 减少并发计数（确保无论成功失败都执行）- 跳过 count_tokens
  if (session?.sessionId && !session.isCountTokensRequest()) {
    await SessionTracker.decrementConcurrentCount(session.sessionId);
  }
}
```

---

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

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Request                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ProxySessionGuard                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Extract Client Session ID                            │   │
│  │ 2. Codex Session ID Completion (if enabled)             │   │
│  │ 3. Get/Create Session ID                                │   │
│  │ 4. Set Request Sequence                                 │   │
│  │ 5. Store Request Body & Messages                        │   │
│  │ 6. Track Session (SessionTracker)                       │   │
│  │ 7. Store Session Info (Redis)                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Provider Selector                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Check Session Reuse                                  │   │
│  │ 2. Atomic Concurrent Check (Lua Script)                 │   │
│  │ 3. Track Provider Session (SessionTracker)              │   │
│  │ 4. Failover if Limit Exceeded                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Request Processing                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ incrementConcurrentCount()                              │   │
│  │                         ↓                               │   │
│  │              [Process Request...]                       │   │
│  │                         ↓                               │   │
│  │ decrementConcurrentCount() (finally)                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Response Handler                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Update Session Usage (Redis)                         │   │
│  │ 2. Refresh Session TTL (SessionTracker)                 │   │
│  │ 3. Update Provider (if success)                         │   │
│  │ 4. Store Response (Optional)                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 安全考虑

### 权限验证

所有 Session 相关 API 都进行严格的权限验证：

1. **登录检查**：验证用户是否已登录
2. **角色检查**：区分管理员和普通用户
3. **所有权验证**：普通用户只能访问自己的 Session
4. **安全日志**：记录越权访问尝试

```typescript
// 权限检查示例
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

---

## 性能优化

### 缓存策略

1. **活跃会话列表缓存**：2秒 TTL，减少数据库查询
2. **会话详情缓存**：1秒 TTL，平衡实时性和性能
3. **批量查询**：使用 `aggregateMultipleSessionStats` 避免 N+1 问题
4. **批量并发计数**：`getConcurrentCountBatch` 一次性获取多个会话的并发数

### 分页处理

`getAllSessions` 支持分页：
- 活跃和非活跃会话分别分页
- 每页默认20条，最大200条
- 使用数据库聚合查询确保数据一致性

---

## 总结

活跃会话监控系统是 claude-code-hub 的核心组件，通过 Redis ZSET 实现高效的会话生命周期管理，通过 Lua 脚本保证并发控制的原子性。系统支持多层降级策略，确保在 Redis 不可用等异常情况下仍能正常工作。权限隔离机制保证了数据安全，而缓存策略则优化了监控页面的查询性能。

关键设计决策：
1. 使用 ZSET 而非 Set，支持基于时间戳的自动过期
2. 短上下文并发检测，区分长对话和并发短任务
3. 延迟绑定策略，只在请求成功后绑定供应商
4. Fail Open 降级，优先保证可用性
5. 批量操作和分块处理，避免 Redis 压力过大
6. 双层缓存策略（列表2秒，详情1秒），平衡实时性和性能
7. 严格的权限验证和安全日志记录
