---
title: 仪表盘实时指标
nextjs:
  metadata:
    title: 仪表盘实时指标
    description: Claude Code Hub 仪表盘实时指标文档
---

# 仪表盘实时指标

Claude Code Hub 的仪表盘提供了一个全面的实时监控界面，让你能够追踪 API 使用情况、成本支出、供应商健康状况和系统性能。无论你是管理员还是普通用户，都可以通过仪表盘快速了解系统的运行状态。

## 仪表盘概览

仪表盘采用响应式 Bento 网格布局，将关键指标以卡片形式呈现，让你一眼就能掌握系统状态。

### 核心指标卡片（管理员专属）

如果你是管理员，仪表盘顶部会显示四个核心指标：

| 指标 | 说明 | 数据来源 |
|------|------|----------|
| **并发会话数** | 当前活跃的会话数量 | Redis 实时统计 |
| **RPM** | 过去一分钟内的请求数 | 数据库滚动统计 |
| **今日成本** | 当日累计消费金额 | 数据库聚合计算 |
| **平均响应时间** | 所有请求的平均延迟 | 数据库实时计算 |

每个指标卡片还会显示与昨日同时段的对比数据，帮助你快速识别趋势变化。

### 统计图表

仪表盘中央是一个交互式面积图，展示成本和调用量随时间的变化趋势：

- **时间范围选择**：今日（小时粒度）、近 7 天、近 30 天、本月（日粒度）
- **显示模式**：叠加模式（各用户独立显示）或堆叠模式（累计显示）
- **用户筛选**：管理员可以切换显示特定用户的数据

{% callout type="note" title="权限控制" %}
统计图表根据你的权限显示不同范围的数据：
- **管理员**：显示所有用户的数据
- **全局视图开启**：显示自己的 API Key 详情 + 其他用户聚合数据
- **普通用户**：仅显示自己的 API Key 数据
{% /callout %}

### 排行榜与实时会话

仪表盘右侧展示多个维度的排行榜：

- **用户排行**：按消费金额排序的 Top 用户
- **供应商排行**：按请求量排序的 Top 供应商
- **模型排行**：按使用量排序的 Top 模型

管理员还可以看到实时活跃会话列表，显示当前正在进行的对话详情。

## 数据刷新机制

仪表盘采用自动轮询机制保持数据实时性：

| 组件 | 刷新间隔 | 数据来源 | 策略 |
|------|----------|----------|------|
| 核心指标 | 5 秒 | PostgreSQL + Redis | 并行查询 |
| 统计图表 | 切换时间范围时 | PostgreSQL | 时间范围 SQL |
| 排行榜 | 60 秒 | PostgreSQL + Redis 缓存 | 乐观缓存 |
| 活动流 | 实时混合 | Redis + PostgreSQL | 优先活跃会话 |
| 供应商槽位 | 5 秒 | Redis | 实时统计 |

### 前端轮询实现

仪表盘使用 React Query 的 `refetchInterval` 实现自动刷新：

```typescript
const { data: overview } = useQuery<OverviewData>({
  queryKey: ["overview-data"],
  queryFn: fetchOverviewData,
  refetchInterval: 5000, // 每 5 秒刷新
});
```

## 实时数据大屏

除了标准仪表盘，系统还提供了一个专门的数据大屏界面，适合在监控站或办公室展示：

### 大屏特性

- **2 秒刷新率**：比标准仪表盘更快的数据更新
- **三栏布局**：用户排行 + 供应商排行 | 供应商配额 + 流量趋势 + 模型分布 | 活动流
- **自动隐藏 UI**：无操作时自动隐藏界面元素，减少干扰
- **主题切换**：支持深色/浅色模式，自动检测系统偏好

### 大屏指标

数据大屏展示五项关键指标：

1. 并发会话数
2. 今日请求数
3. 今日成本
4. 平均延迟
5. 错误率

访问路径：`/internal/dashboard/big-screen`

## 配置选项

### 系统设置

以下系统设置会影响仪表盘行为：

```typescript
interface SystemSettings {
  // 货币显示偏好
  currencyDisplay: "USD" | "CNY" | "EUR" | "JPY" | "GBP" | "HKD" | "TWD" | "KRW" | "SGD";
  
  // 全局视图开关
  allowGlobalUsageView: boolean; // 允许非管理员查看聚合数据
  
  // 时区配置
  timezone: string; // 例如 "Asia/Shanghai"
  
  // 模型统计计费源
  billingModelSource: "original" | "redirected";
}
```

### 环境变量

```bash
# Redis 配置（用于会话追踪）
REDIS_URL=redis://localhost:6379

# 数据库连接
DATABASE_URL=postgresql://user:pass@localhost:5432/claude_code_hub

# 时区回退（当数据库设置无效时使用）
TZ=Asia/Shanghai
```

## API 端点

仪表盘数据通过以下 Server Actions 获取：

| 端点 | 说明 | 访问权限 |
|------|------|----------|
| `getOverviewData` | 核心指标（并发数、成本、错误率） | 已认证用户 |
| `getUserStatistics` | 时间序列统计数据 | 已认证用户 |
| `getDashboardRealtimeData` | 完整仪表盘快照 | 管理员/全局视图 |
| `getActiveSessions` | 实时会话列表 | 仅管理员 |
| `getProviderSlots` | 供应商容量状态 | 管理员/全局视图 |

### 排行榜 API

```
GET /api/leaderboard?period=daily&scope=user
```

参数说明：

| 参数 | 类型 | 说明 |
|------|------|------|
| `period` | string | `daily` \| `weekly` \| `monthly` \| `allTime` \| `custom` |
| `scope` | string | `user` \| `provider` \| `model` |
| `startDate` | string | 自定义开始日期（YYYY-MM-DD） |
| `endDate` | string | 自定义结束日期（YYYY-MM-DD） |
| `providerType` | string | 供应商类型过滤 |

## 数据结构

### 概览数据

```typescript
interface OverviewData {
  concurrentSessions: number;        // 活跃会话数
  todayRequests: number;             // 今日请求数
  todayCost: number;                 // 今日成本（USD）
  avgResponseTime: number;           // 平均响应时间（毫秒）
  todayErrorRate: number;            // 错误率（百分比）
  yesterdaySamePeriodRequests: number;  // 昨日同时段请求数
  yesterdaySamePeriodCost: number;      // 昨日同时段成本
  yesterdaySamePeriodAvgResponseTime: number; // 昨日同时段平均响应时间
  recentMinuteRequests: number;      // 最近一分钟请求数（RPM）
}
```

### 活动流条目

```typescript
interface ActivityStreamEntry {
  id: string;
  user: string;           // 用户名
  model: string;          // 使用的模型
  provider: string;       // 供应商名称
  latency: number;        // 响应延迟（毫秒）
  status: number;         // HTTP 状态码
  cost: number;           // 请求成本
  startTime: number;      // 开始时间戳
}
```

### 排行榜条目

```typescript
interface LeaderboardEntry {
  userId: number;
  userName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
}

interface ProviderLeaderboardEntry {
  providerId: number;
  providerName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number;
  avgTtfbMs: number;
  avgTokensPerSecond: number;
}
```

## 数据聚合逻辑

### 时区处理

所有时间相关的查询都使用显式时区转换，确保"今日"的定义正确：

```typescript
const timezone = await resolveSystemTimezone();
// 回退链：数据库设置 -> 环境变量 TZ -> UTC

sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = 
    (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
```

系统会自动处理夏令时转换、跨时区访问等边界情况。

### 活动流混合策略

活动流结合 Redis（活跃会话）和 PostgreSQL（最近请求）提供实时视图：

1. 从 Redis 获取活跃会话 ID 列表
2. 查询每个活跃会话的最新请求（使用 `ROW_NUMBER()` 窗口函数）
3. 如果数据不足，补充查询数据库中的最近请求
4. 去重并按时间排序

### 时间序列聚合

统计图表使用 `generate_series` 填充时间序列中的空白：

```sql
WITH time_series AS (
  SELECT generate_series(
    DATE_TRUNC('hour', TIMEZONE('Asia/Shanghai', NOW())),
    DATE_TRUNC('hour', TIMEZONE('Asia/Shanghai', NOW())) + INTERVAL '23 hours',
    '1 hour'::interval
  ) AS hour
),
stats AS (
  SELECT 
    DATE_TRUNC('hour', createdAt AT TIME ZONE 'Asia/Shanghai') AS hour,
    count(*) AS api_calls,
    COALESCE(sum(costUsd), 0) AS total_cost
  FROM message_request
  WHERE createdAt AT TIME ZONE 'Asia/Shanghai' >= DATE_TRUNC('day', TIMEZONE('Asia/Shanghai', NOW()))
  GROUP BY DATE_TRUNC('hour', createdAt AT TIME ZONE 'Asia/Shanghai')
)
SELECT 
  time_series.hour,
  COALESCE(stats.api_calls, 0) AS api_calls,
  COALESCE(stats.total_cost, 0) AS total_cost
FROM time_series
LEFT JOIN stats ON time_series.hour = stats.hour
ORDER BY time_series.hour
```

## 错误处理与降级

### 部分故障容忍

仪表盘使用 `Promise.allSettled()` 优雅处理部分数据源故障：

```typescript
const [
  overviewResult,
  activityStreamResult,
  userRankingsResult,
] = await Promise.allSettled([
  getOverviewData(),
  findRecentActivityStream(20),
  findDailyLeaderboard(),
]);

// 提取数据，失败时返回 null
const overviewData =
  overviewResult.status === "fulfilled" && overviewResult.value.ok
    ? overviewResult.value.data
    : null;
```

**行为说明**：
- 单个数据源失败不会导致整个仪表盘崩溃
- 失败的组件显示加载状态或缓存数据
- 错误会被记录到日志中供排查
- 概览数据失败会导致整个仪表盘失败（关键路径）

### Redis 故障降级

会话追踪采用"Fail-Open"策略：

```typescript
static async getProviderSessionCount(providerId: number): Promise<number> {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return 0;  // 故障开放
  
  try {
    // ... 查询逻辑
  } catch (error) {
    logger.error("Failed to get provider session count", { error });
    return 0;  // 故障开放
  }
}
```

排行榜缓存会优雅降级为直接数据库查询。

## 性能优化

### 查询优化

1. **复合索引**：数据库索引覆盖 `(userId, createdAt, costUsd)` 用于快速聚合
2. **Redis 缓存**：排行榜数据 60 秒 TTL，使用分布式锁防止缓存击穿
3. **并行查询**：独立数据源使用 `Promise.all()` 并行获取
4. **批量操作**：Redis Pipeline 批量处理多个会话操作
5. **窗口函数**：使用 `ROW_NUMBER() OVER` 高效获取"每组最新"数据

### 前端优化

1. **React Query 缓存**：Stale-while-revalidate 模式，5 秒刷新
2. **SWR 大屏**：2 秒刷新，禁用窗口聚焦重新验证
3. **初始数据**：统计面板使用服务端预取数据
4. **条件获取**：仅管理员获取活跃会话数据
5. **Memoization**：使用 `useMemo` 缓存计算值

### 可扩展性限制

| 指标 | 限制 | 说明 |
|------|------|------|
| 并发仪表盘用户 | 100+ | Redis 连接池 |
| 活动流条目 | 20 | 可通过配置调整 |
| 排行榜显示 | Top 5 | API 返回全部数据 |
| 模型分布 | Top 10 | 大屏显示限制 |
| 供应商槽位 | Top 3 | 按使用率排序 |
| 会话 TTL | 5 分钟 | 可配置 |
| 排行榜缓存 | 60 秒 | 乐观缓存策略 |

## 故障排查

### 仪表盘数据不更新

1. 检查浏览器控制台是否有网络错误
2. 验证 Redis 连接状态
3. 查看服务器日志中的错误信息
4. 确认系统时区配置正确

### 排行榜显示异常

1. 检查 `allowGlobalUsageView` 设置
2. 验证用户权限配置
3. 查看 Redis 缓存是否过期

### 成本显示不正确

1. 确认 `currencyDisplay` 设置
2. 检查数据库中的成本记录
3. 验证时区配置（影响"今日"的定义）

### 会话数显示为 0

1. 检查 Redis 连接状态
2. 验证 `SESSION_TTL` 配置
3. 查看是否有活跃请求正在处理

## 最佳实践

### 1. 监控关键指标

建议重点关注以下指标：

- **错误率突增**：可能表示供应商故障
- **RPM 趋势**：识别使用高峰时段
- **成本增长**：及时发现异常消费
- **并发会话**：评估系统负载

### 2. 合理配置刷新间隔

- 标准仪表盘：保持默认 5 秒
- 数据大屏：保持默认 2 秒
- 低流量场景：可适当延长以减少服务器负载

### 3. 时区管理

- 在系统设置中配置正确的时区
- 确保数据库服务器和应用程序服务器时区一致
- 跨时区团队使用时，明确告知仪表盘使用系统时区

### 4. 权限管理

- 仅为需要全局视图的用户开启 `allowGlobalUsageView`
- 定期审查管理员权限
- 使用用户标签和分组进行细粒度控制

## 相关文档

- [实时数据大屏](/docs/monitoring/big-screen) - 数据大屏详细说明
- [排行榜](/docs/monitoring/leaderboard) - 排行榜功能详解
- [活跃会话监控](/docs/monitoring/active-sessions) - 会话追踪机制
- [成本追踪与计费](/docs/monitoring/cost-tracking) - 成本统计原理
- [会话管理](/docs/proxy/session-management) - Session 生命周期
