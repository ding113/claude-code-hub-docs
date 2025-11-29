---
dimensions:
  type:
    primary: operational
    detail: overview
  level: beginner
standard_title: 仪表盘概览
language: zh
---

# 仪表盘概览

Claude Code Hub 提供了功能丰富的管理仪表盘，让您能够实时监控系统状态、追踪使用情况并快速响应异常。本文档介绍仪表盘的核心功能和使用方法。

---

## 统计面板

仪表盘首页展示四个核心指标卡片，帮助您快速了解系统整体状态。

### 总请求数

**指标名称**：今日请求数（Today Requests）

**数据来源**：统计当日 00:00 至当前时刻的所有 API 请求数量。

**计算逻辑**：

```sql
SELECT COUNT(*) FROM message_request
WHERE created_at >= TODAY_START
```

**应用场景**：
- 评估系统负载趋势
- 对比历史同期数据
- 预估当日最终请求量

### 成功率

**指标名称**：今日错误率（Today Error Rate）

**计算公式**：

```
成功率 = 100% - 错误率
错误率 = (5xx 响应数 / 总请求数) * 100%
```

**数据来源**：统计 HTTP 状态码为 5xx 的请求占比。

**健康标准**：

| 错误率 | 状态 | 建议操作 |
|--------|------|----------|
| < 1% | 健康 | 无需处理 |
| 1% - 5% | 警告 | 检查供应商状态 |
| > 5% | 异常 | 立即排查原因 |

### 平均响应时间

**指标名称**：平均响应时间（Avg Response Time）

**计算逻辑**：

```sql
SELECT AVG(duration_ms) FROM message_request
WHERE created_at >= TODAY_START
  AND status_code = 200
```

**显示格式**：
- < 1000ms：显示毫秒数（如 `850ms`）
- >= 1000ms：显示秒数（如 `1.2s`）

**性能基准**：

| 响应时间 | 评价 | 说明 |
|----------|------|------|
| < 500ms | 优秀 | 代理开销极低 |
| 500ms - 2s | 正常 | 符合预期 |
| > 2s | 较慢 | 需检查网络或供应商 |

### Token 消耗

**指标名称**：今日消耗（Today Cost）

**数据组成**：

```typescript
interface TokenUsage {
  inputTokens: number;      // 输入 Token
  outputTokens: number;     // 输出 Token
  cacheCreationTokens: number;  // 缓存创建 Token
  cacheReadTokens: number;      // 缓存读取 Token
}
```

**费用计算**：

```
总费用 = (输入Token * 输入单价) + (输出Token * 输出单价)
       + (缓存创建Token * 缓存创建单价) + (缓存读取Token * 缓存读取单价)
```

**货币显示**：支持多种货币单位，通过系统设置中的 `currencyDisplay` 配置。

---

## 实时监控大屏

### 24 小时趋势图

仪表盘中央展示过去 24 小时的使用趋势，支持多维度数据展示。

**图表类型**：面积堆叠图 + 折线图

**数据维度**：

1. **按用户分组**（管理员视图）
   - 每个用户一条曲线
   - 颜色自动分配
   - 支持点击图例显示/隐藏

2. **按密钥分组**（普通用户视图）
   - 显示自己的 API 密钥使用情况
   - 如开启全局视图，额外显示"其他用户"汇总

**时间范围选择**：

| 选项 | 数据粒度 | 数据点数 |
|------|----------|----------|
| 24 小时 | 1 小时 | 24 个 |
| 7 天 | 1 天 | 7 个 |
| 30 天 | 1 天 | 30 个 |
| 90 天 | 1 天 | 90 个 |

**交互功能**：
- 鼠标悬停显示详细数值
- 点击图例切换显示
- 支持缩放和平移

### 供应商状态卡片

右侧面板实时展示各供应商的运行状态。

**状态指示**：

| 状态 | 图标 | 含义 |
|------|------|------|
| 健康 | 绿色圆点 | 熔断器关闭，正常服务 |
| 半开 | 黄色圆点 | 熔断器半开，测试恢复中 |
| 熔断 | 红色圆点 | 熔断器开启，已停止转发 |
| 禁用 | 灰色圆点 | 人工禁用 |

**显示信息**：

```typescript
interface ProviderStatus {
  name: string;           // 供应商名称
  status: 'healthy' | 'half-open' | 'open' | 'disabled';
  activeSessions: number; // 当前活跃会话数
  todayRequests: number;  // 今日请求数
  errorRate: number;      // 错误率
  avgLatency: number;     // 平均延迟
}
```

### 热力图展示

活跃 Session 列表以卡片形式展示当前正在运行的会话。

**列表字段**：

| 字段 | 说明 |
|------|------|
| Session ID | 会话唯一标识（显示前 8 位） |
| 用户 | 发起请求的用户名 |
| 供应商 | 当前绑定的供应商 |
| 模型 | 使用的模型名称 |
| 状态 | in_progress / completed / error |
| 耗时 | 从请求开始至今的时间 |
| Token | 已消耗的 Token 数量 |

**刷新策略**：
- 自动刷新间隔：5 秒
- 仅管理员可见完整列表
- 最多显示 10 条活跃会话

---

## 关键指标

### 活跃用户数

**定义**：在选定时间范围内发起过至少一次请求的独立用户数量。

**统计口径**：

```sql
SELECT COUNT(DISTINCT user_id) FROM message_request
WHERE created_at >= TIME_RANGE_START
```

**用户视图差异**：

| 角色 | 可见范围 |
|------|----------|
| 管理员 | 所有用户 |
| 普通用户（全局视图开启） | 自己 + 其他用户汇总 |
| 普通用户（全局视图关闭） | 仅自己 |

### 活跃 Session 数

**定义**：当前正在进行中的会话数量。

**判定标准**：
- 5 分钟内有请求活动
- Session 信息存在于 Redis

**数据来源**：

```typescript
// 从 Redis ZSET 统计
const count = await redis.zcount(
  "global:active_sessions",
  fiveMinutesAgo,
  "+inf"
);
```

**分级统计**：

| 级别 | Redis Key | 用途 |
|------|-----------|------|
| 全局 | `global:active_sessions` | 系统总并发 |
| 用户级 | `key:{keyId}:active_sessions` | 用户并发限制 |
| 供应商级 | `provider:{providerId}:active_sessions` | 供应商负载分布 |

### 供应商健康度

**健康度计算**：

```typescript
interface ProviderHealth {
  circuitState: 'closed' | 'half-open' | 'open';
  failureCount: number;
  failureThreshold: number;
  lastFailureTime: number;
  successCount: number;  // 半开状态下的成功次数
}
```

**健康度指标**：

| 指标 | 健康标准 | 说明 |
|------|----------|------|
| 熔断状态 | closed | 正常服务 |
| 失败计数 | < 阈值 50% | 有缓冲空间 |
| 错误率 | < 5% | 近期请求成功率高 |

---

## 快捷操作

### 刷新数据

**手动刷新**：点击页面右上角刷新按钮，立即获取最新数据。

**自动刷新**：

```typescript
const REFRESH_INTERVAL = 5000; // 5 秒

const { data } = useQuery({
  queryKey: ["overview-data"],
  queryFn: fetchOverviewData,
  refetchInterval: REFRESH_INTERVAL,
});
```

**刷新范围**：
- 概览指标（并发数、请求数、消耗、响应时间）
- 活跃 Session 列表
- 供应商状态

### 时间范围选择

趋势图支持多种时间范围选择：

```typescript
const TIME_RANGE_OPTIONS = [
  { key: "24h", label: "24 小时", resolution: "hour" },
  { key: "7d", label: "7 天", resolution: "day" },
  { key: "30d", label: "30 天", resolution: "day" },
  { key: "90d", label: "90 天", resolution: "day" },
];
```

**切换方式**：点击图表上方的时间范围选择器。

**数据缓存**：切换时间范围后会重新请求数据，之前的数据不缓存。

### 导出报表

**导出格式**：CSV / JSON

**导出内容**：
- 时间范围内的统计汇总
- 按用户/密钥分组的详细数据
- 请求日志明细

**导出入口**：
1. 点击图表右上角导出按钮
2. 选择导出格式
3. 选择数据范围
4. 下载文件

---

## 权限控制

仪表盘根据用户角色显示不同内容：

### 管理员视图

| 功能 | 可见性 | 说明 |
|------|--------|------|
| 概览面板 | 可见 | 全部四个指标 |
| 活跃 Session 列表 | 可见 | 所有用户的会话 |
| 趋势图 | 按用户分组 | 显示所有用户数据 |
| 供应商状态 | 可见 | 完整健康状态 |
| 用户快速概览 | 可见 | 所有用户卡片 |

### 普通用户视图

| 功能 | 可见性 | 说明 |
|------|--------|------|
| 概览面板 | 不可见 | 无全局指标权限 |
| 活跃 Session 列表 | 不可见 | 无跨用户查看权限 |
| 趋势图 | 按密钥分组 | 仅显示自己的数据 |
| 供应商状态 | 不可见 | 无运维权限 |
| 用户快速概览 | 部分可见 | 仅自己的统计 |

### 全局视图开关

系统设置中的 `allowGlobalUsageView` 开关影响普通用户可见范围：

```typescript
const canViewGlobalData = isAdmin || settings.allowGlobalUsageView;
```

开启后，普通用户可以看到：
- 自己的密钥明细
- 其他用户的汇总数据（不显示具体用户）

---

## 页面导航

仪表盘提供以下子页面快捷入口：

| 页面 | 路径 | 说明 |
|------|------|------|
| Session 详情 | `/dashboard/sessions` | 活跃会话完整列表 |
| 请求日志 | `/dashboard/logs` | 历史请求记录查询 |
| 排行榜 | `/dashboard/leaderboard` | 用户消费排名 |
| 配额管理 | `/dashboard/quotas` | 用户配额设置 |
| 限流状态 | `/dashboard/rate-limits` | 限流规则与触发记录 |
| 可用性统计 | `/dashboard/availability` | 供应商可用性报告 |
| 用户管理 | `/dashboard/users` | 用户账号管理 |

---

## 常见问题

### 数据不更新

**可能原因**：
1. 浏览器缓存问题
2. WebSocket 连接断开
3. API 请求失败

**解决方法**：
1. 手动点击刷新按钮
2. 刷新浏览器页面
3. 检查网络连接
4. 查看浏览器控制台错误

### 指标显示异常

**现象**：数值显示为 0 或异常大

**排查步骤**：
1. 检查时间范围选择是否正确
2. 确认数据库连接正常
3. 查看服务端日志
4. 验证 Redis 连接状态

### 权限不足

**现象**：看不到预期的数据

**解决方法**：
1. 确认当前用户角色
2. 检查 `allowGlobalUsageView` 设置
3. 联系管理员调整权限

---

## 相关文档

- [Session 管理](/docs/session-management) - 会话机制详解
- [供应商管理](/docs/provider-management) - 供应商配置指南
- [限流配置](/docs/rate-limiting) - 请求频率控制
- [熔断器](/docs/circuit-breaker) - 故障隔离机制
