---
title: 可用性监控
nextjs:
  metadata:
    title: 可用性监控
    description: 了解 Claude Code Hub 如何监控供应商可用性、计算健康评分，并通过可视化仪表盘追踪系统状态
---

# 可用性监控

可用性监控系统持续追踪 AI 供应商的健康状态，基于实际请求历史计算可用性评分，并通过直观的仪表盘展示系统运行状况。这套系统让你能够及时发现供应商问题、分析历史趋势，并做出数据驱动的运维决策。

## 核心概念

### 状态分类

系统使用简洁的两级分类来标记请求结果：

| 状态 | 条件 | 含义 |
|------|------|------|
| **绿色** | HTTP 2xx/3xx 响应 | 请求成功 |
| **红色** | HTTP 4xx/5xx 响应或网络错误 | 请求失败 |
| **未知** | 无数据 | 数据不足，无法判断 |

{% callout type="warning" title="诚实原则" %}
当没有请求数据时，系统明确报告为"未知"状态，而不是假设供应商健康。这种诚实原则确保你不会被虚假的健康指标误导。
{% /callout %}

### 为什么使用两级分类

你可能会好奇为什么系统不使用更细粒度的状态（如黄色警告状态）。这是因为：

1. **简单即可靠** - 两级分类减少了决策复杂度，使系统行为更可预测
2. **明确的健康信号** - 50% 成功率阈值提供了清晰的二元判断标准
3. **避免过度工程** - 实际运行中，供应商通常要么健康（>95% 成功率），要么有问题（<50% 成功率），中间状态很少见

这种设计哲学贯穿整个可用性监控系统：诚实报告、简单决策、避免假设。

### 可用性评分计算

可用性评分是一个简单的成功率比例：

```
可用性评分 = 绿色请求数 / (绿色请求数 + 红色请求数)
```

评分范围从 0.0（完全不可用）到 1.0（100% 可用）。当评分大于等于 0.5（50% 成功率）时，供应商被视为健康状态。

### 时间分桶

为了可视化和分析，可用性数据被聚合到时间桶中。系统根据查询的时间范围自动确定最优的桶大小：

| 时间范围 | 桶大小 | 说明 |
|----------|--------|------|
| 短周期 | 1 分钟 | 适合查看最近的变化 |
| 中等周期 | 5-15 分钟 | 平衡细节与性能 |
| 长周期 | 1 小时或 1 天 | 适合长期趋势分析 |

最小桶大小为 0.25 分钟（15 秒），确保在短时间范围内也能获得有意义的数据分布。

## 可用性服务

可用性服务是系统的核心模块，负责收集、计算和提供可用性数据。它位于 `@/lib/availability` 模块中，提供了一组用于处理可用性相关任务的函数。

### 服务架构

可用性服务采用分层架构：

1. **数据收集层** - 从请求日志中提取状态信息
2. **计算层** - 聚合数据并计算评分
3. **查询层** - 提供灵活的查询接口
4. **缓存层** - 优化频繁查询的性能

### 请求状态分类

系统根据 HTTP 状态码对请求进行分类：

```typescript
import { classifyRequestStatus } from "@/lib/availability";

const result = classifyRequestStatus(200);
console.log(result); // { status: "green", isSuccess: true, isError: false }

const errorResult = classifyRequestStatus(500);
console.log(errorResult); // { status: "red", isSuccess: false, isError: true }

const networkError = classifyRequestStatus(null);
console.log(networkError); // { status: "red", isSuccess: false, isError: true }
```

**分类规则详解：**

- **状态码为 null** - 表示网络错误或超时，标记为红色
- **状态码 >= 400** - HTTP 错误（4xx 客户端错误、5xx 服务器错误），标记为红色
- **状态码 < 400** - HTTP 成功（2xx 成功、3xx 重定向），标记为绿色

这种分类方式确保所有类型的失败都被捕获，包括网络层问题和应用层错误。

### 计算可用性评分

你可以使用服务函数计算任意时间段内的可用性评分：

```typescript
import { calculateAvailabilityScore } from "@/lib/availability";

const score = calculateAvailabilityScore(95, 5);
console.log(score); // 0.95 (95% 可用性)
```

**计算逻辑：**

```typescript
function calculateAvailabilityScore(greenCount: number, redCount: number): number {
  const total = greenCount + redCount;
  if (total === 0) return 0; // 无数据时返回 0
  return greenCount / total;
}
```

注意当没有数据时返回 0 而不是 1，这再次体现了诚实原则——没有数据不代表 100% 可用。

### 查询历史可用性数据

获取指定时间范围内的可用性数据：

```typescript
import { queryAvailability } from "@/lib/availability";

const result = await queryAvailability({
  startTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 小时前
  endTime: new Date(),
  providerIds: [1, 2, 3], // 可选：限定供应商
  bucketSizeMinutes: 15,  // 可选：自定义桶大小
  includeDisabled: false, // 可选：包含已禁用的供应商
  maxBuckets: 100,        // 可选：最大桶数量
});

// 结果包含每个供应商的时间桶数据
result.forEach(item => {
  console.log(`${item.providerId} 在 ${item.timeBucket}: ${item.availability * 100}%`);
});
```

**查询性能考虑：**

- 查询会自动限制最多处理 10 万条请求记录
- 大数据量查询可能需要几秒时间
- 建议对频繁访问的数据使用缓存
- 使用合适的桶大小可以显著减少返回数据量

## API 接口

### 查询历史可用性

```
GET /api/availability
```

查询参数：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `startTime` | ISO 字符串 | 24 小时前 | 查询开始时间 |
| `endTime` | ISO 字符串 | 当前时间 | 查询结束时间 |
| `providerIds` | 逗号分隔的数字 | 全部 | 限定供应商 ID |
| `bucketSizeMinutes` | 数字 | 自动计算 | 时间桶大小（最小 0.25） |
| `includeDisabled` | 布尔值 | false | 包含已禁用的供应商 |
| `maxBuckets` | 数字 | 100 | 最大返回桶数量 |

响应示例：

```json
{
  "data": [
    {
      "providerId": 1,
      "providerName": "Anthropic 主账户",
      "timeBucket": "2025-01-28T12:00:00Z",
      "greenCount": 145,
      "redCount": 5,
      "availability": 0.967,
      "avgLatencyMs": 850
    }
  ]
}
```

### 获取当前状态

```
GET /api/availability/current
```

返回所有启用供应商的当前状态（基于最近 15 分钟数据）：

```json
{
  "data": [
    {
      "providerId": 1,
      "providerName": "Anthropic 主账户",
      "status": "green",
      "availability": 0.98,
      "totalRequests": 150,
      "avgLatencyMs": 820
    }
  ]
}
```

### 查询端点可用性

```
GET /api/availability/endpoints?vendorId=1&providerType=claude
```

按供应商和类型查询端点列表及其健康状态。

### 获取探测日志

```
GET /api/availability/endpoints/probe-logs?endpointId=1&limit=200
```

查询指定端点的探测历史记录。

## 仪表盘可视化

可用性仪表盘提供了一个直观的界面来监控系统健康状态。它位于仪表盘的"可用性"标签页下，分为供应商视图和端点视图两个主要区域。

### 概览卡片

仪表盘顶部的概览区域展示关键指标：

- **系统可用性** - 所有供应商的平均可用性百分比
- **平均延迟** - 所有请求的平均响应时间
- **错误率** - 红色请求占总请求的百分比
- **活跃探测数** - 当前正在监控的端点数量

这些指标基于你选择的时间范围计算。你可以通过时间选择器切换不同的时间窗口：15 分钟、1 小时、6 小时、24 小时或 7 天。

### 供应商泳道图

泳道图以热力图形式展示各供应商的可用性随时间变化：

**颜色编码：**

| 颜色 | 可用性范围 | 含义 |
|------|------------|------|
| 翠绿 | >= 95% | 优秀 |
| 黄绿 | 80-95% | 良好 |
| 橙色 | 50-80% | 一般 |
| 玫红 | < 50% | 较差 |
| 灰色 | 无数据 | 未知 |

**可视化模式：**

- **高流量模式**（>= 50 请求）：使用实心柱状图，高度表示请求量
- **低流量模式**（< 50 请求）：使用散点，大小表示请求量

**置信度指示器：**

每个数据点显示置信度徽章：
- 1 条（灰色）：低置信度（0-9 请求）
- 2 条（琥珀色）：中等置信度（10-49 请求）
- 3 条（翠绿）：高置信度（50+ 请求）

### 端点探测网格

以卡片网格形式展示所有端点的状态：

- 状态指示灯（绿色/红色/灰色）
- 最后探测时间
- 响应延迟
- 手动探测按钮

### 自动刷新

仪表盘支持自动刷新：
- 供应商标签页：每 30 秒
- 端点标签页：每 10 秒

## 与熔断器集成

可用性监控系统与熔断器紧密协作，共同确保系统稳定性。两者之间的关系可以用"监控"与"保护"来描述：可用性监控负责"观察"，熔断器负责"行动"。

### 健康检查流程

可用性监控与熔断器系统紧密集成，在供应商选择时执行多层健康检查：

```typescript
// 供应商选择时的健康过滤流程
1. 检查供应商-类型级熔断器
2. 检查供应商级熔断器
3. 检查成本限制（5小时、日、周、月）
4. 检查总成本限制
5. 检查并发会话限制
```

**过滤顺序的重要性：**

过滤按照从快到慢的顺序排列。熔断器检查在内存中完成，速度最快；成本限制需要查询 Redis 或数据库，相对较慢。这种排序确保不必要的查询被尽早跳过。

### 熔断器状态影响

当熔断器打开时：
- 供应商被排除在可用性计算之外
- 仪表盘显示熔断状态
- 请求不会路由到该供应商

当熔断器进入半开状态：
- 有限请求被允许通过以测试恢复
- 可用性数据重新开始收集
- 成功后逐渐恢复流量

### 数据一致性

可用性数据和熔断器状态可能存在短暂不一致：

- 熔断器刚打开时，可用性数据可能仍显示之前的健康状态
- 这是因为可用性基于历史数据，而熔断器基于实时状态
- 这种不一致是正常的，随着时间推移会自动修正

## 边缘情况处理

可用性监控系统经过精心设计，能够优雅地处理各种边缘情况。这些处理机制确保系统在各种异常条件下都能提供可靠的数据。

### 无数据处理

当供应商没有任何请求数据时：
- 状态明确标记为"未知"
- 不假设供应商健康
- 在仪表盘上以灰色显示

**为什么这是正确的做法：**

假设没有数据的供应商是健康的，可能会导致你忽略真正的问题。例如，如果一个供应商的配置错误导致所有请求都被拒绝，但请求本身没有到达系统（比如 DNS 解析失败），那么可用性数据将是空的。如果系统报告为"绿色"，你可能会误以为一切正常。

### 内存保护

为防止大数据查询导致内存问题：
- 单次查询最多处理 10 万条请求记录
- 超出限制时记录警告日志
- 返回部分结果并提示可能不完整

**实现细节：**

```typescript
const MAX_REQUESTS_PER_QUERY = 100000;

if (requests.length === MAX_REQUESTS_PER_QUERY) {
  logger.warn("[Availability] Query hit max request limit, results may be incomplete");
}
```

这种保护机制在以下场景尤为重要：
- 查询长时间范围（如 7 天）且请求量巨大
- 系统刚启动，正在处理积压数据
- 多个供应商同时有大量请求

### 探测请求排除

主动探测请求不会计入可用性计算：
- 避免健康检查本身影响统计数据
- 只统计实际业务请求
- 确保数据反映真实用户体验

**代码示例：**

```typescript
// 在请求转发逻辑中
if (session.isProbeRequest()) {
  logger.debug("Probe request error, skipping circuit breaker");
} else {
  await recordFailure(currentProvider.id, lastError);
}
```

这种区分确保了：
- 探测失败不会错误地降低可用性评分
- 业务请求的失败被准确记录
- 统计数据真实反映用户实际体验

### HTTP/2 回退

当遇到 HTTP/2 特定错误时：
- 自动回退到 HTTP/1.1 重试
- 不计入熔断器失败次数
- 记录错误类型用于分析

**错误类型识别：**

系统识别以下 HTTP/2 特定错误：
- `GOAWAY` - 服务器要求关闭连接
- `RST_STREAM` - 流被重置
- `PROTOCOL_ERROR` - 协议错误
- `ERR_HTTP2_*` - Node.js HTTP/2 错误
- `NGHTTP2_*` - nghttp2 库错误
- `HTTP_1_1_REQUIRED` - 需要降级到 HTTP/1.1
- `REFUSED_STREAM` - 流被拒绝

这些错误通常与网络环境或客户端配置有关，不代表供应商本身有问题。

## 配置选项

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENDPOINT_PROBE_INTERVAL_MS` | 60000 | 基础探测间隔（毫秒） |
| `ENDPOINT_PROBE_TIMEOUT_MS` | 5000 | 探测请求超时 |
| `ENDPOINT_PROBE_CONCURRENCY` | 10 | 并发探测工作线程数 |
| `ENDPOINT_PROBE_CYCLE_JITTER_MS` | 1000 | 每周期随机延迟，防止惊群效应 |
| `ENDPOINT_PROBE_LOCK_TTL_MS` | 30000 | 分布式调度锁的 TTL |

### 熔断器配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `failureThreshold` | 5 | 熔断前允许的连续失败次数 |
| `openDuration` | 1800000 | 熔断持续时间（30 分钟） |
| `halfOpenSuccessThreshold` | 2 | 半开状态关闭所需的成功次数 |

## 最佳实践

### 监控关键指标

建议重点监控以下指标：

1. **系统整体可用性** - 应保持在 99% 以上
2. **供应商可用性分布** - 识别表现不佳的供应商
3. **错误率趋势** - 发现潜在问题
4. **延迟百分位数** - P95、P99 延迟更能反映用户体验

**设置告警阈值：**

| 指标 | 警告阈值 | 严重阈值 | 说明 |
|------|----------|----------|------|
| 系统可用性 | < 99% | < 95% | 整体健康度 |
| 单个供应商可用性 | < 95% | < 90% | 供应商健康度 |
| 错误率 | > 1% | > 5% | 故障频率 |
| P99 延迟 | > 5s | > 10s | 用户体验 |

**告警疲劳的预防：**

- 使用持续时间的条件（如"持续 5 分钟低于阈值"）而非瞬时条件
- 区分工作时间和非工作时间的告警级别
- 对已知问题（如计划维护）设置静默期

### 设置合理预期

不同供应商类型的可用性预期：

| 供应商类型 | 目标可用性 | 说明 |
|------------|------------|------|
| 主要供应商 | 99.5%+ | 商业 API 服务 |
| 社区供应商 | 95%+ | 共享或免费服务 |
| 实验性供应商 | 90%+ | 测试或不稳定服务 |

### 故障排查

当可用性下降时，按照以下步骤进行排查：

**第一步：检查熔断器状态**

```typescript
import { getProviderHealthStatus } from "@/lib/circuit-breaker";

const health = await getProviderHealthStatus(providerId);
console.log({
  circuitState: health.circuitState, // "closed", "open", "half-open"
  failureCount: health.failureCount,
  circuitOpenUntil: health.circuitOpenUntil,
});
```

如果熔断器处于 open 状态，说明供应商已被自动隔离。检查熔断器触发前的错误日志，了解根本原因。

**第二步：查看探测日志**

```typescript
import { findProviderEndpointProbeLogs } from "@/repository/provider-endpoints";

const logs = await findProviderEndpointProbeLogs({
  endpointId: 1,
  limit: 50,
});

logs.forEach(log => {
  if (!log.ok) {
    console.log(`${log.createdAt}: ${log.errorType} - ${log.errorMessage}`);
  }
});
```

常见错误类型及含义：

| 错误类型 | 可能原因 | 建议措施 |
|----------|----------|----------|
| `timeout` | 网络延迟或供应商响应慢 | 增加超时时间或检查网络 |
| `network_error` | DNS 解析失败或连接被拒绝 | 验证端点 URL 和网络连通性 |
| `auth_error` | API 密钥无效或过期 | 检查供应商配置中的 API 密钥 |
| `rate_limit` | 触发供应商速率限制 | 降低请求频率或联系供应商 |
| `server_error` | 供应商服务器错误 | 等待供应商恢复或联系支持 |

**第三步：检查成本限制**

```typescript
import { RateLimitService } from "@/lib/rate-limit/service";

const check = await RateLimitService.checkCostLimitsWithLease(
  providerId,
  "provider",
  {
    limit_5h_usd: 100,
    limit_daily_usd: 500,
    limit_weekly_usd: 2000,
    limit_monthly_usd: 5000,
  }
);

if (!check.allowed) {
  console.log("成本限制阻止了请求:", check.reason);
}
```

**第四步：分析时间模式**

查看可用性图表，识别故障模式：

- **突发故障** - 可用性突然下降到 0%，可能是供应商完全不可用
- **逐渐下降** - 可用性缓慢下降，可能是供应商性能退化
- **周期性故障** - 在特定时间段出现故障，可能是供应商维护窗口
- **间歇性故障** - 可用性波动，可能是网络不稳定或供应商负载高

**第五步：验证供应商端点**

使用手动探测功能验证端点健康：

```typescript
import { probeProviderEndpointAndRecord } from "@/lib/provider-endpoints/probe";

const result = await probeProviderEndpointAndRecord({
  endpointId: 1,
  source: "manual",
  timeoutMs: 10000,
});

console.log({
  healthy: result?.ok,
  statusCode: result?.statusCode,
  latency: result?.latencyMs,
  error: result?.errorMessage,
});
```

如果手动探测成功但实际请求失败，可能是：
- 供应商的某些模型不可用
- 认证问题（探测可能使用不同的认证方式）
- 请求格式问题

### 数据保留

探测日志默认保留 1 天，可通过以下方式管理：

```typescript
// 清理旧探测日志
import { cleanupOldProbeLogs } from "@/lib/provider-endpoints/probe";

await cleanupOldProbeLogs({
  beforeDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 天前
  batchSize: 1000,
});
```

**批量清理策略：**

清理使用批量删除和 `FOR UPDATE SKIP LOCKED` 避免锁竞争：

```sql
WITH ids_to_delete AS (
  SELECT id FROM provider_endpoint_probe_logs
  WHERE created_at < $1
  ORDER BY created_at ASC
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
DELETE FROM provider_endpoint_probe_logs
WHERE id IN (SELECT id FROM ids_to_delete)
```

这种策略的优势：
- **避免长时间锁表** - 每次只删除一批记录
- **允许并发操作** - `SKIP LOCKED` 跳过正在被其他事务处理的行
- **有序删除** - 按时间顺序删除，优先清理最旧的数据
- **可中断** - 可以随时停止而不会留下不一致状态

**数据保留策略建议：**

| 数据类型 | 建议保留期 | 说明 |
|----------|------------|------|
| 探测日志 | 1-7 天 | 用于故障排查 |
| 可用性汇总 | 30-90 天 | 用于趋势分析 |
| 请求日志 | 根据合规要求 | 可能受数据保护法规约束 |

对于长期存储，考虑将汇总数据导出到数据仓库或时序数据库（如 InfluxDB、Prometheus）。

## 故障转移与恢复

当供应商出现问题时，系统会自动执行故障转移，将流量切换到健康的供应商。当供应商恢复时，系统也会自动检测并渐进地恢复流量。

### 自动故障转移流程

当供应商可用性下降时，系统会自动：

1. **熔断器打开** - 当连续失败达到阈值，熔断器打开，阻止新请求
2. **流量重路由** - 请求自动发送到其他健康供应商
3. **持续探测** - 系统继续探测故障供应商，监控恢复
4. **渐进恢复** - 半开状态下逐步恢复流量

**故障转移的触发条件：**

故障转移可能在以下情况下触发：
- 熔断器打开（连续失败达到阈值）
- 成本限制被触发（预算耗尽）
- 并发会话限制（连接数达到上限）
- 端点级熔断器打开

**用户体验：**

对用户而言，故障转移通常是透明的：
- 请求会自动路由到其他供应商
- 会话会保持（如果配置了会话粘性）
- 响应可能来自不同的供应商，但结果是一致的

### 恢复检测机制

系统通过多种机制检测供应商恢复：

**智能探测：**

当熔断器打开时，智能探测系统会定期测试供应商：

```typescript
// 智能探测配置
const ENABLE_SMART_PROBING = process.env.ENABLE_SMART_PROBING === "true";
const PROBE_INTERVAL_MS = 10000; // 每 10 秒探测一次
const PROBE_TIMEOUT_MS = 5000;   // 探测超时 5 秒
```

智能探测与普通 HTTP 探测不同，它发送实际的 API 请求（如聊天完成请求），验证供应商的 AI 功能是否正常，而不仅仅是检查端点是否响应。

**半开状态测试：**

当熔断器超时后进入半开状态：
- 允许有限数量的真实请求通过
- 这些请求用于测试供应商的实际恢复情况
- 如果成功，熔断器关闭；如果失败，熔断器重新打开

**可用性评分回升：**

系统持续监控可用性评分：
- 当评分持续高于 50% 时，认为供应商已恢复
- 评分基于实际请求，而非探测请求
- 这确保了恢复是真实的，而非探测的假象

### 手动干预

在必要时，你可以手动干预恢复过程：

**重置熔断器：**

```typescript
import { resetCircuit } from "@/lib/circuit-breaker";

// 手动重置供应商熔断器
await resetCircuit(providerId);
```

**适用场景：**
- 你确定供应商已经恢复，但自动检测尚未触发
- 你需要立即恢复流量（如紧急情况下）
- 自动检测被禁用或配置不当

**注意事项：**
- 手动重置会立即关闭熔断器
- 如果供应商实际上仍未恢复，请求可能会再次失败
- 建议重置后密切监控可用性指标

**禁用供应商：**

如果你需要暂时停止向某个供应商发送流量：

```typescript
import { updateProvider } from "@/actions/providers";

await updateProvider({
  providerId: 1,
  isEnabled: false,
});
```

禁用供应商会：
- 立即停止向其发送新请求
- 保持现有会话（如果配置了会话粘性）
- 保留所有配置，可随时重新启用

## 参考

- [端点管理](/docs/providers/endpoints) - 了解如何管理上游 API 端点
- [熔断器模式](/docs/providers/health-check) - 深入了解熔断器的工作原理
- [智能路由](/docs/intelligent-routing) - 了解请求路由和供应商选择机制
- [供应商配置](/docs/providers/configuration) - 学习如何配置供应商和 API 密钥
