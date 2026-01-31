---
title: 排行榜
description: Claude Code Hub 排行榜功能提供全面的使用量统计和排名，支持用户、供应商、模型和缓存命中率等多个维度的分析。
---

# 排行榜

排行榜是 Claude Code Hub 的监控分析工具，帮助你追踪 API 使用量、比较性能指标，并深入了解系统的消费模式。无论你是管理员还是普通用户，都可以通过排行榜获取有价值的使用洞察。

{% callout type="note" title="功能概述" %}
排行榜支持以下四个分析维度：
- **用户排行**：按 API 消费量排名
- **供应商排行**：按使用量和性能指标排名
- **缓存命中率排行**：分析供应商的缓存效率
- **模型排行**：按使用频率排名
{% /callout %}

## 访问权限

排行榜的访问权限由系统配置控制：

| 用户角色 | 访问范围 |
|---------|---------|
| 管理员 | 所有排行榜维度（用户、供应商、模型、缓存命中率） |
| 普通用户（全局查看开启） | 用户排行榜 |
| 普通用户（全局查看关闭） | 仅个人数据 |

要开启普通用户的全局查看权限，管理员需要在**系统设置**中启用 `allowGlobalUsageView` 选项。

{% callout type="warning" title="权限提示" %}
如果你没有排行榜访问权限，系统会显示提示信息，建议你联系管理员开启权限。
{% /callout %}

## 排行榜维度详解

### 用户排行

用户排行展示系统中各用户的 API 使用情况，按总消费金额降序排列。

**显示指标**：
- 总请求数
- 总消费金额（按系统设置的货币单位显示）
- 总 Token 数（包含输入、输出、缓存创建和缓存读取 Token）

**筛选选项**（仅管理员可用）：
- 用户标签：筛选具有特定标签的用户（支持多选，OR 逻辑）
- 用户组：筛选属于特定组的用户（支持多选，OR 逻辑）

### 供应商排行

供应商排行帮助你了解各 LLM 供应商的使用情况和性能表现。

**显示指标**：
- 总请求数
- 总消费金额
- 总 Token 数
- 成功率（成功请求 / 总请求）
- 平均首字节时间（TTFB，毫秒）
- 平均每秒 Token 数（生成速度）

**筛选选项**：
- 供应商类型：Claude、Claude-auth、Codex、Gemini、Gemini-cli、OpenAI-compatible

**每秒 Token 数计算方式**：
```
tokensPerSecond = outputTokens / ((durationMs - ttfbMs) / 1000.0)
```

计算仅在以下条件满足时进行：
- 输出 Token 数大于 0
- 响应时间和首字节时间已记录
- 首字节时间小于总响应时间
- 生成时间（总时间减去首字节时间）至少 100 毫秒

### 缓存命中率排行

缓存命中率排行帮助你分析供应商的缓存效率，优化成本支出。

**显示指标**：
- 缓存命中率（0-100%）
- 缓存读取 Token 数
- 缓存创建成本
- 总输入 Token 数（输入 + 缓存创建 + 缓存读取）

**缓存命中率计算公式**：
```
cacheHitRate = cacheReadTokens / (inputTokens + cacheCreationInputTokens + cacheReadTokens)
```

**特殊说明**：
- 仅统计有缓存活动的请求（缓存创建或读取 Token 大于 0）
- 按缓存命中率降序排列，命中率相同时按请求数降序排列

### 模型排行

模型排行展示各 AI 模型的使用频率分布。

**显示指标**：
- 总请求数
- 总消费金额
- 总 Token 数
- 成功率

**排序方式**：按请求数降序排列（与其他维度按消费金额排序不同）

**模型来源配置**：
系统设置中的 `billingModelSource` 决定使用哪个模型字段进行统计：
- `original`：使用用户请求的原始模型名称
- `redirected`：使用重定向后的实际模型名称

## 时间周期选择

排行榜支持多种时间周期，适应不同的分析需求：

| 周期 | 说明 |
|-----|------|
| 今日 | 当前日历日（按系统时区计算） |
| 本周 | 当前 ISO 周（按系统时区计算） |
| 本月 | 当前日历月（按系统时区计算） |
| 全部 | 所有历史数据 |
| 自定义 | 用户指定的日期范围 |

### 日期导航

排行榜界面提供便捷的日期导航：
- 快速选择按钮：一键切换到今日、本周、本月或全部
- 自定义日期选择器：通过日历界面选择任意日期范围
- 箭头导航：快速切换到上一个或下一个周期

{% callout type="note" title="时区说明" %}
所有日期计算都基于系统配置的时区。确保在系统设置中正确配置时区，以获得准确的日报表。
{% /callout %}

## 界面功能

### 表格排序

排行榜表格支持客户端排序，点击列标题即可按该列排序：
- 点击一次：升序排列
- 点击两次：降序排列
- 点击三次：恢复默认排序

### 排名标识

前三名会显示奖牌图标，便于快速识别领先者：
- 🥇 第一名（金色）
- 🥈 第二名（银色）
- 🥉 第三名（铜色）

### 空状态提示

当所选周期没有数据时，系统会显示周期特定的提示信息：
- 今日无数据
- 本周无数据
- 本月无数据
- 暂无数据

### URL 状态同步

排行榜的状态会同步到 URL 参数，方便分享和收藏：
```
/dashboard/leaderboard?period=daily&scope=user
```

支持的 URL 参数：
- `period`：时间周期（daily、weekly、monthly、allTime、custom）
- `scope`：排行榜维度（user、provider、providerCacheHitRate、model）
- `startDate` 和 `endDate`：自定义日期范围（YYYY-MM-DD 格式）

## API 接口

### 获取排行榜数据

```bash
GET /api/leaderboard?period={period}&scope={scope}
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----|------|-----|------|
| period | string | 是 | 时间周期：daily、weekly、monthly、allTime、custom |
| scope | string | 是 | 排行榜维度：user、provider、providerCacheHitRate、model |
| startDate | string | 自定义周期必填 | 开始日期，格式 YYYY-MM-DD |
| endDate | string | 自定义周期必填 | 结束日期，格式 YYYY-MM-DD |
| providerType | string | 否 | 供应商类型筛选 |
| userTags | string | 否 | 用户标签筛选，逗号分隔 |
| userGroups | string | 否 | 用户组筛选，逗号分隔 |

**示例请求**：

```bash
# 获取今日用户排行
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=daily&scope=user"

# 获取本周供应商排行
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=weekly&scope=provider"

# 获取自定义日期范围的用户排行，筛选特定标签
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=custom&scope=user&startDate=2025-01-01&endDate=2025-01-31&userTags=premium,vip"

# 获取 Claude 供应商的缓存命中率
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=daily&scope=providerCacheHitRate&providerType=claude"
```

**响应头**：
```
Cache-Control: public, s-maxage=60, stale-while-revalidate=120
```

**错误响应**：
- `401`：未登录
- `403`：无权限访问
- `400`：参数错误（附带具体错误信息）

## 数据计算说明

### Token 统计

排行榜中的总 Token 数包含以下部分：
```
totalTokens = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens
```

所有 Token 字段都使用 `COALESCE` 函数处理，将 NULL 值视为 0。

### 成功率计算

```
successRate = successfulRequests / totalRequests
```

成功请求的定义：`errorMessage` 为 NULL 或空字符串。

### 数据排除规则

以下记录不会计入排行榜统计：
- 已删除的请求（`deletedAt IS NULL`）
- 预热请求（`blockedBy <> 'warmup'`）
- 已删除的用户或供应商
- 模型名称为 NULL 或空字符串（模型排行）

## 缓存机制

排行榜实现了基于 Redis 的乐观缓存，提升查询性能：

**缓存策略**：
- 缓存有效期：60 秒
- 分布式锁有效期：10 秒
- 重试机制：最多 50 次，每次间隔 100 毫秒

**缓存键格式**：
```
leaderboard:{scope}:{period}:{date}:{currency}{filterSuffix}
```

**示例**：
- `leaderboard:user:daily:2025-01-29:USD`
- `leaderboard:provider:weekly:2025-W04:USD:provider=claude`
- `leaderboard:user:custom:2025-01-01_2025-01-29:USD:tags=premium,vip`

**缓存失效场景**：
- 超过 60 秒 TTL 自动过期
- 手动调用缓存清除接口
- Redis 不可用时自动降级为直接查询数据库

{% callout type="note" title="缓存降级" %}
当 Redis 不可用时，系统会自动降级为直接查询数据库，确保功能可用性。降级时会记录警告日志。
{% /callout %}

## 每日排行榜通知

系统支持自动发送每日排行榜通知，帮助你定时了解使用情况。

### 配置选项

在**系统设置**中配置以下选项：

| 选项 | 说明 | 默认值 |
|-----|------|-------|
| 每日排行榜通知 | 是否启用每日通知 | 关闭 |
| 发送时间 | 通知发送时间（HH:mm 格式） | 09:00 |
| 显示数量 | 排行榜显示的用户数量 | 5 |

### 通知内容

每日排行榜通知包含以下信息：
- 日期
- 前 N 名用户的排名（带奖牌图标）
- 各用户的请求数、消费金额和 Token 数
- 总计统计

### Webhook 格式

```json
{
  "date": "2025-01-29",
  "entries": [
    {
      "userId": 1,
      "userName": "用户名",
      "totalRequests": 100,
      "totalCost": 1.234,
      "totalTokens": 50000
    }
  ],
  "totalRequests": 500,
  "totalCost": 5.678
}
```

## 仪表盘集成

排行榜数据会显示在仪表盘上，提供快速概览：

- **今日排行榜卡片**：显示今日前三名的用户、供应商和模型
- **进度条可视化**：直观展示各条目的相对比例
- **快速跳转**：点击卡片可跳转到完整的排行榜页面

## 性能优化

### 数据库索引

排行榜查询使用以下索引优化性能：
- `idx_message_request_user_date_cost`：用户、日期、消费金额复合索引
- `idx_message_request_created_at`：创建时间索引
- `idx_message_request_provider_id`：供应商 ID 索引
- `idx_message_request_blocked_by`：预热排除部分索引

### 前端优化

- **骨架屏加载**：数据加载时显示占位 UI
- **客户端排序**：排序操作不触发新的服务器请求
- **记忆化计算**：使用 `useMemo` 优化复杂计算

## 最佳实践

### 管理员建议

1. **定期查看用户排行**：识别高消费用户，及时沟通使用情况
2. **监控供应商性能**：关注成功率和响应时间，及时调整供应商配置
3. **分析缓存命中率**：低缓存命中率可能意味着成本优化空间
4. **设置每日通知**：定时了解系统使用情况

### 故障排查

**排行榜数据为空**
- 检查所选时间周期是否正确
- 确认系统有请求记录
- 验证时区设置是否正确

**权限被拒绝**
- 联系管理员开启 `allowGlobalUsageView` 权限
- 管理员可在系统设置中修改此选项

**数据不准确**
- 检查 Redis 缓存是否过期（默认 60 秒）
- 确认请求未被标记为预热或删除
- 验证系统时区配置

## 相关功能

- [日志查询](/docs/monitoring/logs) - 查看详细的请求日志
- [成本追踪](/docs/monitoring/cost-tracking) - 深入了解成本计算
- [统计图表](/docs/monitoring/charts) - 可视化时间序列数据
- [Token 统计](/docs/monitoring/token-stats) - Token 使用详情
- [错误率统计](/docs/monitoring/error-stats) - 错误分析
