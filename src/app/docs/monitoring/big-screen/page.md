---
title: 实时数据大屏
description: Claude Code Hub 的集中式监控仪表盘，提供全站运行状态的实时可视化展示
nextjs:
  metadata:
    title: 实时数据大屏
    description: 了解 Claude Code Hub 实时数据大屏的功能、数据源、实现原理和最佳实践
---

# 实时数据大屏

实时数据大屏是 Claude Code Hub 的集中式监控仪表盘，为系统管理员提供全站运行状态的
实时可视化展示。该功能以全屏沉浸式界面呈现关键系统指标、用户活动、供应商性能等数据，
适用于运维监控室展示或大型显示器实时展示。

{% callout type="note" title="适用场景" %}
- 运维团队监控 Claude Code Hub 代理系统的运行状态
- 管理团队查看资源使用情况和成本分布
- 演示环境展示系统能力和活跃度
- 故障排查时快速定位问题
{% /callout %}

## 功能概述

### 核心功能

实时数据大屏整合了 Claude Code Hub 的多个监控维度，在一个界面中展示：

1. **实时系统监控**：展示当前并发会话数、今日请求总量、成本消耗、平均响应时间和错误率
2. **运营可见性**：显示活跃用户排行、供应商性能排行、供应商并发插槽使用情况
3. **模型使用分析**：展示各模型的调用分布情况
4. **流量趋势追踪**：24小时请求量趋势图表
5. **实时活动流**：展示最近的请求活动记录

### 设计目标

数据大屏的设计遵循以下原则：

- **一目了然**：关键指标在 3 秒内可被理解
- **实时更新**：数据每 2 秒自动刷新，确保信息时效性
- **视觉层次**：通过颜色、大小、位置区分信息重要性
- **全屏适配**：支持各种大屏幕显示器的分辨率
- **主题切换**：支持深色/浅色模式，适应不同环境光线

## 访问方式

### 页面路由

| 属性 | 值 |
|------|-----|
| **路由路径** | `/internal/dashboard/big-screen` |
| **页面文件** | `src/app/[locale]/internal/dashboard/big-screen/page.tsx` |
| **布局文件** | `src/app/[locale]/internal/dashboard/big-screen/layout.tsx` |
| **加载状态** | `src/app/[locale]/internal/dashboard/big-screen/loading.tsx` |

### 权限要求

访问数据大屏需要满足以下条件之一：

1. **管理员权限**：用户角色为 `admin`
2. **全局查看权限**：系统设置中 `allowGlobalUsageView` 设置为 `true`

```typescript
// 权限检查逻辑 (src/actions/dashboard-realtime.ts)
const settings = await getSystemSettings();
const isAdmin = session.user.role === "admin";
const canViewGlobalData = isAdmin || settings.allowGlobalUsageView;

if (!canViewGlobalData) {
  return {
    ok: false,
    error: "无权限查看全局数据",
  };
}
```

### 开启全局查看权限

管理员可以在系统设置中开启全局使用量查看权限：

1. 进入 **设置 > 系统配置**
2. 找到 **允许全局查看使用量** 选项
3. 开启开关并保存

{% callout type="warning" title="安全提示" %}
开启全局查看权限后，所有登录用户都能查看系统的整体使用情况，包括其他用户的成本
数据。请根据实际安全需求谨慎开启此选项。
{% /callout %}

## 界面布局

### 整体结构

数据大屏采用全屏沉浸式布局，移除所有导航栏和侧边栏，分为以下区域：

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER: 标题 + 实时时钟 + 语言切换 + 主题切换 + 手动刷新按钮      │
├──────────────┬──────────────────────────────┬───────────────────┤
│              │                              │                   │
│  LEFT COL    │      MIDDLE COL              │   RIGHT COL       │
│  (col-span-3)│      (col-span-5)            │  (col-span-4)     │
│              │                              │                   │
│  用户消耗排行 │  供应商并发插槽状态           │                   │
│  (flex-[3])  │  (可视化进度条)               │  实时请求流        │
│              │                              │  (Live Stream)    │
│  供应商排行   ├──────────────────────────────┤                   │
│  (flex-[2])  │  24小时流量趋势               │                   │
│              │  (面积图)                     │                   │
│              │                              │                   │
│              ├──────────────────────────────┤                   │
│              │  模型调用分布                 │                   │
│              │  (环形饼图)                   │                   │
│              │                              │                   │
├──────────────┴──────────────────────────────┴───────────────────┤
│  FOOTER: 系统状态 + 最后更新时间                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 顶部核心指标

顶部展示五个关键指标卡片：

| 指标 | 图标 | 说明 | 数据来源 |
|------|------|------|----------|
| **并发数** | Wifi | 当前活跃会话数量 | Redis `global:active_sessions` |
| **今日请求** | Activity | 今日总请求数 | 数据库聚合 |
| **今日成本** | DollarSign | 今日总成本（美元） | 数据库聚合 |
| **平均响应** | Clock | 平均响应时间（毫秒） | 数据库聚合 |
| **错误率** | AlertTriangle | 今日错误请求百分比 | 数据库聚合 |

#### 指标卡片交互

每个指标卡片都包含以下视觉元素：

- **图标**：使用 Lucide 图标库的图标，颜色与主题匹配
- **数值**：大号字体显示，支持数字滚动动画
- **标签**：指标名称，使用较小字号
- **脉冲效果**：并发数卡片带有呼吸灯动画，表示实时状态

### 主题支持

数据大屏支持两种视觉主题：

#### 深色模式（默认）

- **背景**：`#0a0a0f`（近黑色）
- **卡片背景**：`#1a1a2e/60` 带毛玻璃效果
- **文字颜色**：`#e6e6e6`（浅灰）
- **强调色**：`#ff6b35`（橙色）
- **边框**：`border-white/5`

#### 浅色模式

- **背景**：`#fafafa`（浅灰白）
- **卡片背景**：`white/80` 带毛玻璃效果
- **文字颜色**：`#1a1a1a`（深灰）
- **强调色**：`#ff5722`（橙红）
- **边框**：`border-black/5`

主题切换按钮位于页面右上角。

### 布局响应式设计

数据大屏采用响应式网格布局，适配不同屏幕尺寸：

- **大屏 (≥1280px)**：三栏布局（3:5:4），完整显示所有组件
- **中屏 (768px-1279px)**：两栏布局，右侧活动流移至底部
- **小屏 (<768px)**：单栏堆叠布局，适合移动设备查看

所有组件都使用 Tailwind CSS 的响应式类实现自适应：

```tsx
// 示例：网格布局配置
<div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
  <div className="lg:col-span-3">...</div>
  <div className="lg:col-span-5">...</div>
  <div className="lg:col-span-4">...</div>
</div>
```

## 数据源与实现

### 数据聚合架构

数据大屏通过 `getDashboardRealtimeData` Server Action 一次性并行查询所有数据源：

```typescript
// src/actions/dashboard-realtime.ts
const [
  overviewResult,        // 核心指标
  activityStreamResult,  // 实时活动流
  userRankingsResult,    // 用户排行
  providerRankingsResult,// 供应商排行
  providerSlotsResult,   // 供应商插槽
  modelRankingsResult,   // 模型分布
  statisticsResult,      // 24小时趋势
] = await Promise.allSettled([
  getOverviewData(),
  findRecentActivityStream(ACTIVITY_STREAM_LIMIT),
  findDailyLeaderboard(),
  findDailyProviderLeaderboard(),
  getProviderSlots(),
  findDailyModelLeaderboard(),
  getUserStatistics("today"),
]);
```

### 核心指标数据

**来源**：`src/actions/overview.ts` - `getOverviewData()`

| 字段 | 说明 | 计算方式 |
|------|------|----------|
| `concurrentSessions` | 当前并发会话数 | Redis 全局活跃 session 计数 |
| `todayRequests` | 今日请求数 | 数据库今日请求聚合 |
| `todayCost` | 今日成本 | 数据库今日成本求和 |
| `avgResponseTime` | 平均响应时间 | 今日请求耗时平均值 |
| `todayErrorRate` | 今日错误率 | 错误请求数 / 总请求数 |

### 实时活动流

**来源**：`src/repository/activity-stream.ts` - `findRecentActivityStream()`

活动流采用混合数据源策略，结合 Redis 的实时性和数据库的完整性：

1. **Redis 活跃 Session**：从 Redis 获取活跃 session ID 列表
2. **数据库查询**：查询这些 session 的最新请求（每个 session 取最新1条）
3. **数据补充**：如果不足 limit 条，补充数据库最新请求
4. **去重排序**：按创建时间降序排序并去重

这种混合策略的优势在于：
- **实时性**：优先展示活跃 session 的请求，确保数据新鲜
- **完整性**：当活跃 session 不足时，用历史数据补充
- **准确性**：避免仅依赖 Redis 可能丢失已结束 session 的最新请求

```typescript
// 活动流数据项结构
interface ActivityStreamEntry {
  id: string;           // 消息/请求 ID
  user: string;         // 用户名
  model: string;        // 模型名称
  provider: string;     // 供应商名称
  latency: number;      // 响应时间（毫秒）
  status: number;       // HTTP 状态码
  cost: number;         // 成本（美元）
  startTime: number;    // 开始时间戳
}
```

活动流表格显示以下列：
- **用户**：发起请求的用户名
- **模型**：使用的 AI 模型
- **供应商**：请求路由到的供应商
- **耗时**：请求处理时间（>1000ms 标红）
- **状态**：HTTP 状态码（200 绿色，其他红色）

### 用户消耗排行

**来源**：`src/repository/leaderboard.ts` - `findDailyLeaderboard()`

展示今日消耗 Top 5 用户：

| 字段 | 说明 |
|------|------|
| `userName` | 用户名称 |
| `totalCost` | 今日总成本 |
| `totalRequests` | 今日请求数 |
| `totalTokens` | 今日总 Token 数 |

排行条目包含进度条可视化，显示相对于第一名的消耗比例。

#### 进度条计算逻辑

```typescript
// 计算每个用户的相对消耗比例
const maxCost = rankings[0].totalCost;
const userPercentages = rankings.map(user => ({
  ...user,
  percentage: (user.totalCost / maxCost) * 100,
}));
```

进度条使用渐变色填充，颜色从蓝色过渡到紫色，增强视觉效果。

### 供应商排行

**来源**：`src/repository/leaderboard.ts` - `findDailyProviderLeaderboard()`

展示今日 Top 5 供应商：

| 字段 | 说明 |
|------|------|
| `providerName` | 供应商名称 |
| `totalCost` | 今日总成本 |
| `totalTokens` | 今日总 Token 数 |
| `successRate` | 成功率 |
| `avgTtfbMs` | 平均首字节时间 |
| `avgTokensPerSecond` | 平均每秒 Token 数 |

### 供应商并发插槽

**来源**：`src/actions/provider-slots.ts` - `getProviderSlots()`

显示供应商的并发使用情况：

```typescript
interface ProviderSlotInfo {
  providerId: number;      // 供应商 ID
  name: string;            // 供应商名称
  usedSlots: number;       // 已使用插槽数
  totalSlots: number;      // 总插槽数（并发限制）
  totalVolume: number;     // 总 Token 流量
}
```

**过滤与排序规则**：
1. 只显示设置了并发限额（`totalSlots > 0`）的供应商
2. 按占用率（`usedSlots / totalSlots`）降序排序
3. 最多显示前 3 个供应商

**视觉指示**：
- **正常** (< 70%)：蓝色渐变进度条
- **警告** (70%-90%)：黄色到橙色渐变
- **危险** (> 90%)：红色渐变

### 模型调用分布

**来源**：`src/repository/leaderboard.ts` - `findDailyModelLeaderboard()`

以环形饼图展示模型使用分布：

| 字段 | 说明 |
|------|------|
| `model` | 模型名称 |
| `totalRequests` | 请求数量 |
| `totalCost` | 总成本 |
| `totalTokens` | 总 Token 数 |
| `successRate` | 成功率 |

**配色方案**：
```typescript
const COLORS = {
  models: ["#ff6b35", "#00d4ff", "#ffd60a", "#00ff88", "#a855f7"],
};
```

### 24小时流量趋势

**来源**：`src/actions/statistics.ts` - `getUserStatistics("today")`

展示今日每小时的请求量趋势：

- **图表类型**：面积图（Area Chart）
- **X轴**：小时（0-23）
- **Y轴**：请求数量
- **线条颜色**：`#ff6b35`（橙色）
- **填充**：渐变填充，透明度从 0.3 到 0

数据只显示到当前小时（过滤未来时间）。

#### 流量趋势解读

通过 24 小时流量趋势图，你可以：

- **识别高峰时段**：发现系统使用的高峰期，用于容量规划
- **检测异常波动**：突然的流量下降可能表示系统故障
- **分析用户行为**：了解用户活跃的时间分布模式
- **对比历史趋势**：结合多日数据对比，发现趋势变化

## 实时刷新机制

### 客户端轮询

数据大屏使用 SWR（Stale-While-Revalidate）进行数据获取和缓存：

```typescript
// src/app/[locale]/internal/dashboard/big-screen/page.tsx
const { data, error, mutate } = useSWR(
  "dashboard-realtime",
  async () => {
    const result = await getDashboardRealtimeData();
    if (!result.ok) {
      throw new Error(result.error || "Failed to fetch data");
    }
    return result.data;
  },
  {
    refreshInterval: 2000,  // 每 2 秒刷新一次
    revalidateOnFocus: false,
  }
);
```

### 刷新控制

- **自动刷新**：每 2 秒自动获取最新数据
- **手动刷新**：点击右上角刷新按钮可立即刷新
- **错误处理**：刷新失败时保持上次成功数据，不中断显示

### 数据一致性保证

SWR 的缓存策略确保了数据大屏的性能和一致性：

1. **Stale-While-Revalidate**：先返回缓存数据，同时在后台重新验证
2. **去重请求**：相同 key 的并发请求会被合并，减少服务器压力
3. **错误重试**：请求失败时自动重试，避免瞬时错误影响显示
4. **乐观更新**：手动刷新时立即更新 UI，提升用户体验

### 性能影响评估

默认 2 秒的刷新频率对系统的影响：

| 指标 | 估算值 | 说明 |
|------|--------|------|
| 每分钟请求数 | 30 次 | 单个数据大屏页面 |
| 数据库查询 | 7 条/请求 | 并行执行，总耗时约 100-300ms |
| Redis 操作 | 5-10 次/请求 | 主要是 session 计数 |
| 内存占用 | 约 50KB/请求 | 返回的 JSON 数据大小 |

{% callout type="note" title="性能优化建议" %}
如果同时打开多个数据大屏页面，建议：
- 增加刷新间隔到 5-10 秒
- 使用 Redis 缓存部分聚合数据
- 考虑使用 WebSocket 替代轮询
{% /callout %}

## Session 追踪机制

### Redis 数据结构

实时数据大屏依赖 Redis 进行 session 追踪，使用 Sorted Set (ZSET) 结构：

| Key | 类型 | 说明 |
|-----|------|------|
| `global:active_sessions` | ZSET | 全局活跃 session，score = 时间戳 |
| `provider:${providerId}:active_sessions` | ZSET | 供应商级活跃 session |
| `key:${keyId}:active_sessions` | ZSET | API Key 级活跃 session |
| `user:${userId}:active_sessions` | ZSET | 用户级活跃 session |

### Session 生命周期

```typescript
// src/lib/session-tracker.ts
private static readonly SESSION_TTL = 300000; // 5 分钟（毫秒）
```

**追踪流程**：

1. **Session 创建**：`trackSession()` - 将 session 添加到全局和 key 级集合
2. **Provider 更新**：`updateProvider()` - 将 session 添加到 provider 级集合
3. **Session 刷新**：`refreshSession()` - 更新所有相关 ZSET 的时间戳
4. **过期清理**：`countFromZSet()` - 清理 5 分钟前的过期 session

### 并发计数

每个 session 维护独立的并发计数：

```typescript
// Key: session:${sessionId}:concurrent_count
// TTL: 10 分钟
```

- **请求开始**：`incrementConcurrentCount()` - 计数 +1
- **请求结束**：`decrementConcurrentCount()` - 计数 -1

### Session 追踪的准确性

Session 追踪机制的设计考虑了以下边界情况：

1. **网络中断**：客户端断开连接后，session 会在 5 分钟后自动过期
2. **服务器重启**：Redis 数据持久化确保 session 状态不丢失
3. **并发竞争**：使用 Redis 原子操作避免计数冲突
4. **时钟漂移**：基于服务器时间戳，不受客户端时间影响

### 监控粒度

Session 追踪支持多级监控粒度：

```
全局级别
  └── 所有活跃 session 总数（数据大屏显示的并发数）

供应商级别
  └── 每个供应商的活跃 session 数（用于并发限制）

用户级别
  └── 每个用户的活跃 session 数（用于用户级限流）

API Key 级别
  └── 每个 API Key 的活跃 session 数（用于 Key 级限流）
```

## 国际化支持

数据大屏支持多语言，翻译文件位于 `messages/{locale}/bigScreen.json`：

| 语言 | 文件 |
|------|------|
| 简体中文 | `messages/zh-CN/bigScreen.json` |
| 繁体中文 | `messages/zh-TW/bigScreen.json` |
| 英语 | `messages/en/bigScreen.json` |
| 日语 | `messages/ja/bigScreen.json` |
| 俄语 | `messages/ru/bigScreen.json` |

### 语言切换

点击页面右上角的语言切换按钮可循环切换：
```
zh-CN → en → ja → ru → zh-TW → zh-CN
```

### 国际化实现

数据大屏的国际化使用 `next-intl` 实现：

```typescript
// 获取当前语言翻译
const t = useTranslations("bigScreen");

// 使用翻译
<CardTitle>{t("metrics.concurrentSessions")}</CardTitle>
```

翻译文件结构示例：

```json
{
  "title": "实时数据大屏",
  "metrics": {
    "concurrentSessions": "并发数",
    "todayRequests": "今日请求",
    "todayCost": "今日成本",
    "avgResponseTime": "平均响应",
    "todayErrorRate": "错误率"
  },
  "rankings": {
    "userTitle": "用户消耗排行",
    "providerTitle": "供应商排行",
    "modelTitle": "模型调用分布"
  }
}
```

## 性能优化

### 部分失败容错

数据聚合使用 `Promise.allSettled`，单个数据源失败不影响其他数据展示：

```typescript
const activityStreamItems =
  activityStreamResult.status === "fulfilled" 
    ? activityStreamResult.value 
    : [];
```

### 数据限制

| 数据类型 | 限制数量 | 说明 |
|----------|----------|------|
| 活动流 | 20 条 | 最近请求记录 |
| 用户排行 | 5 条 | Top 5 消耗用户 |
| 供应商排行 | 5 条 | Top 5 供应商 |
| 供应商插槽 | 3 条 | 占用率最高的 3 个 |
| 模型分布 | 10 条 | 调用量最多的 10 个模型 |

这些限制在 `src/actions/dashboard-realtime.ts` 中定义：

```typescript
const ACTIVITY_STREAM_LIMIT = 20;
const USER_RANKINGS_LIMIT = 5;
const PROVIDER_RANKINGS_LIMIT = 5;
const PROVIDER_SLOTS_LIMIT = 3;
const MODEL_RANKINGS_LIMIT = 10;
```

如需调整这些限制，可以修改对应常量并重新部署。注意增加限制会影响页面加载性能和数据查询时间。

### 批量查询优化

- **Provider Session 计数**：使用 `getProviderSessionCountBatch()` 避免 N+1 查询
- **Session 并发计数**：使用 `getConcurrentCountBatch()` 批量获取

### 前端渲染优化

数据大屏采用了多项前端优化技术：

1. **虚拟列表**：活动流使用虚拟滚动，只渲染可见区域
2. **Memoization**：使用 `React.memo` 和 `useMemo` 避免不必要的重渲染
3. **懒加载图表**：Recharts 图表组件按需加载
4. **CSS 优化**：使用 `will-change` 和 `transform` 优化动画性能

### 数据库索引建议

为确保数据大屏查询性能，建议以下索引：

```sql
-- 请求记录时间索引（用于今日统计）
CREATE INDEX idx_requests_created_at ON requests(created_at);

-- 用户成本索引（用于用户排行）
CREATE INDEX idx_requests_user_cost ON requests(user_id, cost, created_at);

-- 供应商统计索引（用于供应商排行）
CREATE INDEX idx_requests_provider ON requests(provider_id, created_at);

-- 模型统计索引（用于模型分布）
CREATE INDEX idx_requests_model ON requests(model, created_at);
```

## 错误处理

### 权限错误

当用户无权限访问时：
- Server Action 返回 `{ ok: false, error: "无权限查看全局数据" }`
- SWR 捕获错误，页面显示错误状态

### Redis 不可用

当 Redis 不可用时：
- Session 追踪返回 0（Fail Open 策略）
- 并发数显示为 0
- 活动流降级为纯数据库查询

### 空数据处理

所有组件都处理空数据情况：

```typescript
const metrics = data?.metrics || {
  concurrentSessions: 0,
  todayRequests: 0,
  todayCost: 0,
  avgResponseTime: 0,
  todayErrorRate: 0,
};
```

## 相关文件

### 核心文件

| 文件 | 说明 |
|------|------|
| `src/app/[locale]/internal/dashboard/big-screen/page.tsx` | 主页面组件（922 行） |
| `src/app/[locale]/internal/dashboard/big-screen/layout.tsx` | 全屏布局 |
| `src/app/[locale]/internal/dashboard/big-screen/loading.tsx` | 加载骨架屏 |
| `src/actions/dashboard-realtime.ts` | 数据聚合 Server Action |
| `src/actions/overview.ts` | 核心指标数据 |
| `src/actions/provider-slots.ts` | 供应商插槽数据 |
| `src/actions/statistics.ts` | 统计数据 |

### 组件结构

数据大屏页面由以下主要组件构成：

```
BigScreenPage
├── ParticleBackground          # Canvas 粒子背景动画
├── Header                      # 顶部标题栏
│   ├── LiveClock              # 实时时钟
│   ├── LanguageToggle         # 语言切换按钮
│   ├── ThemeToggle            # 主题切换按钮
│   └── RefreshButton          # 手动刷新按钮
├── MetricsOverview             # 顶部核心指标区
│   └── MetricCard (x5)        # 五个指标卡片
├── MainContent                 # 主内容区
│   ├── LeftColumn             # 左栏
│   │   ├── UserRankings       # 用户消耗排行
│   │   └── ProviderRankings   # 供应商排行
│   ├── MiddleColumn           # 中栏
│   │   ├── ProviderSlots      # 供应商并发插槽
│   │   ├── TrafficTrend       # 24小时流量趋势
│   │   └── ModelDistribution  # 模型调用分布
│   └── RightColumn            # 右栏
│       └── ActivityStream     # 实时活动流
└── Footer                      # 底部状态栏

### 数据仓库

| 文件 | 说明 |
|------|------|
| `src/repository/activity-stream.ts` | 活动流查询 |
| `src/repository/leaderboard.ts` | 排行榜查询 |
| `src/lib/session-tracker.ts` | Session 追踪（686 行） |

### 国际化

| 文件 | 说明 |
|------|------|
| `messages/zh-CN/bigScreen.json` | 简体中文翻译 |
| `messages/zh-TW/bigScreen.json` | 繁体中文翻译 |
| `messages/en/bigScreen.json` | 英语翻译 |
| `messages/ja/bigScreen.json` | 日语翻译 |
| `messages/ru/bigScreen.json` | 俄语翻译 |

### 依赖

| 依赖 | 用途 |
|------|------|
| `swr` | 数据获取和缓存 |
| `recharts` | 图表（面积图、饼图） |
| `framer-motion` | 动画效果 |
| `lucide-react` | 图标 |
| `next-intl` | 国际化 |

## 最佳实践

### 部署建议

1. **Redis 配置**：确保 Redis 可用，用于准确的并发计数和 session 追踪
2. **大屏幕优化**：建议使用 Chrome 或 Edge 浏览器，分辨率 1920x1080 或更高
3. **刷新频率**：默认 2 秒刷新适合大多数场景，过高频率可能增加服务器负载

### 生产环境配置

在生产环境中部署数据大屏时，建议进行以下配置：

#### Nginx 反向代理配置

```nginx
# 为数据大屏配置较长的超时时间
location /internal/dashboard/big-screen {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    
    # 数据大屏使用 Server Actions，需要较长的超时
    proxy_read_timeout 30s;
    proxy_connect_timeout 30s;
}
```

#### Docker Compose 配置

```yaml
services:
  app:
    image: claude-code-hub:latest
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://...
      - SESSION_TTL=300000
    depends_on:
      - redis
      - postgres
    
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    # 确保 Redis 持久化，避免重启后 session 数据丢失
    command: redis-server --appendonly yes
```

#### 监控与告警

建议为数据大屏的关键指标设置告警：

| 指标 | 告警阈值 | 说明 |
|------|----------|------|
| 并发数 | > 1000 | 系统负载过高 |
| 错误率 | > 5% | 服务质量下降 |
| 平均响应时间 | > 5000ms | 响应过慢 |
| 今日成本 | > 预算的 80% | 成本预警 |

### 使用场景示例

#### 场景一：运维监控室

在运维监控室的大屏幕上展示数据大屏：

1. 使用 Chrome 浏览器打开数据大屏页面
2. 按 F11 进入全屏模式
3. 选择合适的主题（通常深色模式更适合长时间观看）
4. 将刷新频率设置为 5-10 秒，减少对服务器的压力

#### 场景二：演示环境

在向客户演示时使用数据大屏展示系统能力：

1. 提前准备一些有流量的测试数据
2. 使用浅色模式，投影效果更好
3. 重点展示用户排行和模型分布
4. 可以临时增加刷新频率到 1 秒，增强实时感

#### 场景三：故障排查

当系统出现问题时，使用数据大屏快速定位：

1. 查看错误率指标，确认问题范围
2. 检查供应商排行，识别故障供应商
3. 观察活动流，查看具体的错误请求
4. 监控并发数变化，判断是否因流量激增导致

### 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 并发数显示为 0 | Redis 未连接 | 检查 Redis 配置和连接状态 |
| 数据不更新 | 权限问题 | 检查用户权限和 `allowGlobalUsageView` 设置 |
| 图表不显示 | 无今日数据 | 系统今日无请求记录，属正常情况 |
| 页面加载慢 | 数据量大 | 检查数据库索引和查询性能 |
| 活动流为空 | Session 追踪异常 | 检查 Redis 中的 session 数据 |
| 供应商插槽不显示 | 未设置并发限制 | 在供应商配置中设置 `limitConcurrentSessions` |

### 调试模式

在开发环境中，你可以通过以下方式调试数据大屏：

1. **查看原始数据**：在浏览器控制台执行 `window.__BIG_SCREEN_DATA__`
2. **检查 Redis**：使用 `redis-cli` 查看 session 数据
3. **查看日志**：检查服务器日志中的 `dashboard-realtime` 相关日志
4. **网络面板**：在浏览器开发者工具中查看 API 请求

## 技术细节

### 时区处理

所有时间相关的统计都基于系统配置的时区：

```typescript
// src/repository/leaderboard.ts
const timezone = await resolveSystemTimezone();
// 使用 SQL AT TIME ZONE 进行时区转换
```

### 计费模型来源

模型统计支持两种计费模型来源配置：

- **original**：优先使用 `originalModel`（用户请求的模型）
- **redirected**：优先使用 `model`（重定向后的实际模型）

配置项：`systemSettings.billingModelSource`

计费模型来源的选择影响模型分布统计的准确性：

| 场景 | 推荐配置 | 说明 |
|------|----------|------|
| 按用户请求计费 | `original` | 统计用户实际请求的模型分布 |
| 按实际调用计费 | `redirected` | 统计供应商实际处理的模型分布 |
| 混合计费模式 | `redirected` | 更准确地反映资源消耗 |

### 数据精度说明

数据大屏中的数值精度遵循以下规则：

| 数据类型 | 精度 | 示例 |
|----------|------|------|
| 成本 | 4 位小数 | $12.3456 |
| 响应时间 | 0 位小数 | 1234 ms |
| 百分比 | 1 位小数 | 99.9% |
| Token 数 | 0 位小数 | 12345 |
| 请求数 | 0 位小数 | 1000 |

### 时间戳处理

所有时间戳都使用 Unix 时间戳（毫秒）进行内部传输，在前端根据用户时区进行格式化显示：

```typescript
// 后端返回的时间戳
const startTime = 1704067200000;

// 前端格式化显示
const formatted = new Date(startTime).toLocaleTimeString(locale);
// 结果："08:00:00"（根据用户时区）
```

### 动画效果

1. **粒子背景**：Canvas 实现的浮动粒子效果
2. **数字滚动**：CountUp 组件实现数字变化动画
3. **脉冲指示器**：并发数卡片的呼吸灯效果
4. **列表动画**：活动流条目的进入/退出动画
5. **进度条动画**：用户排行的进度条填充动画

### 扩展开发

如果你需要扩展数据大屏的功能，可以参考以下模式：

```typescript
// 1. 在 dashboard-realtime.ts 中添加新的数据源
const [newDataResult] = await Promise.allSettled([
  // ... 其他数据源
  getNewData(),  // 你的新数据源
]);

// 2. 在返回数据中添加新字段
return {
  ok: true,
  data: {
    // ... 其他数据
    newData: newDataResult.status === "fulfilled" 
      ? newDataResult.value 
      : null,
  },
};

// 3. 在页面组件中使用新数据
const newData = data?.newData;
```

### 与其他监控功能的关系

数据大屏与 Claude Code Hub 的其他监控功能形成完整的监控体系：

| 功能 | 粒度 | 用途 |
|------|------|------|
| **数据大屏** | 实时/全局 | 运维监控室展示 |
| [仪表盘](/docs/monitoring/dashboard) | 实时/个人 | 用户个人使用统计 |
| [排行榜](/docs/monitoring/leaderboard) | 日/周/月 | 历史排名分析 |
| [活跃会话](/docs/monitoring/active-sessions) | 实时 | Session 详情查看 |
| [成本追踪](/docs/monitoring/cost-tracking) | 历史 | 成本分析和预算 |
| [Token 统计](/docs/monitoring/token-stats) | 历史 | Token 使用分析 |

数据大屏整合了上述多个功能的数据，提供了一个统一的全局视图。

### 安全注意事项

使用数据大屏时需要注意以下安全事项：

1. **权限控制**：确保只有授权用户才能访问数据大屏，避免敏感数据泄露
2. **屏幕保护**：在公共场合展示时，注意遮挡敏感信息（如具体用户名、API Key 等）
3. **数据脱敏**：如需在演示环境使用，建议对真实用户数据进行脱敏处理
4. **访问日志**：定期检查数据大屏的访问日志，发现异常访问行为

### 版本兼容性

数据大屏功能在不同版本中的变化：

| 版本 | 变更说明 |
|------|----------|
| v1.0.0 | 初始版本，基础数据展示 |
| v1.1.0 | 添加主题切换功能 |
| v1.2.0 | 添加多语言支持 |
| v1.3.0 | 优化图表渲染性能 |
| v1.4.0 | 添加供应商并发插槽可视化 |

### 贡献指南

如果你想为数据大屏功能贡献代码，请参考以下流程：

1. **Fork 仓库**：从 GitHub Fork 项目仓库
2. **创建分支**：基于 `main` 分支创建功能分支
3. **开发测试**：编写代码并添加单元测试
4. **提交 PR**：提交 Pull Request 并描述变更内容
5. **代码审查**：等待维护者审查并合并

数据大屏相关的主要代码位于：
- `src/app/[locale]/internal/dashboard/big-screen/` - 页面组件
- `src/actions/dashboard-realtime.ts` - 数据聚合
- `messages/*/bigScreen.json` - 国际化翻译
