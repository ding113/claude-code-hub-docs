---
dimensions:
  type:
    primary: getting-started
    detail: dashboard
  level: beginner
standard_title: 活跃 Session
language: zh
---

# 活跃 Session

活跃 Session 页面提供了实时监控功能，让管理员能够查看当前正在进行的 API 请求会话，了解系统的实时运行状态。

## 功能概述

Session（会话）是 Claude Code Hub 中的核心概念。当用户通过 API 发起请求时，系统会为连续的对话分配一个唯一的 Session ID，用于：

- **会话追踪**：记录同一对话的多次请求
- **供应商粘性**：确保同一会话的请求路由到同一供应商，提高缓存命中率
- **并发控制**：限制单个会话的并发请求数

{% callout type="note" title="Session 生命周期" %}
Session 默认有效期为 5 分钟。在此期间的请求会复用同一 Session，超过 5 分钟无活动后 Session 自动过期。
{% /callout %}

## 页面布局

### 活跃 Session 列表

页面顶部显示当前活跃的 Session 列表，包含以下信息：

| 列名 | 说明 |
|------|------|
| Session ID | 会话唯一标识（显示前 16 位） |
| 用户 | 发起请求的用户名称 |
| 密钥 | 使用的 API 密钥名称 |
| 供应商 | 当前绑定的供应商名称 |
| 模型 | 请求使用的模型名称 |
| 请求数 | 该 Session 累计的请求次数 |
| 输入 Token | 累计输入 Token 数量 |
| 输出 Token | 累计输出 Token 数量 |
| 费用 | 累计费用（按系统设置的货币显示） |
| 耗时 | Session 运行时长 |
| 操作 | 查看详情按钮 |

### 非活跃 Session 列表

如果存在非活跃但尚未完全过期的 Session，页面会显示第二个列表区域。非活跃 Session 列表以半透明样式显示，并标注「不计入并发数」。

{% callout type="note" title="活跃与非活跃的区别" %}
- **活跃 Session**：5 分钟内有请求活动，计入并发限制
- **非活跃 Session**：超过 5 分钟无活动，但 Redis 数据尚未完全清理，不计入并发限制
{% /callout %}

## 自动刷新

页面默认每 **3 秒**自动刷新一次数据。刷新时，表格右上角会显示「刷新中...」提示。

## Session 详情页

点击任意 Session 行的「查看」按钮，可进入该 Session 的详情页面。

### 详情页功能

详情页采用双栏布局：

**左侧内容区域**：

- **客户端信息**：显示请求的 User-Agent 信息，帮助识别客户端类型
- **请求消息**：完整的请求 messages 数据（JSON 格式）
- **响应内容**：API 返回的响应体（JSON 格式）

**右侧信息卡片**：

1. **Session 概览**
   - 总请求数
   - 首次请求时间
   - 最后请求时间
   - 总耗时

2. **供应商和模型**
   - 使用过的供应商列表
   - 使用过的模型列表

3. **Token 使用**
   - 总输入 Token
   - 总输出 Token
   - 缓存创建 Token
   - 缓存读取 Token
   - Token 总计

4. **费用信息**
   - 累计费用

### 操作按钮

详情页顶部提供以下操作：

- **复制 Messages**：将请求消息复制到剪贴板
- **下载 Messages**：将请求消息保存为 JSON 文件
- **复制响应**：将响应内容复制到剪贴板

{% callout type="warning" title="需要启用消息存储" %}
要查看请求消息和响应内容，需要在环境变量中设置 `STORE_SESSION_MESSAGES=true`。启用后会增加 Redis 内存使用，且可能包含敏感信息，请谨慎评估后再开启。
{% /callout %}

## Session 与供应商粘性

Session 机制与供应商粘性（Session Stickiness）紧密相关：

1. **首次请求**：系统根据权重和优先级选择供应商，并将 Session 绑定到该供应商
2. **后续请求**：同一 Session 的请求优先路由到已绑定的供应商
3. **故障转移**：如果绑定的供应商不可用（熔断或禁用），系统会自动切换到其他供应商并更新绑定

这种机制的优势：

- **提高缓存命中率**：连续对话发送到同一供应商，供应商端可利用上下文缓存
- **降低成本**：缓存命中可减少输入 Token 计费
- **保证一致性**：避免对话上下文在不同供应商间频繁切换

## Session 状态说明

Session 有三种状态：

| 状态 | 说明 |
|------|------|
| `in_progress` | 请求进行中 |
| `completed` | 请求已完成 |
| `error` | 请求出错 |

## 使用场景

### 监控系统负载

通过活跃 Session 数量和请求频率，可以了解当前系统的负载情况。

### 排查问题

当用户反馈请求异常时，可以通过 Session ID 快速定位到具体的请求记录，查看完整的请求和响应内容。

### 费用审计

查看各 Session 的 Token 使用和费用，了解资源消耗情况。

## 相关配置

以下环境变量与 Session 功能相关：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SESSION_TTL` | `300` | Session 过期时间（秒） |
| `STORE_SESSION_MESSAGES` | `false` | 是否存储请求消息到 Redis |
| `SHORT_CONTEXT_THRESHOLD` | `2` | 短上下文阈值（用于并发检测） |
| `ENABLE_SHORT_CONTEXT_DETECTION` | `true` | 是否启用短上下文检测 |

## 下一步

- [日志查询](/docs/guide/settings-logs) - 查看历史请求日志
- [供应商管理](/docs/guide/settings-providers) - 配置供应商的并发限制
- [用户管理](/docs/guide/users) - 设置用户级别的并发限制
