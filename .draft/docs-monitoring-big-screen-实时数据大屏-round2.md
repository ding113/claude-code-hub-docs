# 实时数据大屏 (Real-time Data Big Screen)

## 功能概述

实时数据大屏是 Claude Code Hub 的集中式监控仪表盘，为系统管理员提供全站运行状态的实时可视化展示。该功能以全屏沉浸式界面呈现关键系统指标、用户活动、供应商性能等数据，适用于运维监控室展示或大型显示器实时展示。

### 核心功能

1. **实时系统监控**: 展示当前并发会话数、今日请求总量、成本消耗、平均响应时间和错误率
2. **运营可见性**: 显示活跃用户排行、供应商性能排行、供应商并发插槽使用情况
3. **模型使用分析**: 展示各模型的调用分布情况
4. **流量趋势追踪**: 24小时请求量趋势图表
5. **实时活动流**: 展示最近的请求活动记录

### 适用场景

- 运维团队监控 Claude Code Hub 代理系统的运行状态
- 管理团队查看资源使用情况和成本分布
- 演示环境展示系统能力和活跃度
- 故障排查时快速定位问题

---

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

1. **管理员权限**: 用户角色为 `admin`
2. **全局查看权限**: 系统设置中 `allowGlobalUsageView` 设置为 `true`

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

---

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

### 主题支持

数据大屏支持两种视觉主题：

#### 深色模式（默认）

- **背景**: `#0a0a0f`（近黑色）
- **卡片背景**: `#1a1a2e/60` 带毛玻璃效果
- **文字颜色**: `#e6e6e6`（浅灰）
- **强调色**: `#ff6b35`（橙色）
- **边框**: `border-white/5`

#### 浅色模式

- **背景**: `#fafafa`（浅灰白）
- **卡片背景**: `white/80` 带毛玻璃效果
- **文字颜色**: `#1a1a1a`（深灰）
- **强调色**: `#ff5722`（橙红）
- **边框**: `border-black/5`

主题切换按钮位于页面右上角。

---

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

**来源**: `src/actions/overview.ts` - `getOverviewData()`

| 字段 | 说明 | 计算方式 |
|------|------|----------|
| `concurrentSessions` | 当前并发会话数 | Redis 全局活跃 session 计数 |
| `todayRequests` | 今日请求数 | 数据库今日请求聚合 |
| `todayCost` | 今日成本 | 数据库今日成本求和 |
| `avgResponseTime` | 平均响应时间 | 今日请求耗时平均值 |
| `todayErrorRate` | 今日错误率 | 错误请求数 / 总请求数 |

### 实时活动流

**来源**: `src/repository/activity-stream.ts` - `findRecentActivityStream()`

活动流采用混合数据源策略：

1. **Redis 活跃 Session**: 从 Redis 获取活跃 session ID 列表
2. **数据库查询**: 查询这些 session 的最新请求（每个 session 取最新1条）
3. **数据补充**: 如果不足 limit 条，补充数据库最新请求
4. **去重排序**: 按创建时间降序排序并去重

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
- **用户**: 发起请求的用户名
- **模型**: 使用的 AI 模型
- **供应商**: 请求路由到的供应商
- **耗时**: 请求处理时间（>1000ms 标红）
- **状态**: HTTP 状态码（200 绿色，其他红色）

### 用户消耗排行

**来源**: `src/repository/leaderboard.ts` - `findDailyLeaderboard()`

展示今日消耗 Top 5 用户：

| 字段 | 说明 |
|------|------|
| `userName` | 用户名称 |
| `totalCost` | 今日总成本 |
| `totalRequests` | 今日请求数 |
| `totalTokens` | 今日总 Token 数 |

排行条目包含进度条可视化，显示相对于第一名的消耗比例。

### 供应商排行

**来源**: `src/repository/leaderboard.ts` - `findDailyProviderLeaderboard()`

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

**来源**: `src/actions/provider-slots.ts` - `getProviderSlots()`

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

**过滤与排序规则**:
1. 只显示设置了并发限额（`totalSlots > 0`）的供应商
2. 按占用率（`usedSlots / totalSlots`）降序排序
3. 最多显示前 3 个供应商

**视觉指示**:
- **正常** (< 70%): 蓝色渐变进度条
- **警告** (70%-90%): 黄色到橙色渐变
- **危险** (> 90%): 红色渐变

### 模型调用分布

**来源**: `src/repository/leaderboard.ts` - `findDailyModelLeaderboard()`

以环形饼图展示模型使用分布：

| 字段 | 说明 |
|------|------|
| `model` | 模型名称 |
| `totalRequests` | 请求数量 |
| `totalCost` | 总成本 |
| `totalTokens` | 总 Token 数 |
| `successRate` | 成功率 |

**配色方案**:
```typescript
const COLORS = {
  models: ["#ff6b35", "#00d4ff", "#ffd60a", "#00ff88", "#a855f7"],
};
```

### 24小时流量趋势

**来源**: `src/actions/statistics.ts` - `getUserStatistics("today")`

展示今日每小时的请求量趋势：

- **图表类型**: 面积图（Area Chart）
- **X轴**: 小时（0-23）
- **Y轴**: 请求数量
- **线条颜色**: `#ff6b35`（橙色）
- **填充**: 渐变填充，透明度从 0.3 到 0

数据只显示到当前小时（过滤未来时间）。

---

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

- **自动刷新**: 每 2 秒自动获取最新数据
- **手动刷新**: 点击右上角刷新按钮可立即刷新
- **错误处理**: 刷新失败时保持上次成功数据，不中断显示

---

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

**追踪流程**:

1. **Session 创建**: `trackSession()` - 将 session 添加到全局和 key 级集合
2. **Provider 更新**: `updateProvider()` - 将 session 添加到 provider 级集合
3. **Session 刷新**: `refreshSession()` - 更新所有相关 ZSET 的时间戳
4. **过期清理**: `countFromZSet()` - 清理 5 分钟前的过期 session

### 并发计数

每个 session 维护独立的并发计数：

```typescript
// Key: session:${sessionId}:concurrent_count
// TTL: 10 分钟
```

- **请求开始**: `incrementConcurrentCount()` - 计数 +1
- **请求结束**: `decrementConcurrentCount()` - 计数 -1

---

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

---

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

### 批量查询优化

- **Provider Session 计数**: 使用 `getProviderSessionCountBatch()` 避免 N+1 查询
- **Session 并发计数**: 使用 `getConcurrentCountBatch()` 批量获取

---

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

---

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

---

## 最佳实践

### 部署建议

1. **Redis 配置**: 确保 Redis 可用，用于准确的并发计数和 session 追踪
2. **大屏幕优化**: 建议使用 Chrome 或 Edge 浏览器，分辨率 1920x1080 或更高
3. **刷新频率**: 默认 2 秒刷新适合大多数场景，过高频率可能增加服务器负载

### 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 并发数显示为 0 | Redis 未连接 | 检查 Redis 配置和连接状态 |
| 数据不更新 | 权限问题 | 检查用户权限和 `allowGlobalUsageView` 设置 |
| 图表不显示 | 无今日数据 | 系统今日无请求记录，属正常情况 |
| 页面加载慢 | 数据量大 | 检查数据库索引和查询性能 |

---

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

- **original**: 优先使用 `originalModel`（用户请求的模型）
- **redirected**: 优先使用 `model`（重定向后的实际模型）

配置项：`systemSettings.billingModelSource`

### 动画效果

1. **粒子背景**: Canvas 实现的浮动粒子效果
2. **数字滚动**: CountUp 组件实现数字变化动画
3. **脉冲指示器**: 并发数卡片的呼吸灯效果
4. **列表动画**: 活动流条目的进入/退出动画
5. **进度条动画**: 用户排行的进度条填充动画
