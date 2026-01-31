# 日志查询与筛选 (Log Query and Filtering)

## 1. 功能概述

Claude Code Hub 的日志系统提供了完整的 API 请求追踪、审计和分析能力。系统记录了每一次 API 调用的详细信息，包括请求元数据、Token 使用情况、成本计算、供应商链决策过程等，为运维监控、成本管理和故障排查提供数据支持。

### 1.1 核心能力

- **请求追踪与审计**: 完整记录每个 API 请求的完整生命周期
- **成本管理与计费**: 精确计算每次请求的成本（USD），支持供应商倍率
- **运营监控**: 实时监控错误率、重试模式、供应商性能
- **故障排查**: 详细的错误信息、堆栈追踪、供应商链决策记录
- **会话管理**: Session ID 追踪支持对话连续性分析

### 1.2 数据存储架构

日志数据存储在 PostgreSQL 的 `message_request` 表中，采用以下设计策略：

- **软删除模式**: 使用 `deletedAt` 时间戳实现软删除，支持数据恢复
- **时区处理**: 使用 `timestamptz` 类型存储 UTC 时间，前端自动转换本地时间
- **大数值支持**: Token 相关字段使用 `bigint` 类型，支持大流量场景

---

## 2. 数据库 Schema

### 2.1 message_request 表结构

```typescript
// src/drizzle/schema.ts (lines 369-457)
export const messageRequest = pgTable('message_request', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  model: varchar('model', { length: 128 }),
  durationMs: integer('duration_ms'),
  costUsd: numeric('cost_usd', { precision: 21, scale: 15 }).default('0'),
  
  // 供应商倍率（用于日志展示）
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }),
  
  // Session 追踪
  sessionId: varchar('session_id', { length: 64 }),
  requestSequence: integer('request_sequence').default(1),
  
  // 供应商决策链（JSONB 数组）
  providerChain: jsonb('provider_chain').$type<Array<{ id: number; name: string }>>(),
  
  // HTTP 状态码和 API 类型
  statusCode: integer('status_code'),
  apiType: varchar('api_type', { length: 20 }), // 'response' 或 'openai'
  
  // 请求端点和模型信息
  endpoint: varchar('endpoint', { length: 256 }),
  originalModel: varchar('original_model', { length: 128 }),
  
  // Token 使用统计（bigint 类型）
  inputTokens: bigint('input_tokens', { mode: 'number' }),
  outputTokens: bigint('output_tokens', { mode: 'number' }),
  ttfbMs: integer('ttfb_ms'), // Time To First Byte
  cacheCreationInputTokens: bigint('cache_creation_input_tokens', { mode: 'number' }),
  cacheReadInputTokens: bigint('cache_read_input_tokens', { mode: 'number' }),
  cacheCreation5mInputTokens: bigint('cache_creation_5m_input_tokens', { mode: 'number' }),
  cacheCreation1hInputTokens: bigint('cache_creation_1h_input_tokens', { mode: 'number' }),
  cacheTtlApplied: varchar('cache_ttl_applied', { length: 10 }),
  
  // 1M 上下文窗口标记
  context1mApplied: boolean('context_1m_applied').default(false),
  
  // 特殊设置（审计用）
  specialSettings: jsonb('special_settings').$type<SpecialSetting[]>(),
  
  // 错误信息
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  errorCause: text('error_cause'),
  
  // 拦截信息
  blockedBy: varchar('blocked_by', { length: 50 }),
  blockedReason: text('blocked_reason'),
  
  // 客户端信息
  userAgent: varchar('user_agent', { length: 512 }),
  messagesCount: integer('messages_count'),
  
  // 时间戳
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}
```

### 2.2 索引策略

```typescript
// 优化统计查询的复合索引（用户+时间+费用）
messageRequestUserDateCostIdx: index('idx_message_request_user_date_cost')
  .on(table.userId, table.createdAt, table.costUsd)
  .where(sql`${table.deletedAt} IS NULL`),

// 优化用户查询的复合索引（按创建时间倒序）
messageRequestUserQueryIdx: index('idx_message_request_user_query')
  .on(table.userId, table.createdAt)
  .where(sql`${table.deletedAt} IS NULL`),

// Session 查询索引
messageRequestSessionIdIdx: index('idx_message_request_session_id')
  .on(table.sessionId)
  .where(sql`${table.deletedAt} IS NULL`),

// Session ID 前缀查询索引（支持 LIKE 'prefix%'）
messageRequestSessionIdPrefixIdx: index('idx_message_request_session_id_prefix')
  .on(sql`${table.sessionId} varchar_pattern_ops`)
  .where(sql`${table.deletedAt} IS NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`),

// Session + Sequence 复合索引
messageRequestSessionSeqIdx: index('idx_message_request_session_seq')
  .on(table.sessionId, table.requestSequence)
  .where(sql`${table.deletedAt} IS NULL`),

// Endpoint 过滤查询索引
messageRequestEndpointIdx: index('idx_message_request_endpoint')
  .on(table.endpoint)
  .where(sql`${table.deletedAt} IS NULL`),

// blocked_by 过滤查询索引（排除 warmup/sensitive 等拦截请求）
messageRequestBlockedByIdx: index('idx_message_request_blocked_by')
  .on(table.blockedBy)
  .where(sql`${table.deletedAt} IS NULL`),
```

---

## 3. 日志写入模式

### 3.1 异步模式（默认）

通过 `MESSAGE_REQUEST_WRITE_MODE` 环境变量配置，默认为 `async`：

```typescript
// src/repository/message-write-buffer.ts
class MessageRequestWriteBuffer {
  private readonly pending = new Map<number, MessageRequestUpdatePatch>();
  
  enqueue(id: number, patch: MessageRequestUpdatePatch): void {
    // 合并同一 ID 的多次更新
    const existing = this.pending.get(id) ?? {};
    const merged = { ...existing, ...patch };
    this.pending.set(id, merged);
    
    // 队列上限保护：超过 maxPending 时优先丢弃非终态更新
    if (this.pending.size > this.config.maxPending) {
      // 优先丢弃没有 durationMs 的条目（非终态）
      for (const [candidateId, candidatePatch] of this.pending) {
        if (candidatePatch.durationMs === undefined) {
          this.pending.delete(candidateId);
          break;
        }
      }
    }
  }
  
  async flush(): Promise<void> {
    // 批量构建 CASE WHEN 更新 SQL
    // 使用 CTE 实现高效批量更新
  }
}
```

**配置参数**（`src/lib/config/env.schema.ts` lines 55-80）：

| 环境变量 | 默认值 | 说明 | 范围 |
|---------|--------|------|------|
| `MESSAGE_REQUEST_WRITE_MODE` | `async` | 写入模式: `sync` 或 `async` | - |
| `MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS` | `250` | 异步刷新间隔（毫秒） | 10 - 60000 |
| `MESSAGE_REQUEST_ASYNC_BATCH_SIZE` | `200` | 批量写入大小 | 1 - 2000 |
| `MESSAGE_REQUEST_ASYNC_MAX_PENDING` | `5000` | 最大待处理队列长度 | 100 - 200000 |

### 3.2 同步模式

当设置为 `sync` 模式时，所有更新立即同步写入数据库：

```typescript
// src/repository/message.ts
export async function updateMessageRequestDuration(id: number, durationMs: number): Promise<void> {
  if (getEnvConfig().MESSAGE_REQUEST_WRITE_MODE === "async") {
    enqueueMessageRequestUpdate(id, { durationMs });
    return;
  }
  
  // 同步模式：直接更新数据库
  await db.update(messageRequest).set({ durationMs, updatedAt: new Date() })
    .where(eq(messageRequest.id, id));
}
```

**模式对比**：

| 特性 | 异步模式 (async) | 同步模式 (sync) |
|-----|-----------------|----------------|
| 写入延迟 | 有（最大 250ms） | 无 |
| 数据库压力 | 低（批量写入） | 高（单条写入） |
| 数据一致性 | 最终一致性 | 强一致性 |
| 适用场景 | 生产环境高并发 | 开发调试 |

---

## 4. 日志查询 API

### 4.1 Server Actions

```typescript
// src/actions/usage-logs.ts

// 获取使用日志（带分页和统计）
export async function getUsageLogs(
  filters: Omit<UsageLogFilters, "userId">
): Promise<ActionResult<UsageLogsResult>>

// 游标分页查询（优化大数据集性能）
export async function getUsageLogsBatch(
  filters: UsageLogBatchFilters
): Promise<ActionResult<UsageLogsBatchResult>>

// 独立获取聚合统计（按需加载）
export async function getUsageLogsStats(
  filters: Omit<UsageLogFilters, "page" | "pageSize">
): Promise<ActionResult<UsageLogSummary>>

// 导出 CSV
export async function exportUsageLogs(
  filters: Omit<UsageLogFilters, "userId" | "page" | "pageSize">
): Promise<ActionResult<string>>

// 获取筛选器选项（模型、状态码、端点）
export async function getFilterOptions(): Promise<...>

// Session ID 自动补全建议
export async function getSessionIdSuggestions(
  term: string, filters?: { userId?: number; keyId?: number; providerId?: number }
): Promise<ActionResult<string[]>>
```

### 4.2 查询过滤器

```typescript
// src/repository/usage-logs.ts
export interface UsageLogFilters {
  userId?: number;                    // 用户 ID（admin 可筛选任意用户）
  keyId?: number;                     // API Key ID
  providerId?: number;                // 供应商 ID（admin 可用）
  sessionId?: string;                 // Session ID（精确匹配）
  startTime?: number;                 // 开始时间戳（毫秒）
  endTime?: number;                   // 结束时间戳（毫秒）
  statusCode?: number;                // HTTP 状态码（精确匹配）
  excludeStatusCode200?: boolean;     // 排除 200 状态码（查看错误）
  model?: string;                     // 模型名称（精确匹配）
  endpoint?: string;                  // 端点路径（精确匹配）
  minRetryCount?: number;             // 最小重试次数
  page?: number;                      // 页码（从 1 开始）
  pageSize?: number;                  // 每页大小
}
```

### 4.3 分页策略

#### 偏移分页（Offset Pagination）

适用于需要总页数和跳转的场景：

```typescript
// src/repository/usage-logs.ts:333-528
export async function findUsageLogsWithDetails(filters: UsageLogFilters): Promise<UsageLogsResult> {
  const { page = 1, pageSize = 50 } = filters;
  const offset = (page - 1) * pageSize;
  
  // 同时查询总数和统计数据
  const [summaryResult] = await db.select({
    totalRows: sql<number>`count(*)::double precision`,
    totalRequests: sql<number>`count(*) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision`,
    totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION}), 0)`,
    // ... 其他统计字段
  }).from(messageRequest).where(...);
  
  // 查询分页数据
  const results = await db.select({...})
    .from(messageRequest)
    .orderBy(desc(messageRequest.createdAt))
    .limit(pageSize)
    .offset(offset);
    
  return { logs, total, summary };
}
```

#### 游标分页（Cursor Pagination）

适用于无限滚动和大数据集：

```typescript
// src/repository/usage-logs.ts:114-282
export async function findUsageLogsBatch(filters: UsageLogBatchFilters): Promise<UsageLogsBatchResult> {
  const { cursor, limit = 50 } = filters;
  
  // 游标条件：(created_at, id) < (cursor_created_at, cursor_id)
  if (cursor) {
    conditions.push(
      sql`(${messageRequest.createdAt}, ${messageRequest.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`
    );
  }
  
  // 查询 limit + 1 条判断是否还有更多
  const fetchLimit = limit + 1;
  const results = await db.select({...})
    .orderBy(desc(messageRequest.createdAt), desc(messageRequest.id))
    .limit(fetchLimit);
    
  const hasMore = results.length > limit;
  const nextCursor = hasMore ? { createdAt: lastLog.createdAtRaw, id: lastLog.id } : null;
  
  return { logs, nextCursor, hasMore };
}
```

---

## 5. 权限控制

### 5.1 角色权限矩阵

| 功能 | Admin | 普通用户 | 只读 Key |
|-----|-------|---------|---------|
| 查看所有用户日志 | ✓ | ✗ | ✗ |
| 查看指定用户日志 | ✓ | 仅自己 | 仅自己 |
| 按供应商筛选 | ✓ | ✗ | ✗ |
| 导出日志 | ✓ | 仅自己 | 仅自己 |
| 查看统计面板 | ✓ | 仅自己 | 仅自己 |

### 5.2 权限实现

```typescript
// src/actions/usage-logs.ts:42-63
export async function getUsageLogs(filters: Omit<UsageLogFilters, "userId">): Promise<...> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "未登录" };
  }
  
  // 如果不是 admin，强制过滤为当前用户
  const finalFilters: UsageLogFilters =
    session.user.role === "admin" ? filters : { ...filters, userId: session.user.id };
    
  const result = await findUsageLogsWithDetails(finalFilters);
  return { ok: true, data: result };
}
```

---

## 6. Warmup 请求排除

Warmup 请求（用于供应商健康检查）不计入任何统计和限额计算：

```typescript
// src/repository/_shared/message-request-conditions.ts
export const EXCLUDE_WARMUP_CONDITION = 
  sql`(${messageRequest.blockedBy} IS NULL OR ${messageRequest.blockedBy} <> 'warmup')`;
```

在统计查询中使用：

```typescript
// src/repository/usage-logs.ts:413-420
const [summaryResult] = await db.select({
  // total：用于分页/审计，必须包含 warmup
  totalRows: sql<number>`count(*)::double precision`,
  // summary：所有统计字段必须排除 warmup
  totalRequests: sql<number>`count(*) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision`,
  totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION}), 0)`,
  // ...
});
```

---

## 7. 日志清理

### 7.1 自动清理

通过系统设置配置自动清理任务：

```typescript
// src/lib/log-cleanup/cleanup-queue.ts
export async function scheduleAutoCleanup() {
  const settings = await getSystemSettings();
  
  if (!settings.enableAutoCleanup) {
    // 移除所有已存在的定时任务
    return;
  }
  
  const retentionDays = settings.cleanupRetentionDays ?? 30;
  const beforeDate = new Date();
  beforeDate.setDate(beforeDate.getDate() - retentionDays);
  
  // 添加定时任务（默认每天凌晨 2 点）
  await queue.add("auto-cleanup", {
    conditions: { beforeDate },
    batchSize: settings.cleanupBatchSize ?? 10000,
  }, {
    repeat: { cron: settings.cleanupSchedule ?? "0 2 * * *" }
  });
}
```

**系统设置参数**：

| 设置项 | 默认值 | 说明 |
|-------|--------|------|
| `enableAutoCleanup` | `false` | 是否启用自动清理 |
| `cleanupRetentionDays` | `30` | 日志保留天数 |
| `cleanupSchedule` | `"0 2 * * *"` | Cron 表达式（默认每天 2 AM） |
| `cleanupBatchSize` | `10000` | 每批删除记录数 |

### 7.2 手动清理 API

```typescript
// src/app/api/admin/log-cleanup/manual/route.ts
export async function POST(request: NextRequest) {
  // 验证管理员权限
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const body = await request.json();
  const conditions: CleanupConditions = {
    beforeDate: validated.beforeDate ? new Date(validated.beforeDate) : undefined,
    afterDate: validated.afterDate ? new Date(validated.afterDate) : undefined,
    userIds: validated.userIds,
    providerIds: validated.providerIds,
    statusCodes: validated.statusCodes,
    statusCodeRange: validated.statusCodeRange,
    onlyBlocked: validated.onlyBlocked,
  };
  
  const result = await cleanupLogs(conditions, { dryRun: validated.dryRun }, { type: "manual" });
  return Response.json({ success: !result.error, ...result });
}
```

**清理条件**：

| 条件 | 类型 | 说明 |
|-----|------|------|
| `beforeDate` | Date | 删除此日期之前的日志 |
| `afterDate` | Date | 删除此日期之后的日志 |
| `userIds` | number[] | 仅删除指定用户的日志 |
| `providerIds` | number[] | 仅删除指定供应商的日志 |
| `statusCodes` | number[] | 仅删除指定状态码的日志 |
| `statusCodeRange` | {min, max} | 状态码范围（如 400-499） |
| `onlyBlocked` | boolean | 仅删除被拦截的请求 |
| `dryRun` | boolean | 仅预览，不实际删除 |

### 7.3 批量删除实现

使用 CTE（Common Table Expression）实现安全批量删除：

```typescript
// src/lib/log-cleanup/service.ts:218-235
async function deleteBatch(whereConditions: SQL[], batchSize: number): Promise<number> {
  const result = await db.execute(sql`
    WITH ids_to_delete AS (
      SELECT id FROM message_request
      WHERE ${and(...whereConditions)}
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM message_request
    WHERE id IN (SELECT id FROM ids_to_delete)
  `);
  return (result as any).rowCount || 0;
}
```

**安全特性**：
- `FOR UPDATE SKIP LOCKED`: 跳过已锁定行，避免锁竞争
- 批量删除后休眠 100ms，避免长时间锁表
- 支持 `dryRun` 模式预览影响范围

---

## 8. 端点探测日志清理

独立的端点探测日志清理机制：

```typescript
// src/lib/provider-endpoints/probe-log-cleanup.ts
const RETENTION_DAYS = parseIntWithDefault(
  process.env.ENDPOINT_PROBE_LOG_RETENTION_DAYS, 
  1  // 默认保留 1 天
);

const CLEANUP_BATCH_SIZE = parseIntWithDefault(
  process.env.ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE,
  10_000
);

// 每 5 分钟执行一次清理
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
```

**环境变量**：

| 变量 | 默认值 | 说明 |
|-----|--------|------|
| `ENDPOINT_PROBE_LOG_RETENTION_DAYS` | `1` | 探测日志保留天数 |
| `ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE` | `10000` | 清理批次大小 |

---

## 9. 日志级别管理

### 9.1 动态日志级别

支持运行时调整日志级别，无需重启服务：

```typescript
// src/lib/logger.ts:193-196
export function setLogLevel(newLevel: LogLevel): void {
  logger.level = newLevel;
  logger.info(`日志级别已调整为: ${newLevel}`);
}
```

**有效级别**（从低到高）：`trace` < `debug` < `info` < `warn` < `error` < `fatal`

### 9.2 日志级别 API

```typescript
// src/app/api/admin/log-level/route.ts

// GET /api/admin/log-level - 获取当前日志级别
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ level: getLogLevel() });
}

// POST /api/admin/log-level - 设置日志级别
export async function POST(req: Request) {
  const { level } = await req.json();
  const validLevels: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];
  
  if (!validLevels.includes(level)) {
    return Response.json({ error: "无效的日志级别", validLevels }, { status: 400 });
  }
  
  setLogLevel(level);
  return Response.json({ success: true, level });
}
```

### 9.3 环境变量配置

```typescript
// src/lib/config/env.schema.ts:102
LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
```

---

## 10. Session ID 搜索

### 10.1 自动补全实现

```typescript
// src/repository/usage-logs.ts:577-625
export async function findUsageLogSessionIdSuggestions(filters: UsageLogSessionIdSuggestionFilters): Promise<string[]> {
  const { term, userId, keyId, providerId } = filters;
  const limit = Math.min(50, Math.max(1, filters.limit ?? 20));
  const trimmedTerm = term.trim();
  if (!trimmedTerm) return [];
  
  // 使用 LIKE 前缀匹配，配合 ESCAPE 防止注入
  const pattern = `${escapeLike(trimmedTerm)}%`;
  const conditions = [
    isNull(messageRequest.deletedAt),
    EXCLUDE_WARMUP_CONDITION,
    sql`${messageRequest.sessionId} IS NOT NULL`,
    sql`length(${messageRequest.sessionId}) > 0`,
    sql`${messageRequest.sessionId} LIKE ${pattern} ESCAPE '\\'`,
  ];
  
  const results = await db
    .select({
      sessionId: messageRequest.sessionId,
      firstSeen: sql<Date>`min(${messageRequest.createdAt})`,
    })
    .from(messageRequest)
    .where(and(...conditions))
    .groupBy(messageRequest.sessionId)
    .orderBy(desc(sql`min(${messageRequest.createdAt})`))
    .limit(limit);
    
  return results.map((r) => r.sessionId).filter(Boolean);
}
```

### 10.2 LIKE 转义

```typescript
// src/repository/_shared/like.ts
export function escapeLike(value: string): string {
  return value
    .replace(/\\/g, "\\\\")  // 转义反斜杠
    .replace(/%/g, "\\%")     // 转义百分号
    .replace(/_/g, "\\_");    // 转义下划线
}
```

### 10.3 搜索限制常量

```typescript
// src/lib/constants/usage-logs.constants.ts
export const SESSION_ID_SUGGESTION_MIN_LEN = 2;   // 最小搜索长度
export const SESSION_ID_SUGGESTION_MAX_LEN = 128; // 最大搜索长度
export const SESSION_ID_SUGGESTION_LIMIT = 20;    // 默认返回数量
```

---

## 11. CSV 导出

### 11.1 导出字段

```typescript
// src/actions/usage-logs.ts:120-145
const CSV_HEADERS = [
  "时间",
  "用户",
  "密钥",
  "供应商",
  "模型",
  "原始模型",
  "端点",
  "状态码",
  "输入 Tokens",
  "输出 Tokens",
  "Cache Creation (5m)",
  "Cache Creation (1h)",
  "Cache Read",
  "总 Tokens",
  "成本 (USD)",
  "耗时 (ms)",
  "TTFB (ms)",
  "Session ID",
  "重试次数",
];
```

### 11.2 CSV 安全转义

防止 CSV 注入攻击：

```typescript
// src/actions/usage-logs.ts:95-107
function escapeCsvField(field: string): string {
  const dangerousChars = ["=", "+", "-", "@", "\t", "\r"];
  let safeField = field;
  
  // 如果字段以危险字符开头，添加单引号前缀
  if (dangerousChars.some((char) => field.startsWith(char))) {
    safeField = `'${field}`;
  }
  
  // 如果字段包含逗号、引号或换行，用引号包裹
  if (/[",\n\r]/.test(safeField)) {
    safeField = `"${safeField.replace(/"/g, '""')}"`;
  }
  
  return safeField;
}
```

---

## 12. 前端组件

### 12.1 筛选器组件

```typescript
// src/app/[locale]/dashboard/logs/_components/usage-logs-filters.tsx
export function UsageLogsFilters({
  isAdmin,
  providers,
  initialKeys,
  filters,
  onChange,
  onReset,
}: UsageLogsFiltersProps) {
  // 四个筛选器分组
  // 1. TimeFilters - 时间范围筛选
  // 2. IdentityFilters - 用户/密钥筛选
  // 3. RequestFilters - 供应商/模型/端点/Session 筛选
  // 4. StatusFilters - 状态码/重试次数筛选
}
```

### 12.2 快速筛选预设

```typescript
// src/app/[locale]/dashboard/logs/_components/filters/quick-filters-bar.tsx
type FilterPreset = "today" | "this-week" | "errors-only" | "show-retries";

const presets = [
  { id: "today", label: t("logs.presets.today"), icon: Calendar },
  { id: "this-week", label: t("logs.presets.thisWeek"), icon: CalendarDays },
  { id: "errors-only", label: t("logs.presets.errorsOnly"), icon: AlertCircle },
  { id: "show-retries", label: t("logs.presets.showRetries"), icon: RefreshCw },
] as const;
```

### 12.3 虚拟化表格

```typescript
// src/app/[locale]/dashboard/logs/_components/virtualized-logs-table.tsx
export function VirtualizedLogsTable({ filters, ...props }: VirtualizedLogsTableProps) {
  // 使用 TanStack Virtual 实现虚拟滚动
  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? allLogs.length + 1 : allLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT, // 52px
    overscan: 10,
  });
  
  // 无限滚动加载
  const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ["usage-logs-batch", filters],
    queryFn: async ({ pageParam }) => {
      return getUsageLogsBatch({ ...filters, cursor: pageParam, limit: BATCH_SIZE });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: autoRefreshEnabled ? autoRefreshIntervalMs : false, // 默认 5s
  });
}
```

---

## 13. URL 查询参数

### 13.1 参数格式

```typescript
// src/app/[locale]/dashboard/logs/_utils/logs-query.ts
export interface LogsUrlFilters {
  userId?: number;              // 用户 ID
  keyId?: number;               // 密钥 ID
  providerId?: number;          // 供应商 ID
  sessionId?: string;           // Session ID
  startTime?: number;           // 开始时间戳（毫秒）
  endTime?: number;             // 结束时间戳（毫秒）
  statusCode?: number;          // 状态码（或 "!200" 表示非 200）
  excludeStatusCode200?: boolean;
  model?: string;               // 模型名称
  endpoint?: string;            // 端点路径
  minRetryCount?: number;       // 最小重试次数
  page?: number;                // 页码
}
```

### 13.2 状态码特殊格式

- `statusCode=200` - 精确匹配 200
- `statusCode=!200` - 排除 200（所有非 200 状态码）

---

## 14. 错误详情对话框

点击状态码可查看详细的错误信息：

```typescript
// src/app/[locale]/dashboard/logs/_components/error-details-dialog/index.tsx
interface ErrorDetailsDialogProps {
  statusCode: number | null;
  errorMessage: string | null;
  errorStack: string | null;
  providerChain: ProviderChainItem[] | null;
  blockedBy: string | null;
  blockedReason: string | null;
  // ... 其他字段
}
```

**展示内容**：
- 基本信息（状态码、错误消息、时间）
- 供应商链（决策过程可视化）
- 性能指标（TTFB、总耗时、输出速率）
- 请求详情（Session ID、User-Agent、消息数）
- 计费详情（Token 使用、成本计算）

---

## 15. 参考文件

### 15.1 核心实现

| 文件 | 说明 |
|-----|------|
| `src/drizzle/schema.ts:369-457` | message_request 表定义 |
| `src/repository/usage-logs.ts` | 日志查询函数（分页、统计、筛选） |
| `src/repository/message-write-buffer.ts` | 异步写入缓冲区 |
| `src/repository/message.ts` | 消息请求 CRUD 操作 |
| `src/repository/_shared/message-request-conditions.ts` | Warmup 排除条件 |
| `src/repository/_shared/like.ts` | SQL LIKE 转义 |

### 15.2 Actions 和 API

| 文件 | 说明 |
|-----|------|
| `src/actions/usage-logs.ts` | Server Actions 封装 |
| `src/app/api/admin/log-level/route.ts` | 日志级别管理 API |
| `src/app/api/admin/log-cleanup/manual/route.ts` | 手动清理 API |

### 15.3 日志清理

| 文件 | 说明 |
|-----|------|
| `src/lib/log-cleanup/service.ts` | 清理服务实现 |
| `src/lib/log-cleanup/cleanup-queue.ts` | Bull 队列定时任务 |
| `src/lib/provider-endpoints/probe-log-cleanup.ts` | 端点探测日志清理 |

### 15.4 配置和常量

| 文件 | 说明 |
|-----|------|
| `src/lib/config/env.schema.ts` | 环境变量验证 |
| `src/lib/constants/usage-logs.constants.ts` | Session ID 搜索常量 |
| `src/lib/logger.ts` | Pino 日志实现 |

### 15.5 前端组件

| 文件 | 说明 |
|-----|------|
| `src/app/[locale]/dashboard/logs/_components/usage-logs-filters.tsx` | 筛选器面板 |
| `src/app/[locale]/dashboard/logs/_components/virtualized-logs-table.tsx` | 虚拟化表格 |
| `src/app/[locale]/dashboard/logs/_components/usage-logs-stats-panel.tsx` | 统计面板 |
| `src/app/[locale]/dashboard/logs/_utils/logs-query.ts` | URL 查询工具 |

---

*文档基于 claude-code-hub 代码库分析生成*
