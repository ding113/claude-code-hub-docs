---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 故障转移与重试
language: zh
---

# 故障转移与重试

Claude Code Hub 的故障转移与重试机制为 AI 模型代理服务提供高可用性和容错能力。当上游供应商出现临时故障时，系统通过自动重试和供应商切换，确保请求最终成功。

{% callout type="note" title="核心设计目标" %}
- **最大化请求成功率**：通过多层级重试和故障转移降低失败率
- **最小化延迟影响**：固定 100ms 的重试间隔，避免过度等待
- **防止供应商过载**：熔断器保护机制防止级联故障
{% /callout %}

## 双循环架构

系统采用嵌套循环结构实现故障转移：

```
外层循环：供应商切换（最多 20 次尝试）
  └── 内层循环：当前供应商重试（默认 2 次，最多 10 次）
```

### 外层循环（供应商切换）

当当前供应商的所有重试都失败后，系统会：

1. 将该供应商加入 `failedProviderIds` 排除列表
2. 调用 `selectAlternative()` 选择下一个可用供应商
3. 重置重试计数器，开始新一轮内层循环
4. 设有安全限制 `MAX_PROVIDER_SWITCHES = 20`，防止无限循环

### 内层循环（供应商内重试）

在同一供应商内部进行多次尝试：

1. 每次重试间隔固定 100ms
2. 根据错误类型决定是否切换端点
3. 跟踪 `attemptCount` 与 `maxAttemptsPerProvider` 对比
4. 端点按延迟排序，优先使用低延迟端点

## 重试配置

### 环境变量

| 变量 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `MAX_RETRY_ATTEMPTS_DEFAULT` | 2 | 1-10 | 每个供应商的默认重试次数 |
| `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` | false | boolean | 网络错误是否计入熔断器 |

### 供应商级配置

每个供应商可独立配置重试参数：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRetryAttempts` | number \| null | null | 供应商特定的重试次数，null 表示使用环境默认值 |

### 重试次数解析逻辑

实际重试次数按以下优先级确定：

1. 供应商的 `maxRetryAttempts` 字段（如果已设置）
2. 环境变量 `MAX_RETRY_ATTEMPTS_DEFAULT`（默认为 2）
3. 最终限制在 [1, 10] 范围内

{% callout type="warning" title="注意" %}
默认重试次数为 **2 次**（不是 3 次），这意味着每个供应商最多尝试 2 次（初始 1 次 + 重试 1 次）。
{% /callout %}

## 端点级故障转移

### 端点选择策略

端点按以下标准排序：

1. **探测状态**：`lastProbeOk === true` 的端点优先
2. **排序权重**：配置的 `sortOrder` 字段
3. **响应延迟**：`lastProbeLatencyMs` 升序排列

### 端点粘性策略

根据错误类型决定是否切换端点：

| 错误类型 | 端点行为 | 说明 |
|----------|----------|------|
| 网络错误 (`SYSTEM_ERROR`) | 切换到下一个端点 | 网络问题可能是端点特定的 |
| 供应商错误 (`PROVIDER_ERROR`) | 保持当前端点 | 4xx/5xx 错误通常是供应商全局问题 |
| 404 错误 | 保持当前端点 | 资源不存在，切换端点无效 |

### 端点候选截断

当端点数量超过 `maxAttemptsPerProvider` 时，系统只保留延迟最低的 N 个端点（N = 重试次数），避免在低质量端点上浪费重试机会。

## 错误分类与处理

系统根据错误类型采取不同的处理策略：

### 错误类别

| 类别 | 触发条件 | 重试策略 | 熔断器记录 |
|------|----------|----------|------------|
| `PROVIDER_ERROR` | HTTP 4xx/5xx 错误 | 重试后故障转移 | 是 |
| `SYSTEM_ERROR` | 网络/DNS/超时错误 | 切换端点后重试 | 可配置 |
| `CLIENT_ABORT` | 客户端连接重置 | 不重试，立即返回 | 否 |
| `NON_RETRYABLE_CLIENT_ERROR` | 输入验证错误 | 不重试，立即返回 | 否 |
| `RESOURCE_NOT_FOUND` | HTTP 404 错误 | 重试后故障转移 | 否 |

### 错误检测优先级

1. **客户端中断检测**：检查连接重置错误
2. **不可重试客户端错误**：匹配错误规则（如提示词过长、内容过滤等）
3. **供应商错误**：HTTP 错误响应
4. **空响应错误**：Content-Length 为 0 的响应
5. **系统错误**：其他所有错误（网络、DNS、超时）

### 错误规则系统

系统内置错误规则用于识别不可重试的客户端错误：

- 提示词 Token 限制（`prompt is too long`）
- 内容过滤（`content filter`, `safety`）
- PDF 页数限制（`PDF pages`, `document`）
- 思考格式错误（`thinking_budget`）
- 参数错误（`Missing or invalid`）
- 模型错误（`unknown model`）

支持三种匹配方式：`contains`（子串匹配）、`exact`（精确匹配）、`regex`（正则匹配）。

## 熔断器集成

故障转移机制与熔断器紧密协作，防止故障扩散。

### 何时记录熔断器

| 错误类别 | 是否记录 | 说明 |
|----------|----------|------|
| `PROVIDER_ERROR` | 是 | 重试耗尽后记录 |
| `SYSTEM_ERROR` | 可配置 | 默认不记录，可通过环境变量启用 |
| `RESOURCE_NOT_FOUND` | 否 | 404 错误不计入 |
| `CLIENT_ABORT` | 否 | 客户端断开连接 |
| `NON_RETRYABLE_CLIENT_ERROR` | 否 | 客户端输入错误 |

### 探测请求保护

健康检查探测请求不会影响熔断器状态，确保监控不会干扰正常的故障检测。

### 多级熔断保护

系统提供三层熔断保护：

1. **供应商级熔断**：单个供应商的失败计数和状态管理
2. **端点级熔断**：单个端点的独立熔断状态
3. **Vendor 类型熔断**：防止会话复用绕过故障隔离

## 故障转移流程

完整的请求处理流程：

```
1. 初始请求
   └── 通过智能路由选择主供应商

2. 第一次尝试
   └── 使用最佳端点发送请求

3. 失败处理
   └── 分类错误类型 → 决定重试/故障转移策略

4. 重试
   └── 等待 100ms → 切换端点（网络错误）或保持端点

5. 供应商耗尽
   └── 加入 failedProviderIds → 选择备用供应商

6. 重复
   └── 直到成功或所有供应商耗尽

7. 最终失败
   └── 返回 503 "所有供应商暂时不可用"
```

## 特殊故障转移场景

### HTTP/2 降级

当检测到 HTTP/2 协议错误（`HPE_INVALID_HEADER_TOKEN` 或 `HPE_INVALID_CONSTANT`）时，系统会自动降级到 HTTP/1.1 重试。

### 代理回退

当配置 `proxyFallbackToDirect: true` 时，如果代理连接失败，系统会尝试直接连接。

### 会话绑定迁移

当会话绑定的供应商变为不可用时：

1. `findReusable()` 中的熔断器检查阻止复用
2. 通过 `updateSessionBindingSmart()` 迁移到新供应商
3. 原供应商被排除出未来选择

## 配置参考

### 供应商配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRetryAttempts` | number \| null | null | 供应商特定重试次数 |
| `circuitBreakerFailureThreshold` | number | 5 | 熔断前最大失败次数 |
| `circuitBreakerOpenDuration` | number | 1800000 | 熔断持续时间（毫秒） |
| `circuitBreakerHalfOpenSuccessThreshold` | number | 2 | 半开状态恢复所需成功次数 |
| `proxyFallbackToDirect` | boolean | false | 代理失败时允许直接连接 |

### 超时配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FETCH_BODY_TIMEOUT` | 600000 | 请求/响应体超时（毫秒） |
| `FETCH_HEADERS_TIMEOUT` | 600000 | 响应头超时（毫秒） |
| `FETCH_CONNECT_TIMEOUT` | 30000 | TCP 连接超时（毫秒） |

## 边界情况处理

### 所有供应商耗尽

当所有供应商都失败时，系统返回：

```
HTTP 503: 所有供应商暂时不可用，请稍后重试
```

错误信息故意模糊，避免暴露供应商细节。

### 并发限制冲突

当供应商并发限制达到时：

1. `ensure()` 方法执行原子性检查
2. 如果超限，供应商被加入排除列表
3. 立即选择备用供应商

### 空响应检测

非流式响应如果 `Content-Length: 0`，系统抛出 `EmptyResponseError`，归类为 `PROVIDER_ERROR` 并触发故障转移。

## 监控与调试

### 关键指标

- **重试率**：需要重试的请求比例
- **故障转移次数**：切换到备用供应商的频率
- **供应商成功率**：各供应商的请求成功比例
- **端点延迟分布**：各端点的响应时间分布

### 日志字段

故障转移相关的日志包含以下信息：

- `attemptCount`：当前重试次数
- `maxAttemptsPerProvider`：供应商最大重试次数
- `failedProviderIds`：已失败的供应商 ID 列表
- `errorCategory`：错误分类
- `endpointIndex`：当前使用的端点索引

## 最佳实践

### 重试配置建议

1. **默认重试次数**：保持默认值 2，通常足够应对临时故障
2. **关键业务**：可增加到 3-5，但需权衡延迟
3. **网络不稳定环境**：启用 `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS`

### 供应商配置建议

1. **多 Vendor 部署**：至少配置两个不同 Vendor 的供应商，避免单点故障
2. **端点冗余**：每个供应商配置多个端点（如果可用）
3. **熔断阈值**：建议设置为 3-5 次失败，平衡敏感度和稳定性

### 故障排查

当故障转移频繁触发时：

1. 检查错误统计页面，识别高频错误类型
2. 查看供应商健康检查状态
3. 审查端点延迟和可用性
4. 调整熔断阈值或重试次数

## 相关文档

- [智能路由算法](/docs/proxy/intelligent-routing) - 了解供应商选择逻辑
- [熔断器机制](/docs/proxy/circuit-breaker) - 了解熔断器工作原理
- [会话管理](/docs/proxy/session-management) - 了解会话绑定和迁移
- [供应商管理](/docs/providers/crud) - 了解供应商配置
