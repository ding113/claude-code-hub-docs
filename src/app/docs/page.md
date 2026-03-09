---
dimensions:
  type:
    primary: getting-started
    detail: introduction
  level: beginner
standard_title: 项目介绍
language: zh
---

# Claude Code Hub

智能 AI API 代理中转服务平台，面向团队的多供应商统一接入、弹性调度与精细化运营中心。

{% callout title="什么是 Claude Code Hub" type="note" %}
Claude Code Hub (CCH) 是一个服务器部署的多租户 AI Coding 工具调度平台，帮助团队安全、可观测地统一管理 Claude、Codex、Gemini 等多家 AI 服务商，实现智能负载均衡与自动故障转移。
{% /callout %}

---

## 为什么需要 CCH

当前市场上的 AI API 代理方案存在明显局限：

1. **本地方案无法团队协作** - 每个用户需独立配置供应商，无法集中管理
2. **缺乏自动切换** - 供应商故障时需手动修改配置
3. **没有 Session 粘性** - 对 Claude Code 等工具至关重要，影响缓存命中率和成本

CCH 专为解决这些问题而生，提供**服务器部署、多租户、Session 粘性**的完整方案。

---

## 核心功能

### 智能负载均衡

权重 + 优先级 + 分组调度，内置熔断保护与最多 3 次故障转移。当某个供应商出现问题时，系统自动切换到备用供应商，用户完全无感知。

### 多供应商管理

同时接入 Claude、Codex、Gemini、OpenAI Compatible 等多种类型供应商，支持自定义模型重定向与 HTTP/HTTPS/SOCKS 代理配置。

### 限流与并发控制

多维度限制机制：

- RPM（每分钟请求数）
- 金额限制（5小时/周/月）
- 并发 Session 控制

Redis Lua 脚本确保原子性，Fail-Open 策略保障 Redis 不可用时服务降级而非中断。

### 实时监控与统计

- 仪表盘：调用量、成本、活跃 Session 一目了然
- 排行榜：按用户统计请求数、Token 与成本
- 决策链记录：完整追踪每次请求的路由决策，支持决策链溯源（v0.6.0+）
- 供应商健康状态：实时监控熔断器状态
- Langfuse 集成：企业级 LLM 可观测性，自动追踪请求全生命周期（v0.6.0+）

### Session 管理

5 分钟上下文缓存，同一会话的请求自动路由到相同供应商，提高缓存命中率、降低成本。完整记录决策链，支持全链路审计。

### API 兼容层

Claude Code Hub 在同一套鉴权与调度体系下，提供多种主流客户端协议入口：

- Claude Messages API：`POST /v1/messages`（及 `POST /v1/messages/count_tokens`）
- OpenAI Chat Completions：`POST /v1/chat/completions`
- OpenAI Responses（Codex / Response API）：`POST /v1/responses`
- Gemini API：`/v1beta/models/{model}:generateContent`（及 `streamGenerateContent` / `countTokens`）
- 可用模型聚合：`GET /v1/models`（按用户/分组聚合返回可用模型列表）

### 自动化 OpenAPI 文档

管理后台的 Server Actions 自动生成 OpenAPI 3.1.0 规范，并提供 Swagger + Scalar UI 双界面，便于自助查阅与调试接口。

### 价格表管理

支持云端价格表同步（TOML）、手动维护模型价格（含缓存相关价格字段）、分页/过滤/搜索等能力，确保成本计算准确且可控。

---

## 适用场景

CCH 专为以下团队设计：

| 场景 | 痛点 | CCH 方案 |
| --- | --- | --- |
| **敏捷开发团队** | 多人共用 AI 工具，缺乏统一管理 | 多租户 + 用量追踪 |
| **AI 驱动开发团队** | 重度依赖 AI Coding，需要高可用 | 自动故障转移 + 熔断保护 |
| **创业公司** | 预算有限，需要精细成本控制 | 多维限流 + 成本统计 |
| **中小软件公司** | 需要合规审计和访问控制 | 完整日志 + 敏感词过滤 |

---

## 技术栈

CCH 基于现代 Web 技术栈构建：

- **前端**：Next.js 16 (App Router) + React 19 + Tailwind CSS + shadcn/ui
- **API 层**：Hono（高性能路由框架）
- **数据库**：PostgreSQL + Drizzle ORM
- **缓存**：Redis（Session 管理、限流、熔断器状态）
- **部署**：Docker + Docker Compose

---

## 快速导航

{% quick-links %}

{% quick-link title="快速开始" href="/docs/deploy-script" description="一键部署脚本，5 分钟启动 CCH" /%}

{% quick-link title="客户端接入" href="/docs/client-setup" description="Claude Code / Codex / Gemini CLI / OpenCode 等接入指南" /%}

{% quick-link title="供应商管理" href="/docs/guide/settings-providers" description="添加、配置与调度多家 AI 供应商" /%}

{% quick-link title="API 兼容层" href="/docs/reference/api-compatibility" description="支持 Claude / OpenAI / Codex / Gemini 的 API 入口与兼容说明" /%}

{% /quick-links %}

---

## 与其他方案的对比

| 特性 | CCH | 本地代理工具 | 其他开源方案 |
| --- | --- | --- | --- |
| 服务器部署 | ✅ | ❌ | 部分支持 |
| 多租户 | ✅ | ❌ | 部分支持 |
| Session 粘性 | ✅ | ❌ | ❌ |
| 自动故障转移 | ✅ | ❌ | 部分支持 |
| 熔断保护 | ✅ | ❌ | 部分支持 |
| 完整监控 | ✅ | ❌ | 部分支持 |
| 多供应商类型 | ✅ | 部分支持 | 部分支持 |

CCH 是目前唯一专为团队 AI Coding 场景优化、具备完整 Session 粘性支持的开源方案。

---

## 开源许可

CCH 采用 [MIT License](https://github.com/ding113/claude-code-hub/blob/main/LICENSE)，可自由使用与二次开发。

{% callout title="加入社区" type="note" %}
有问题或建议？欢迎加入 [Telegram 交流群](https://t.me/ygxz_group) 与社区讨论，或在 [GitHub](https://github.com/ding113/claude-code-hub) 提交 Issue。
{% /callout %}
