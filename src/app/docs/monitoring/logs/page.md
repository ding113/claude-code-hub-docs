---
title: 日志查询与筛选
description: 了解 Claude Code Hub 的日志系统如何记录、查询和分析 API 请求，包括筛选条件、分页策略、CSV 导出和日志清理功能。
nextjs:
  metadata:
    title: 日志查询与筛选
    description: Claude Code Hub 日志查询与筛选文档
---

# 日志查询与筛选

Claude Code Hub 的日志系统提供了完整的 API 请求追踪、审计和分析能力。系统记录了每一次 API 调用的详细信息，包括请求元数据、Token 使用情况、成本计算、供应商链决策过程等，为运维监控、成本管理和故障排查提供数据支持。

## 核心能力

日志系统的设计目标包括：

- **请求追踪与审计**：完整记录每个 API 请求的完整生命周期，从请求到达、供应商选择、响应返回到错误处理
- **成本管理与计费**：精确计算每次请求的成本（USD），支持供应商倍率，为成本分析提供数据基础
- **运营监控**：实时监控错误率、重试模式、供应商性能，帮助及时发现系统异常
- **故障排查**：详细的错误信息、堆栈追踪、供应商链决策记录，快速定位问题根源
- **会话管理**：Session ID 追踪支持对话连续性分析，优化缓存命中率

## 日志查看界面

在管理后台的"使用日志"页面，你可以查看和分析所有 API 请求日志。界面包含以下主要区域：

- **筛选器面板**：左侧提供多维度筛选条件
- **统计面板**：顶部显示汇总数据（总请求数、总成本、平均耗时等）
- **日志表格**：主区域展示详细请求列表，支持虚拟滚动
- **错误详情**：点击状态码可查看完整错误信息

### 界面功能特性

- **自动刷新**：默认每 5 秒自动刷新数据，可手动开启/关闭
- **无限滚动**：使用游标分页实现流畅的大数据量浏览
- **快速筛选**：预设常用筛选条件（今天、本周、仅错误等）
- **URL 状态同步**：筛选条件自动同步到 URL，方便分享和书签

## 数据存储架构

日志数据存储在 PostgreSQL 的 `message_request` 表中，采用以下设计策略：

- **软删除模式**：使用 `deletedAt` 时间戳实现软删除，支持数据恢复
- **时区处理**：使用 `timestamptz` 类型存储 UTC 时间，前端自动转换本地时间
- **大数值支持**：Token 相关字段使用 `bigint` 类型，支持大流量场景

### 表结构概览

`message_request` 表包含以下核心字段：

| 字段类别 | 关键字段 | 说明 |
|---------|---------|------|
| 基础信息 | `id`, `providerId`, `userId`, `key` | 供应商、用户、API Key 关联 |
| 模型信息 | `model`, `originalModel`, `endpoint`, `apiType` | 实际使用模型、原始请求模型、API 类型 |
| Token 统计 | `inputTokens`, `outputTokens`, `cache*` | 输入输出及缓存 Token |
| 成本计算 | `costUsd`, `costMultiplier` | 实际成本和供应商倍率 |
| Session 追踪 | `sessionId`, `requestSequence` | 会话 ID 和请求序号 |
| 性能指标 | `durationMs`, `ttfbMs` | 总耗时和首字节时间 |
| 错误信息 | `errorMessage`, `errorStack`, `errorCause`, `statusCode` | 错误详情、堆栈、原因和 HTTP 状态码 |
| 供应商决策 | `providerChain` | 供应商选择决策链（JSONB） |
| 拦截记录 | `blockedBy`, `blockedReason` | 被拦截的请求记录 |
| 请求详情 | `messagesCount`, `userAgent` | 消息数量和客户端信息 |

### 索引策略

为优化查询性能，系统建立了以下索引：

| 索引名称 | 字段 | 用途 |
|---------|------|------|
| `idx_message_request_user_date_cost` | `userId`, `createdAt`, `costUsd` | 优化统计查询 |
| `idx_message_request_user_query` | `userId`, `createdAt` | 优化用户日志查询 |
| `idx_message_request_session_id` | `sessionId` | 支持会话追踪查询 |
| `idx_message_request_session_id_prefix` | `sessionId` (pattern) | 支持 Session ID 前缀搜索 |
| `idx_message_request_endpoint` | `endpoint` | 支持端点过滤 |
| `idx_message_request_blocked_by` | `blockedBy` | 排除 warmup 等系统请求 |

所有索引都包含 `deletedAt IS NULL` 条件，确保只查询未删除的记录。

## 日志写入模式

系统支持两种日志写入模式，通过 `MESSAGE_REQUEST_WRITE_MODE` 环境变量配置。

### 异步模式（默认）

异步模式使用内存缓冲区批量写入数据库，降低数据库压力：

```typescript
// 更新被缓冲，定期批量刷新
enqueueMessageRequestUpdate(id, { durationMs, costUsd });
```

**缓冲区工作原理**：

1. **更新合并**：同一 ID 的多次更新会在内存中合并，只保留最终状态
2. **队列保护**：当待处理队列超过 `maxPending` 时，优先丢弃非终态更新（没有 `durationMs` 的条目）
3. **批量刷新**：使用 CTE 和 `CASE WHEN` 实现高效的批量更新 SQL
4. **定时刷新**：按配置间隔自动刷新，应用关闭时也会触发刷新

**配置参数**：

| 环境变量 | 默认值 | 说明 | 范围 |
|---------|--------|------|------|
| `MESSAGE_REQUEST_WRITE_MODE` | `async` | 写入模式：`sync` 或 `async` | - |
| `MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS` | `250` | 异步刷新间隔（毫秒） | 10 - 60000 |
| `MESSAGE_REQUEST_ASYNC_BATCH_SIZE` | `200` | 批量写入大小 | 1 - 2000 |
| `MESSAGE_REQUEST_ASYNC_MAX_PENDING` | `5000` | 最大待处理队列长度 | 100 - 200000 |

### 同步模式

同步模式立即写入数据库，适用于开发和调试场景：

```typescript
// 同步模式：直接更新数据库
await db.update(messageRequest).set({ durationMs })
  .where(eq(messageRequest.id, id));
```

**模式对比**：

| 特性 | 异步模式 | 同步模式 |
|-----|---------|---------|
| 写入延迟 | 有（最大 250ms） | 无 |
| 数据库压力 | 低（批量写入） | 高（单条写入） |
| 数据一致性 | 最终一致性 | 强一致性 |
| 适用场景 | 生产环境高并发 | 开发调试 |

## 查询 API

### Server Actions

日志查询通过以下 Server Actions 提供。所有 Actions 返回 `ActionResult<T>` 类型：

```typescript
type ActionResult<T> = 
  | { ok: true; data: T } 
  | { ok: false; error: string };
```

```typescript
// 获取使用日志（带分页和统计）
getUsageLogs(filters): Promise<ActionResult<UsageLogsResult>>

// 游标分页查询（优化大数据集性能）
getUsageLogsBatch(filters): Promise<ActionResult<UsageLogsBatchResult>>

// 独立获取聚合统计（按需加载）
getUsageLogsStats(filters): Promise<ActionResult<UsageLogSummary>>

// 导出 CSV
exportUsageLogs(filters): Promise<ActionResult<string>>

// 获取筛选器选项（模型、状态码、端点）
getFilterOptions(): Promise<ActionResult<FilterOptions>>

// Session ID 自动补全建议
getUsageLogSessionIdSuggestions(input): Promise<ActionResult<string[]>>
```

### 查询过滤器

```typescript
interface UsageLogFilters {
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

**筛选器组合逻辑**：

- 所有条件之间是 `AND` 关系
- `sessionId` 支持精确匹配，用于追踪特定对话
- `excludeStatusCode200` 为 `true` 时，只显示非 200 状态码的请求（快速定位错误）
- `minRetryCount` 用于筛选经历过重试的请求（值 >= 1 表示有重试）
- 时间范围使用 Unix 时间戳（毫秒），便于 URL 传递

### Session ID 建议输入

```typescript
interface UsageLogSessionIdSuggestionInput {
  term: string;                       // 搜索关键词
  userId?: number;                    // 限制特定用户
  keyId?: number;                     // 限制特定密钥
  providerId?: number;                // 限制特定供应商
  limit?: number;                     // 返回数量限制（默认 20）
}
```

### 分页策略

#### 偏移分页

适用于需要总页数和跳转的场景：

```typescript
const { page = 1, pageSize = 50 } = filters;
const offset = (page - 1) * pageSize;

// 同时查询总数和统计数据
const [summaryResult] = await db.select({
  totalRows: sql<number>`count(*)::double precision`,
  totalCost: sql<string>`COALESCE(sum(cost_usd), 0)`,
}).from(messageRequest).where(...);

// 查询分页数据
const results = await db.select({...})
  .orderBy(desc(messageRequest.createdAt))
  .limit(pageSize)
  .offset(offset);
```

#### 游标分页

适用于无限滚动和大数据集：

```typescript
// 游标条件：(created_at, id) < (cursor_created_at, cursor_id)
if (cursor) {
  conditions.push(
    sql`(${createdAt}, ${id}) < (${cursor.createdAt}, ${cursor.id})`
  );
}

// 查询 limit + 1 条判断是否还有更多
const results = await db.select({...})
  .orderBy(desc(createdAt), desc(id))
  .limit(limit + 1);
```

## 权限控制

### 角色权限矩阵

| 功能 | Admin | 普通用户 | 只读 Key |
|-----|-------|---------|---------|
| 查看所有用户日志 | ✓ | ✗ | ✗ |
| 查看指定用户日志 | ✓ | 仅自己 | 仅自己 |
| 按供应商筛选 | ✓ | ✗ | ✗ |
| 导出日志 | ✓ | 仅自己 | 仅自己 |
| 查看统计面板 | ✓ | 仅自己 | 仅自己 |

### 权限实现

```typescript
export async function getUsageLogs(filters) {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "未登录" };
  }
  
  // 如果不是 admin，强制过滤为当前用户
  const finalFilters =
    session.user.role === "admin" 
      ? filters 
      : { ...filters, userId: session.user.id };
      
  return findUsageLogsWithDetails(finalFilters);
}
```

## Warmup 请求排除

Warmup 请求（用于供应商健康检查）不计入任何统计和限额计算：

```typescript
const EXCLUDE_WARMUP_CONDITION = 
  sql`(${messageRequest.blockedBy} IS NULL OR ${messageRequest.blockedBy} <> 'warmup')`;
```

在统计查询中：

```typescript
const [summaryResult] = await db.select({
  // total：用于分页/审计，必须包含 warmup
  totalRows: sql<number>`count(*)::double precision`,
  // summary：所有统计字段必须排除 warmup
  totalRequests: sql<number>`count(*) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})`,
  totalCost: sql<string>`COALESCE(sum(cost_usd) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION}), 0)`,
});
```

## 日志清理

日志数据会持续增长，需要定期清理以控制数据库大小。系统提供自动和手动两种清理方式。

### 自动清理

通过系统设置配置自动清理任务。自动清理使用 Bull 队列实现定时任务，在后台异步执行。

**自动清理的工作原理**：

1. **定时触发**：按照 Cron 表达式定期触发清理任务
2. **分批删除**：每批删除指定数量的记录，避免长时间锁表
3. **触发记录**：记录每次清理的触发者、时间和删除数量
4. **失败重试**：清理失败时会自动重试

**系统设置参数**：

| 设置项 | 默认值 | 说明 |
|-------|--------|------|
| `enableAutoCleanup` | `false` | 是否启用自动清理 |
| `cleanupRetentionDays` | `30` | 日志保留天数 |
| `cleanupSchedule` | `"0 2 * * *"` | Cron 表达式（默认每天 2 AM） |
| `cleanupBatchSize` | `10000` | 每批删除记录数 |

### 手动清理 API

管理员可通过 API 手动清理日志。手动清理提供灵活的条件组合，适合以下场景：

- **定期归档**：删除已备份的旧数据
- **错误清理**：删除大量错误请求记录
- **用户数据删除**：清理特定用户的所有日志（GDPR 合规）
- **测试数据清理**：删除测试产生的垃圾数据

```typescript
// POST /api/admin/log-cleanup/manual
const conditions: CleanupConditions = {
  beforeDate: new Date('2024-01-01'),  // 删除此日期之前的日志
  afterDate: new Date('2023-01-01'),   // 删除此日期之后的日志
  userIds: [1, 2, 3],                  // 仅删除指定用户的日志
  providerIds: [1, 2],                 // 仅删除指定供应商的日志
  statusCodes: [500, 503],             // 仅删除指定状态码的日志
  statusCodeRange: { min: 400, max: 499 }, // 状态码范围
  onlyBlocked: true,                   // 仅删除被拦截的请求
};

const result = await cleanupLogs(
  conditions, 
  { dryRun: true },
  { type: "manual", userId: session.user.id, username: session.user.name }
);
// dryRun: true 仅预览，不实际删除
```

**清理条件说明**：

- `beforeDate` 和 `afterDate` 可以单独使用，也可以组合使用（删除时间范围内的日志）
- `statusCodes` 和 `statusCodeRange` 互斥，不能同时使用
- `onlyBlocked` 为 `true` 时，只删除 `blockedBy` 不为空的记录

### 批量删除实现

使用 CTE 实现安全批量删除：

```typescript
async function deleteBatch(whereConditions: SQL[], batchSize: number) {
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
  return result.rowCount || 0;
}
```

**安全特性**：

- `FOR UPDATE SKIP LOCKED`：跳过已锁定行，避免锁竞争
- 批量删除后休眠 100ms，避免长时间锁表
- 支持 `dryRun` 模式预览影响范围

## 日志级别管理

系统使用 Pino 作为日志库，支持动态调整日志级别。这在排查问题时非常有用，可以在不重启服务的情况下增加日志详细程度。

### 动态日志级别

支持运行时调整日志级别，无需重启服务：

```typescript
export function setLogLevel(newLevel: LogLevel): void {
  logger.level = newLevel;
  logger.info(`日志级别已调整为: ${newLevel}`);
}
```

**有效级别**（从低到高）：`trace` < `debug` < `info` < `warn` < `error` < `fatal`

**级别说明**：

| 级别 | 用途 |
|-----|------|
| `trace` | 最详细的追踪信息，包含所有内部状态变化 |
| `debug` | 调试信息，如请求/响应详情、缓存命中情况 |
| `info` | 正常运行信息，如请求完成、供应商选择 |
| `warn` | 警告信息，如限流触发、熔断器半开 |
| `error` | 错误信息，如请求失败、数据库连接错误 |
| `fatal` | 致命错误，如系统启动失败、关键配置缺失 |

### 日志级别 API

```typescript
// GET /api/admin/log-level - 获取当前日志级别
// 返回: { level: "info" }

// POST /api/admin/log-level - 设置日志级别
// 请求体: { level: "debug" }
// 返回: { success: true, level: "debug" }
```

### 环境变量配置

```bash
LOG_LEVEL=info  # 可选: fatal, error, warn, info, debug, trace
```

## Session ID 搜索

### 自动补全实现

```typescript
export async function findUsageLogSessionIdSuggestions(filters) {
  const { term, userId, keyId, providerId } = filters;
  const limit = Math.min(50, Math.max(1, filters.limit ?? 20));
  
  // 使用 LIKE 前缀匹配，配合 ESCAPE 防止注入
  const pattern = `${escapeLike(term.trim())}%`;
  
  const results = await db
    .select({
      sessionId: messageRequest.sessionId,
      firstSeen: sql<Date>`min(${messageRequest.createdAt})`,
    })
    .from(messageRequest)
    .where(and(
      isNull(messageRequest.deletedAt),
      EXCLUDE_WARMUP_CONDITION,
      sql`${messageRequest.sessionId} LIKE ${pattern} ESCAPE '\\'`,
    ))
    .groupBy(messageRequest.sessionId)
    .orderBy(desc(sql`min(${messageRequest.createdAt})`))
    .limit(limit);
    
  return results.map((r) => r.sessionId).filter(Boolean);
}
```

### 搜索限制

| 常量 | 值 | 说明 |
|-----|---|------|
| `SESSION_ID_SUGGESTION_MIN_LEN` | 2 | 最小搜索长度 |
| `SESSION_ID_SUGGESTION_MAX_LEN` | 128 | 最大搜索长度 |
| `SESSION_ID_SUGGESTION_LIMIT` | 20 | 默认返回数量 |

## CSV 导出

### 导出字段

CSV 导出包含以下字段：

| 字段 | 说明 |
|-----|------|
| Time | 请求创建时间 |
| User | 用户名 |
| Key | API Key 名称 |
| Provider | 供应商名称 |
| Model | 实际使用的模型 |
| Original Model | 客户端请求的模型 |
| Endpoint | API 端点路径 |
| Status Code | HTTP 响应状态码 |
| Input Tokens | 输入 Token 数量 |
| Output Tokens | 输出 Token 数量 |
| Cache Write 5m | 5 分钟缓存写入 Token |
| Cache Write 1h | 1 小时缓存写入 Token |
| Cache Read | 缓存读取 Token |
| Total Tokens | 输入 + 输出 Token 总数 |
| Cost (USD) | 请求成本（美元） |
| Duration (ms) | 请求总耗时 |
| Session ID | 会话标识 |
| Retry Count | 供应商重试次数 |

### CSV 安全转义

防止 CSV 注入攻击：

```typescript
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

## 前端组件

### 筛选器组件

日志页面的筛选器组件采用分组设计，便于快速定位所需条件：

1. **TimeFilters**：时间范围筛选
   - 快速预设：今天、昨天、本周、上周、本月、自定义
   - 自定义范围：开始时间和结束时间选择器
   
2. **IdentityFilters**：身份筛选
   - 用户选择器（admin 可用）
   - API Key 选择器
   
3. **RequestFilters**：请求详情筛选
   - 供应商选择器（admin 可用）
   - 模型选择器（动态加载可用模型）
   - 端点选择器
   - Session ID 输入框（支持自动补全）
   
4. **StatusFilters**：状态筛选
   - 状态码选择器（200、400、429、500 等）
   - 排除 200 选项（快速查看错误）
   - 最小重试次数输入

### 快速筛选预设

```typescript
type FilterPreset = "today" | "this-week" | "errors-only" | "show-retries";

const presets = [
  { id: "today", label: "今天", icon: Calendar },
  { id: "this-week", label: "本周", icon: CalendarDays },
  { id: "errors-only", label: "仅错误", icon: AlertCircle },
  { id: "show-retries", label: "显示重试", icon: RefreshCw },
];
```

### 虚拟化表格

日志表格使用 TanStack Virtual 实现虚拟滚动，即使面对数十万条记录也能保持流畅：

```typescript
const rowVirtualizer = useVirtualizer({
  count: hasNextPage ? allLogs.length + 1 : allLogs.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 52, // 每行高度 52px
  overscan: 10,
});

// 无限滚动加载
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ["usage-logs-batch", filters],
  queryFn: async ({ pageParam }) => {
    return getUsageLogsBatch({ ...filters, cursor: pageParam, limit: 50 });
  },
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  refetchInterval: autoRefreshEnabled ? 5000 : false, // 默认 5s 自动刷新
});
```

## URL 查询参数

日志页面支持通过 URL 参数分享筛选状态：

```typescript
interface LogsUrlFilters {
  userId?: number;              // 用户 ID
  keyId?: number;               // 密钥 ID
  providerId?: number;          // 供应商 ID
  sessionId?: string;           // Session ID
  startTime?: number;           // 开始时间戳（毫秒）
  endTime?: number;             // 结束时间戳（毫秒）
  statusCode?: number | string; // 状态码（或 "!200" 表示非 200）
  model?: string;               // 模型名称
  endpoint?: string;            // 端点路径
  minRetryCount?: number;       // 最小重试次数
  page?: number;                // 页码
}
```

**状态码特殊格式**：

- `statusCode=200` - 精确匹配 200
- `statusCode=!200` - 排除 200（所有非 200 状态码）

## 错误详情对话框

点击日志表格中的状态码，可以打开错误详情对话框，查看完整的请求信息：

### 基本信息

- HTTP 状态码和错误消息
- 请求发生时间
- 是否被拦截及拦截原因

### 供应商链

可视化展示供应商选择决策过程：

- 尝试过的所有供应商
- 每个供应商的失败原因
- 最终成功的供应商
- 重试次数和顺序

### 性能指标

- **TTFB**（Time To First Byte）：从发送请求到收到首字节的时间
- **总耗时**：完整请求处理时间
- **输出速率**：每秒输出 Token 数

### 请求详情

- Session ID 和请求序号
- User-Agent 和客户端信息
- 消息数量
- 原始请求模型和实际使用模型

### 计费详情

- 输入/输出 Token 数量
- 缓存读写 Token 数量
- 请求成本（USD）
- 应用的供应商倍率

### 错误堆栈

对于 500 错误，对话框会显示完整的错误堆栈信息，帮助定位代码问题。

## 最佳实践

### 查询优化

1. **使用时间范围**：始终设置合理的时间范围，避免全表扫描。建议单次查询不超过 7 天数据
2. **利用 Session ID**：追踪特定对话时优先使用 Session ID 筛选，这比按时间范围筛选更精确
3. **分页策略**：大数据集使用游标分页，小数据集使用偏移分页。超过 1000 条记录时推荐使用游标分页
4. **组合筛选**：同时使用多个筛选条件可以显著减少数据量，提高查询速度

### 日志管理

1. **启用自动清理**：生产环境建议启用自动清理，控制数据库大小。根据数据增长情况设置合适的保留天数（建议 30-90 天）
2. **定期导出**：重要数据定期导出 CSV 备份，特别是成本统计相关的数据
3. **监控错误率**：使用 `excludeStatusCode200` 快速定位错误请求，建议设置告警阈值（如错误率 > 5%）
4. **关注重试模式**：通过 `minRetryCount` 筛选重试请求，分析供应商稳定性

### 故障排查

1. **查看供应商链**：了解请求路由决策过程，识别被过滤的供应商和原因
2. **检查 blockedBy**：识别被拦截的请求原因（如 warmup、sensitive_words、rate_limit 等）
3. **分析 TTFB**：判断供应商响应速度，TTFB 过高可能表示供应商负载过高或网络问题
4. **对比原始模型和实际模型**：检查模型重定向是否按预期工作
5. **检查缓存命中率**：通过 Cache Read Token 数量判断缓存利用效率

## 性能考虑

### 数据库性能

日志表是系统中最大的表之一，查询性能需要特别注意：

- **分区策略**：对于超大数据量（千万级以上），建议按时间范围分区
- **归档策略**：将历史数据归档到冷存储，主表只保留热数据
- **查询限制**：单次查询默认限制 50 条，最大不超过 200 条
- **统计缓存**：聚合统计结果可以缓存，减少重复计算

### 前端性能

- **虚拟滚动**：表格只渲染可视区域，内存占用恒定
- **数据流优化**：使用 React Query 的 `refetchInterval` 实现自动刷新，避免轮询
- **防抖筛选**：筛选条件变化时防抖 300ms 再触发查询

## 安全考虑

### 数据访问控制

- 所有日志查询都经过权限检查，非 admin 用户只能查看自己的日志
- API Key 级别的日志隔离确保不同 Key 的数据不会泄露
- Session ID 搜索同样受权限限制，不能跨用户搜索

### 敏感信息处理

- 日志中不存储请求/响应的消息内容（除非显式开启调试模式）
- 错误堆栈可能包含敏感路径信息，CSV 导出时需要注意
- 建议定期清理包含敏感信息的错误日志

## 故障排查指南

### 常见问题

**Q: 为什么某些请求没有成本数据？**
A: 成本计算需要供应商返回 Token 使用信息。如果请求失败或被拦截，可能没有成本数据。

**Q: Session ID 搜索没有结果？**
A: 检查搜索关键词长度（至少 2 个字符），并确保有相应权限。Warmup 请求的 Session ID 不会被索引。

**Q: 日志显示有延迟？**
A: 异步写入模式下，日志最多有 250ms 延迟。如果延迟更长，检查 `MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS` 配置。

**Q: 如何追踪一个请求的完整生命周期？**
A: 使用 Session ID 筛选，按时间排序。查看 `requestSequence` 了解请求顺序，`providerChain` 了解供应商选择过程。

## 相关文档

- [成本追踪与计费](/docs/monitoring/cost-tracking) - 了解成本计算方法
- [数据导出功能](/docs/monitoring/export) - 了解 CSV 导出详情
- [自动清理功能](/docs/system/auto-cleanup) - 了解日志清理配置
- [会话管理](/docs/proxy/session-management) - 了解 Session 绑定机制
