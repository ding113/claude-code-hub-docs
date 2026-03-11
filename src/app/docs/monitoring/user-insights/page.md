---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 用户洞察
language: zh
---

# 用户洞察

用户洞察是面向管理员的分析工具，提供单个用户的详细使用统计。通过按模型和供应商两个维度的拆分分析，管理员可以深入了解每位用户的 API 调用模式、成本分布和 Token 消耗情况。

{% callout type="note" title="管理员专属" %}
用户洞察页面仅对管理员开放。非管理员用户访问时将被重定向到排行榜页面。
{% /callout %}

## 访问路径

用户洞察页面的访问路径为：

```
/dashboard/leaderboard/user/{userId}
```

**进入方式**：在用户排行榜中，管理员点击用户名即可进入该用户的洞察页面。页面顶部提供返回排行榜的按钮。

## 概览指标

页面顶部显示用户的总体概览指标卡片，包含当前值及与上一周期的对比变化：

| 指标 | 说明 |
|------|------|
| 总请求数 | 该用户的 API 请求总次数 |
| 总成本 | 累计消费金额（按系统配置的货币单位显示） |
| 总 Token 数 | 输入 + 输出 + 缓存创建 + 缓存读取 Token 总和 |

概览数据通过 `getOverviewWithCache` 获取，使用 Redis 缓存提升性能。

## 按模型拆分统计

模型拆分视图展示该用户在各个 AI 模型上的使用情况，按成本降序排列。

**每个模型显示以下指标**：

| 指标 | 说明 |
|------|------|
| 请求数 | 该模型的请求次数 |
| 成本 | 该模型的消费金额 |
| 输入 Token | 输入 Token 数 |
| 输出 Token | 输出 Token 数 |
| 缓存创建 Token | 缓存创建输入 Token 数 |
| 缓存读取 Token | 缓存读取输入 Token 数 |

**模型字段来源**：根据系统设置中的 `billingModelSource` 决定：
- `original`：优先使用 `originalModel`（用户请求的模型），回退到 `model`
- `redirected`：优先使用 `model`（重定向后的实际模型），回退到 `originalModel`

## 按供应商拆分统计

供应商拆分视图展示该用户在各个供应商上的使用分布，按成本降序排列。

**每个供应商显示以下指标**：

| 指标 | 说明 |
|------|------|
| 请求数 | 该供应商的请求次数 |
| 成本 | 该供应商的消费金额 |
| 输入 Token | 输入 Token 数 |
| 输出 Token | 输出 Token 数 |
| 缓存创建 Token | 缓存创建输入 Token 数 |
| 缓存读取 Token | 缓存读取输入 Token 数 |

数据通过 `usageLedger` 表与 `providers` 表的 JOIN 查询获取，按 `finalProviderId` 分组。

## 趋势图表

用户洞察包含按密钥维度的趋势图表（Key Trend Chart），展示该用户各 API Key 随时间的使用变化。趋势数据通过 `getStatisticsWithCache` 获取。

## 筛选条件

页面提供多维筛选栏，支持以下筛选维度：

| 筛选项 | 说明 | 影响范围 |
|--------|------|----------|
| 时间范围 | 选择统计的时间周期 | 模型拆分、供应商拆分、趋势图表 |
| API Key | 按特定密钥筛选 | 模型拆分、趋势图表 |
| 供应商 | 按特定供应商筛选 | 模型拆分 |
| 模型 | 按特定模型筛选 | 供应商拆分 |

### 时间范围预设

| 预设 | 说明 |
|------|------|
| 今日 | 当前日期 |
| 近7天 | 过去7天（含今日） |
| 近30天 | 过去30天（含今日） |
| 本月 | 当月1日至今日 |

默认时间范围为**近7天**。

{% callout type="note" title="交叉筛选" %}
模型拆分和供应商拆分支持交叉筛选。例如，选择特定供应商后，模型拆分将仅展示该供应商上使用的模型统计；选择特定模型后，供应商拆分将仅展示处理该模型请求的供应商。
{% /callout %}

## 数据来源

用户洞察的数据来自以下数据层：

- **概览指标**：`overview` 缓存层（`getOverviewWithCache`）
- **模型拆分**：`admin-user-insights` repository 的 `getUserModelBreakdown` 函数
- **供应商拆分**：`admin-user-insights` repository 的 `getUserProviderBreakdown` 函数
- **趋势图表**：`statistics` 缓存层（`getStatisticsWithCache`）

所有查询均使用 `LEDGER_BILLING_CONDITION` 过滤条件，排除已删除和预热请求。

## 相关文档

- [排行榜](/docs/monitoring/leaderboard) - 排行榜功能与维度详解
- [成本追踪](/docs/monitoring/cost-tracking) - 成本计算与计费机制
- [统计图表](/docs/monitoring/charts) - 可视化时间序列数据
- [Token 统计](/docs/monitoring/token-stats) - Token 使用详情
