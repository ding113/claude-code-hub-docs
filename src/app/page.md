---
dimensions:
  type:
    primary: conceptual
    detail: introduction
  level: beginner
standard_title: Claude Code Hub
language: zh
---

智能 AI API 代理中转服务平台 - 面向团队的多供应商统一接入、弹性调度与精细化运营中心。 {% .lead %}

{% quick-links %}

{% quick-link title="快速安装" icon="installation" href="/docs/installation" description="一键部署脚本、Docker Compose 快速启动，5 分钟完成安装。" /%}

{% quick-link title="配置指南" icon="presets" href="/docs/configuration" description="环境变量配置、供应商设置、限流策略等完整配置说明。" /%}

{% quick-link title="客户端配置" icon="plugins" href="/docs/client-setup" description="Claude Code、Codex CLI、Gemini CLI 等客户端接入指南。" /%}

{% quick-link title="API 参考" icon="theming" href="/docs/api-reference" description="39 个 REST 端点的完整 API 文档，支持 Swagger 和 Scalar UI。" /%}

{% /quick-links %}

---

## 什么是 Claude Code Hub

Claude Code Hub 是一个智能 AI API 代理中转服务平台，基于 Next.js 15 + Hono + PostgreSQL + Redis 技术栈构建。它为团队提供了统一的 AI 服务商接入方案，实现智能负载均衡、实时监控、价格管理与自动化文档，帮助团队安全、可观测地管理多家 AI 服务商。

无论你是个人开发者还是企业团队，Claude Code Hub 都能帮助你：

- 统一管理多个 AI 供应商的 API 密钥
- 智能分配请求到最优供应商
- 实时监控使用量和成本
- 精细化控制用户的访问权限和配额

---

## 核心特性

### 多供应商管理

Claude Code Hub 支持同时接入 6 种类型的 AI 供应商：

| 供应商类型 | 说明 |
| --- | --- |
| `claude` | Anthropic Claude API (api.anthropic.com) |
| `claude-auth` | Claude 认证模式 (带 Session Key) |
| `codex` | OpenAI Codex API |
| `gemini` | Google Gemini API |
| `gemini-cli` | Gemini CLI 专用模式 |
| `openai-compatible` | 任意 OpenAI 兼容 API |

每个供应商可以独立配置权重、成本系数、并发限制、代理设置及模型重定向，实现精细化调度。

### 智能调度与负载均衡

基于权重 + 优先级 + 分组的智能调度策略：

- **权重分配**：按权重比例分配请求流量
- **优先级调度**：高优先级供应商优先接收请求
- **分组隔离**：不同用户组可使用不同的供应商池
- **最多 3 次重试**：自动故障转移，保障请求稳定

### 熔断器与故障转移

内置熔断保护机制，自动识别异常供应商：

- 连续失败触发熔断，阻止请求发送到故障节点
- 30 分钟自动恢复尝试
- 支持网络错误计入熔断策略（可配置）
- 实时健康状态追踪与告警

### 限流与并发控制

多维度限流策略，Redis Lua 脚本确保原子性：

- **RPM 限制**：每分钟请求数限制
- **金额限制**：5 小时 / 周 / 月金额上限
- **并发 Session 限制**：控制同时活跃的会话数
- **Fail-Open 降级**：Redis 不可用时自动降级，不影响服务

### Session 会话黏性

5 分钟上下文缓存，优化多轮对话体验：

- 同一会话自动路由到相同供应商
- 记录完整决策链，支持全链路审计
- 避免频繁切换供应商导致的上下文丢失
- TTL 可通过 `SESSION_TTL` 环境变量自定义

### 完整监控与日志

实时洞察整体运行态势：

- **仪表盘**：汇总调用量、成本、活跃 Session 与时间分布
- **日志审计**：支持时间/用户/供应商/模型筛选，查看 Token 消耗与成本
- **排行榜**：按用户统计请求数、Token 与成本，用于费用分摊
- **决策链追踪**：记录每次请求的供应商选择过程

---

## 技术架构

```
客户端 / CLI / 第三方系统
        |
        v
Next.js 15 App Router (v1 API 路由)
        |
Hono + Proxy Pipeline (认证 -> Session 分配 -> 限流 -> 供应商选择 -> 请求转发 -> 响应处理)
        |
多供应商 (Claude / OpenAI / Gemini / 第三方) + PostgreSQL + Redis
```

- **App 层**：提供管理后台 UI 与内部 API
- **Proxy 核心**：串联 Auth、SessionGuard、RateLimitGuard、ProviderResolver、Forwarder、ResponseHandler
- **业务逻辑**：限流、Session、熔断器、代理、价格同步等服务
- **自动文档**：39 个 REST 端点自动生成 OpenAPI 3.1.0，Swagger + Scalar UI 双界面

---

## 社区与支持

欢迎加入 Claude Code Hub 社区，与其他用户交流部署、功能和技术问题：

- **GitHub 仓库**：[github.com/ding113/claude-code-hub](https://github.com/ding113/claude-code-hub)
- **Telegram 交流群**：[t.me/ygxz_group](https://t.me/ygxz_group)

{% callout type="note" title="合作优惠" %}
[Cubence](https://cubence.com?source=cch) 是一家稳定高效的 AI 服务中转平台，为 Claude Code、Codex、Gemini 等 AI 工具提供中转服务。Cubence 为 CCH 用户提供特别优惠：使用优惠码 `DING113CCH` 可享受 **20% 折扣**。
{% /callout %}

---

## 下一步

准备好开始使用 Claude Code Hub 了吗？

1. **[快速安装](/docs/installation)** - 一键部署或 Docker Compose 快速启动
2. **[配置指南](/docs/configuration)** - 了解所有可配置项
3. **[添加供应商](/docs/providers)** - 配置你的第一个 AI 供应商
4. **[客户端配置](/docs/client-setup)** - 让你的 CLI 工具连接到 Hub
