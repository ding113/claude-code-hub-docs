---
title: Langfuse 集成
nextjs:
  metadata:
    title: Langfuse 集成
    description: Claude Code Hub Langfuse LLM 可观测性集成文档
---

# Langfuse 集成

Langfuse 集成为 Claude Code Hub 提供企业级 LLM 可观测性能力，自动追踪所有代理请求的完整生命周期。通过 Trace 和 Span 机制，你可以在 Langfuse 平台上查看每个请求的详细执行过程、模型调用、延迟分布和错误信息。

{% callout type="note" %}
Langfuse 集成自 v0.6.0 起可用。配置 `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY` 后自动启用，无需额外代码修改。
{% /callout %}

---

## 功能概述

Langfuse 集成提供以下核心能力：

- **端到端请求追踪**：自动为每个代理请求创建 Trace，记录完整的请求生命周期
- **Guard Pipeline 决策记录**：每个 Guard 阶段（认证、限流、路由等）作为独立 Span 记录
- **模型调用追踪**：记录上游模型调用的输入、输出、Token 使用量和延迟
- **可配置采样率**：通过 `LANGFUSE_SAMPLE_RATE` 控制追踪数据量，平衡可观测性和成本
- **支持自托管**：同时支持 Langfuse Cloud 和自托管 Langfuse 实例

---

## 配置方式

### 环境变量

在 `.env` 文件或部署环境中设置以下变量：

```bash
# 必需：Langfuse 项目密钥（设置后自动启用追踪）
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxx

# 可选：Langfuse 服务器地址（默认使用 Langfuse Cloud）
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# 可选：追踪采样率（0.0-1.0，默认 1.0 即 100% 追踪）
LANGFUSE_SAMPLE_RATE=1.0

# 可选：启用调试日志（默认 false）
LANGFUSE_DEBUG=false
```

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `LANGFUSE_PUBLIC_KEY` | `string` | 无 | Langfuse 项目公钥，以 `pk-lf-` 开头 |
| `LANGFUSE_SECRET_KEY` | `string` | 无 | Langfuse 项目密钥，以 `sk-lf-` 开头 |
| `LANGFUSE_BASE_URL` | `string` | `https://cloud.langfuse.com` | Langfuse 服务地址 |
| `LANGFUSE_SAMPLE_RATE` | `number` | `1.0` | 采样率，0.0 表示不采样，1.0 表示全量采样 |
| `LANGFUSE_DEBUG` | `boolean` | `false` | 是否输出 Langfuse SDK 调试日志 |

{% callout type="warning" %}
`LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY` 必须同时配置才能启用 Langfuse 集成。缺少任一密钥时，集成不会启动。
{% /callout %}

---

## 工作原理

### 初始化

系统在 Next.js 服务启动时通过 `instrumentation.ts` 初始化 Langfuse：

1. 检查 `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY` 是否已配置
2. 如果已配置，初始化 Langfuse SDK 并注册 Span 处理器
3. 配置采样率和调试模式

### 请求追踪流程

```text
客户端请求
    ↓
创建 Langfuse Trace（关联 request-id、user-id、model 等元数据）
    ↓
Guard Pipeline 执行（每个 Guard 阶段记录为独立 Span）
    ↓
上游模型调用（记录 input、output、usage、latency）
    ↓
响应处理完成
    ↓
异步上报 Trace 数据到 Langfuse
```

### 优雅关闭

当服务收到 `SIGTERM` 或 `SIGINT` 信号时，系统会刷新所有待发送的 Trace 数据，确保在应用关闭前所有追踪信息都已上报到 Langfuse。

---

## 使用方式

### 1. 获取 Langfuse 密钥

**Langfuse Cloud**：
1. 访问 [cloud.langfuse.com](https://cloud.langfuse.com) 注册账号
2. 创建项目
3. 在项目设置中获取 Public Key 和 Secret Key

**自托管 Langfuse**：
1. 参照 [Langfuse 文档](https://langfuse.com/docs/deployment/self-host) 部署实例
2. 创建项目并获取密钥
3. 将 `LANGFUSE_BASE_URL` 设置为你的自托管地址

### 2. 配置环境变量

将获取到的密钥添加到 Claude Code Hub 的环境配置中：

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-your-public-key
LANGFUSE_SECRET_KEY=sk-lf-your-secret-key
```

### 3. 重启服务

配置完成后重启 Claude Code Hub 服务，系统会自动开始上报追踪数据。

### 4. 查看追踪数据

在 Langfuse 平台中，你可以：

- **Traces 列表**：查看所有代理请求的追踪记录
- **Trace 详情**：查看单个请求的完整执行过程和各阶段耗时
- **模型分析**：分析不同模型的调用频率、延迟和 Token 消耗
- **错误追踪**：快速定位失败请求的错误原因
- **用户分析**：按用户维度查看使用模式

---

## 采样率配置建议

| 场景 | 建议采样率 | 说明 |
|------|-----------|------|
| 开发调试 | `1.0` | 全量采样，方便调试 |
| 小规模生产 | `1.0` | 请求量不大时建议全量采样 |
| 中等规模 | `0.1` - `0.5` | 平衡可观测性和 Langfuse 存储成本 |
| 大规模生产 | `0.01` - `0.1` | 降低采样率以控制成本 |

---

## 相关文档

- [环境变量参考](/docs/reference/env-variables) - 完整的环境变量列表
- [系统配置](/docs/system/config) - 系统配置管理
- [使用日志](/docs/monitoring/logs) - 日志查询与筛选
