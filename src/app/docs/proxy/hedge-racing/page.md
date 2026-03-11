---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 供应商竞速
language: zh
---

# 供应商竞速

供应商竞速（Hedge Racing）是 Claude Code Hub 代理服务的高级超时处理机制。当流式请求的首字节超时触发时，系统不会立即中止初始请求，而是保持初始尝试存活的同时启动备选供应商并行竞速，首个成功返回响应的供应商获胜，失败者被取消。

{% callout type="note" title="与传统超时的区别" %}
传统超时机制在超时触发时立即中止当前请求，然后重新选择供应商重试。供应商竞速则不同——它让初始请求继续运行，同时并行启动新的供应商请求，形成"竞赛"。这意味着即使初始供应商只是"慢"而非"挂掉"，它仍有机会赢得竞速。
{% /callout %}

## 触发条件

供应商竞速需要同时满足以下四个条件才会启用：

1. **流式请求**：请求体中 `stream` 字段为 `true`
2. **首字节超时已配置**：供应商的 `firstByteTimeoutStreamingMs` 大于 0
3. **允许重试**：端点策略允许重试（`allowRetry` 为 true）
4. **允许供应商切换**：端点策略允许供应商切换（`allowProviderSwitch` 为 true）

当条件不满足时（如非流式请求或未配置首字节超时），系统使用传统的双循环重试机制。

## 工作原理

### 整体流程

```
1. 启动初始供应商请求
   └── 设置首字节超时计时器

2. 首字节超时触发
   └── 保持初始请求存活
   └── 选择备选供应商启动并行请求

3. 竞速阶段
   └── 多个供应商同时运行
   └── 等待首个返回首字节的供应商

4. 确定胜者
   └── 首个返回首字节的供应商获胜
   └── 取消其他所有尝试
   └── 将胜者的响应流返回给客户端
```

### 核心函数

供应商竞速由 `sendStreamingWithHedge()` 方法实现，内部包含以下关键函数：

- **`startAttempt(provider, useOriginalSession)`**：启动一个供应商尝试。首个供应商使用原始 Session，备选供应商使用克隆的影子 Session（`createStreamingShadowSession`），避免互相干扰
- **`launchAlternative()`**：选择一个新的备选供应商并启动尝试。通过 `selectAlternative()` 排除已发起过的供应商，确保不重复
- **`commitWinner(attempt, firstChunk)`**：当某个尝试首先返回了首字节，调用此函数确认胜者。同步胜者的 Session 数据到主 Session（`syncWinningAttemptSession`），取消所有其他尝试，将带缓冲首字节的响应流返回客户端
- **`abortAllAttempts(winner, reason)`**：取消所有尝试（可排除胜者），释放资源

### 首字节超时计时器

每个尝试启动时，如果供应商配置了 `firstByteTimeoutStreamingMs > 0`，系统会设置一个定时器：

- 计时器到期时，标记 `thresholdTriggered = true`
- 在决策链中记录 `hedge_triggered` 事件
- 调用 `launchAlternative()` 启动备选供应商
- 初始请求的计时器只触发备选启动，不中止自身

{% callout type="warning" title="注意" %}
发送给上游供应商的请求中，`firstByteTimeoutStreamingMs` 被设为 0，即供应商竞速在转发时不设置底层超时。超时逻辑完全由对冲计时器控制。
{% /callout %}

### 影子 Session

备选供应商使用克隆的影子 Session（`createStreamingShadowSession`），它：

- 深拷贝请求体（`structuredClone`）和请求缓冲区
- 复制 Headers、URL、决策链、特殊设置等状态
- 独立于原始 Session 运行，避免并发写入冲突
- 胜者确定后，通过 `syncWinningAttemptSession` 将影子 Session 的状态合并回主 Session

### 胜者确定

胜者的确定逻辑：

1. 每个尝试发出请求后，等待读取响应体的第一个数据块（`readFirstReadableChunk`）
2. 首个成功读取到非空首字节数据块的尝试触发 `commitWinner`
3. 胜者的响应流通过 `buildBufferedFirstChunkStream` 将已读取的首字节与剩余流拼接，返回给客户端
4. 如果只有一个供应商被启动（未触发对冲），决策链记录为 `request_success`；如果多个供应商参与了竞速，记录为 `hedge_winner`

## 决策链记录

供应商竞速在 Session 的决策链（Provider Chain）中记录详细的事件，便于日志分析和 UI 展示：

| 事件 | 字段值 | 含义 |
|------|--------|------|
| 初始选择 | `initial_selection` / `session_reuse` | 首个供应商的选择方式 |
| 对冲触发 | `hedge_triggered` | 某个尝试的首字节超时计时器到期 |
| 备选启动 | `hedge_launched` | 备选供应商已启动并加入竞速 |
| 竞速胜者 | `hedge_winner` | 该供应商赢得竞速（多供应商参与时） |
| 普通成功 | `request_success` | 供应商成功（未发生实际竞速） |
| 竞速失败者 | `hedge_loser_cancelled` | 该供应商输掉竞速，请求被取消 |
| 客户端中断 | `client_abort` | 客户端在竞速结束前断开连接 |

每个事件还包含时间戳（`timestamp`）、尝试序号（`attemptNumber`）、熔断器状态（`circuitState`）、端点信息等元数据。

## 失败处理

### 尝试失败

当某个尝试失败时（`handleAttemptFailure`）：

1. 根据错误类型分类（`categorizeErrorAsync`）
2. 如果是客户端中断（`CLIENT_ABORT`），取消所有尝试并返回 499 错误
3. 如果是供应商错误（非 404），记录到熔断器
4. 在决策链中记录失败原因（`retry_failed` 或 `resource_not_found`）
5. 尝试启动下一个备选供应商（`launchAlternative`）
6. 如果没有更多供应商且无在途请求，返回最终错误

### 所有供应商耗尽

当 `selectAlternative()` 返回 null（无可用供应商）且所有在途尝试都已完成时，系统返回 503 错误。

### 客户端中断

系统监听客户端的 `AbortSignal`，当客户端断开连接时：

- 标记 `noMoreProviders = true` 阻止启动新尝试
- 为所有在途尝试记录 `client_abort` 事件
- 取消所有尝试并返回 499 错误

## 会话绑定更新

当胜者确定后，如果存在 Session ID，系统会异步更新会话绑定：

- 调用 `SessionManager.updateSessionBindingSmart()` 更新绑定
- 调用 `SessionManager.updateSessionProvider()` 更新会话的供应商信息
- 如果胜者与初始供应商不同，标记为故障转移成功（`isFailoverSuccess`）

## 配置建议

### 首字节超时设置

{% callout type="note" title="推荐配置" %}
将 `firstByteTimeoutStreamingMs` 设置为 **10000-15000**（10-15 秒）。过短会导致频繁触发对冲，增加不必要的上游请求；过长会影响用户体验，失去供应商竞速的延迟优化效果。
{% /callout %}

### 供应商配置建议

1. **至少两个供应商**：供应商竞速需要备选供应商才能发挥作用，确保配置至少两个健康的供应商
2. **多 Vendor 部署**：使用不同 Vendor 的供应商可以最大化对冲效果，避免同一上游的全局故障
3. **合理的优先级和权重**：备选供应商通过 `selectAlternative()` 选择，受优先级和权重影响
4. **熔断器配合**：熔断器打开的供应商不会被选为备选，确保不向已知故障供应商发送请求

### 何时禁用供应商竞速

将 `firstByteTimeoutStreamingMs` 设置为 0 即可禁用供应商竞速，以下场景可考虑：

- 只有单个供应商可用时（无备选意义）
- 上游供应商有严格的并发限制时（避免双重消耗配额）
- 成本敏感场景（供应商竞速可能导致多个供应商同时消耗 Token）

## UI 显示

在仪表盘的日志详情中，供应商竞速的信息通过决策链展示：

- 每个参与竞速的供应商在决策链中有独立的记录项
- 胜者标记为 `hedge_winner`，失败者标记为 `hedge_loser_cancelled`
- 可追踪完整的竞速时间线（通过各事件的时间戳）

## 故障排查

**Q: 供应商竞速没有触发？**

检查以下条件：
1. 请求是否为流式（`stream: true`）
2. 供应商的 `firstByteTimeoutStreamingMs` 是否大于 0
3. 端点策略是否允许重试和供应商切换
4. 是否有可用的备选供应商

**Q: 供应商竞速触发后没有启动备选？**

检查以下情况：
1. 所有备选供应商的熔断器是否已打开
2. 供应商的 Vendor 类型熔断是否已触发
3. 端点选择是否失败（检查端点配置和健康状态）

**Q: 供应商竞速增加了成本？**

这是预期行为。供应商竞速会向多个供应商同时发送请求，可能导致：
- 多个供应商同时消耗 Token（仅胜者的 Token 计入计费）
- 增加上游 API 调用次数
- 建议通过调整 `firstByteTimeoutStreamingMs` 平衡延迟和成本

**Q: 决策链中显示 `request_success` 而非 `hedge_winner`？**

这意味着首字节超时未触发，初始供应商在超时前就返回了首字节。此时只有一个供应商参与，不构成实际竞速，因此记录为普通成功。

## 相关文档

- [超时控制](/docs/proxy/timeout-control) - 了解首字节超时配置和超时机制
- [故障转移与重试](/docs/proxy/failover-retry) - 了解非对冲场景的重试策略
- [熔断器机制](/docs/proxy/circuit-breaker) - 了解熔断器如何影响备选供应商选择
- [智能路由算法](/docs/proxy/intelligent-routing) - 了解供应商选择逻辑
- [会话管理](/docs/proxy/session-management) - 了解会话绑定和迁移
