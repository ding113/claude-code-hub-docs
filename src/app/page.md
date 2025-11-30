---
dimensions:
  type:
    primary: getting-started
    detail: introduction
  level: beginner
standard_title: 首页
language: zh
---

# Claude Code Hub 文档

智能 AI API 代理中转服务平台 - 面向团队的多供应商统一接入、弹性调度与精细化运营中心。 {% .lead %}

{% quick-links %}

{% quick-link title="一键部署" icon="installation" href="/docs/deploy-script" description="使用一键部署脚本，5 分钟内完成 CCH 安装与启动" /%}

{% quick-link title="供应商管理" icon="presets" href="/docs/guide/settings-providers" description="添加、配置和管理 Claude、Codex、Gemini 等多家 AI 供应商" /%}

{% quick-link title="客户端接入" icon="plugins" href="/docs/client-setup" description="配置 Claude Code、Codex CLI 等工具连接到 CCH" /%}

{% quick-link title="配置参考" icon="theming" href="/docs/reference/env-variables" description="环境变量、供应商参数等完整配置文档" /%}

{% /quick-links %}

---

## 什么是 Claude Code Hub

Claude Code Hub (CCH) 是一个服务器部署的多租户 AI Coding 工具调度平台，帮助团队安全、可观测地统一管理 Claude、Codex、Gemini 等多家 AI 服务商，实现智能负载均衡与自动故障转移。

### 为什么需要 CCH

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

同时接入 Claude、Codex 等多种类型供应商。Gemini CLI、OpenAI Compatible 等类型即将上线。支持自定义模型重定向与 HTTP/HTTPS/SOCKS 代理配置。

### 限流与并发控制

多维度限制机制：RPM（每分钟请求数）、金额限制（5小时/周/月）、并发 Session 控制。Redis Lua 脚本确保原子性，Fail-Open 策略保障服务降级而非中断。

### 实时监控与统计

仪表盘展示调用量、成本、活跃 Session；排行榜按用户统计请求数、Token 与成本；决策链记录完整追踪每次请求的路由决策；实时监控供应商健康状态与熔断器状态。

### Session 管理

5 分钟上下文缓存，同一会话的请求自动路由到相同供应商，提高缓存命中率、降低成本。完整记录决策链，支持全链路审计。

### OpenAI 兼容层（即将上线）

支持 `/v1/chat/completions` 端点，自动格式转换、工具调用、reasoning 字段与 Codex CLI 指令注入，无缝对接现有工具链。

---

## 适用场景

| 场景 | 痛点 | CCH 方案 |
| --- | --- | --- |
| **敏捷开发团队** | 多人共用 AI 工具，缺乏统一管理 | 多租户 + 用量追踪 |
| **AI 驱动开发团队** | 重度依赖 AI Coding，需要高可用 | 自动故障转移 + 熔断保护 |
| **创业公司** | 预算有限，需要精细成本控制 | 多维限流 + 成本统计 |
| **中小软件公司** | 需要合规审计和访问控制 | 完整日志 + 敏感词过滤 |

---

## 开源许可

CCH 采用 [MIT License](https://github.com/ding113/claude-code-hub/blob/main/LICENSE)，可自由使用与二次开发。

{% callout title="加入社区" type="note" %}
有问题或建议？欢迎加入 [Telegram 交流群](https://t.me/ygxz_group) 与社区讨论，或在 [GitHub](https://github.com/ding113/claude-code-hub) 提交 Issue。
{% /callout %}

---

{% sponsor-ad /%}
