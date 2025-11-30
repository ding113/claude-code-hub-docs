---
dimensions:
  type:
    primary: reference
    detail: architecture
  level: advanced
standard_title: 系统架构
language: zh
---

# 系统架构

Claude Code Hub 采用 **Modular Monolith**（模块化单体）架构模式，基于 Next.js 15 + Hono + PostgreSQL + Redis 技术栈构建。本文档详细介绍系统的整体架构设计、核心组件和数据流程。

---

## 架构设计目标

系统架构围绕以下核心目标设计：

| 目标 | 说明 | 实现方式 |
|------|------|----------|
| **高可用性** | 单供应商故障不影响服务 | 多供应商故障转移、熔断器模式 |
| **低延迟** | 代理开销 < 50ms | Hono 路由、Redis 缓存、流式传输 |
| **可观测性** | 全链路追踪和监控 | 请求日志、决策链记录、实时仪表盘 |
| **可扩展性** | 支持水平扩展 | 无状态设计、Redis 共享状态 |
| **易维护性** | 单一部署单元 | Modular Monolith、Docker Compose |

{% callout type="note" title="为什么选择 Modular Monolith" %}
相比微服务架构，Modular Monolith 在代理场景下具有明显优势：
- **更低延迟**：进程内通信避免网络开销（对 < 50ms 延迟要求至关重要）
- **更简单部署**：单一 Docker Compose 即可完成部署
- **更易调试**：统一代码库便于问题定位
- **更低运维成本**：无需管理分布式系统的复杂性
{% /callout %}

---

## 高层架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Claude Code │  │  Codex CLI  │  │ Cursor IDE  │  │  Admin UI   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY LAYER                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Next.js 15 + Hono Router                          │    │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐         │    │
│  │  │ /v1/      │  │ /api/     │  │ /settings │  │ /dashboard│         │    │
│  │  │ messages  │  │ actions   │  │ (UI)      │  │ (UI)      │         │    │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘         │    │
│  └────────┼──────────────┼──────────────┼──────────────┼───────────────┘    │
└───────────┼──────────────┼──────────────┼──────────────┼────────────────────┘
            │              │              │              │
            ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GUARD PIPELINE LAYER                                 │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│  │  Auth  │→│Version │→│ Probe  │→│Session │→│Sensitive│→│  Rate  │→...    │
│  │ Guard  │ │ Guard  │ │Handler │ │ Guard  │ │ Guard  │ │ Limit  │         │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PROXY CORE LAYER                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Provider        │  │ Format          │  │ Response        │              │
│  │ Selector        │  │ Converter       │  │ Handler         │              │
│  │ (weighted LB)   │  │ (Claude↔OpenAI) │  │ (streaming)     │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                        │
│  ┌────────┴────────────────────┴────────────────────┴────────┐              │
│  │                    Circuit Breaker                         │              │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                    │              │
│  │  │ CLOSED  │←→│  OPEN   │←→│HALF-OPEN│                    │              │
│  │  └─────────┘  └─────────┘  └─────────┘                    │              │
│  └────────────────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       UPSTREAM PROVIDERS                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Anthropic│  │  OpenAI  │  │  Gemini  │  │  Relay   │  │  Custom  │      │
│  │ (claude) │  │ (codex)  │  │ (gemini) │  │(claude-  │  │(openai-  │      │
│  │          │  │          │  │          │  │  auth)   │  │compatible│      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                           │
│  ┌─────────────────────────┐      ┌─────────────────────────┐               │
│  │       PostgreSQL        │      │          Redis          │               │
│  │  ┌─────┐ ┌─────┐ ┌────┐│      │  ┌─────┐ ┌─────┐ ┌────┐│               │
│  │  │users│ │keys │ │prov││      │  │sess │ │rate │ │circ││               │
│  │  ├─────┤ ├─────┤ ├────┤│      │  │ions │ │limit│ │uit ││               │
│  │  │msgs │ │rules│ │conf││      │  └─────┘ └─────┘ └────┘│               │
│  │  └─────┘ └─────┘ └────┘│      └─────────────────────────┘               │
│  └─────────────────────────┘                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 架构层次说明

| 层次 | 职责 | 主要组件 |
|------|------|----------|
| **Client Layer** | 接入各类 AI 编码工具和管理界面 | Claude Code、Codex CLI、Cursor、Admin UI |
| **API Gateway** | 统一入口，路由分发 | Next.js App Router、Hono Router |
| **Guard Pipeline** | 请求预处理，横切关注点处理 | Auth、Version、Session、RateLimit 等 Guard |
| **Proxy Core** | 核心代理逻辑 | Provider Selector、Format Converter、Response Handler |
| **Upstream Providers** | 上游 AI 服务供应商 | Anthropic、OpenAI、Gemini、Relay Services |
| **Data Layer** | 持久化和缓存 | PostgreSQL（持久化）、Redis（缓存/限流） |

---

## 技术栈

### 前端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **Next.js** | 15 | 全栈框架，App Router + Server Components |
| **React** | 19 | UI 渲染 |
| **Tailwind CSS** | 4 | 样式系统 |
| **shadcn/ui** | - | UI 组件库 |
| **next-intl** | - | 国际化 |
| **zustand** | - | 客户端状态管理 |
| **recharts** | - | 数据可视化图表 |

### 后端技术

| 技术 | 用途 | 选择理由 |
|------|------|----------|
| **Hono** | API 路由 | 亚毫秒级路由性能，对代理延迟敏感场景至关重要 |
| **Server Actions** | 类型安全 RPC | 自动生成 OpenAPI，端到端类型安全 |
| **undici** | HTTP 客户端 | 比 node-fetch 更快，用于上游请求 |
| **zod** | Schema 验证 | 运行时类型校验 |

{% callout type="note" title="为什么选择 Hono" %}
Hono 是一个超轻量级的 Web 框架，路由性能远超 Express（亚毫秒 vs 10ms+）。在代理场景下，每一毫秒都很重要。Hono 的 edge-first 设计与低延迟目标高度契合。
{% /callout %}

### 数据存储

| 技术 | 用途 | 特点 |
|------|------|------|
| **PostgreSQL** | 主数据库 | ACID 事务、JSON 支持、强大的索引能力 |
| **Drizzle ORM** | 数据库访问层 | 类型安全、SQL-first、最小化开销 |
| **Redis** | 缓存/限流/会话 | 高性能、原子操作（Lua 脚本）、TTL 支持 |
| **ioredis** | Redis 客户端 | 连接池、集群支持、管道操作 |

### 基础设施

| 技术 | 用途 |
|------|------|
| **Docker** | 容器化部署 |
| **Docker Compose** | 服务编排 |
| **Bun** | 包管理器和运行时 |
| **GitHub Actions** | CI/CD |

---

## 核心组件

### Guard Pipeline（守卫管道）

Guard Pipeline 是请求处理的核心机制，采用责任链模式串联多个守卫步骤，每个步骤处理特定的横切关注点。

#### 管道配置

```typescript
// 完整管道 - 用于 chat 请求
const CHAT_PIPELINE = [
  "auth",           // API Key 认证
  "version",        // 客户端版本检查
  "probe",          // 探测请求处理
  "session",        // Session 粘性
  "sensitive",      // 敏感词过滤
  "rateLimit",      // 限流检查
  "provider",       // 供应商选择
  "messageContext", // 请求日志上下文
];

// 精简管道 - 用于 count_tokens 请求
const COUNT_TOKENS_PIPELINE = [
  "auth",
  "version",
  "probe",
  "provider"
];
```

#### Guard 职责说明

| Guard | 职责 | 依赖 |
|-------|------|------|
| **Auth Guard** | 验证 API Key 有效性 | PostgreSQL |
| **Version Guard** | 检查客户端版本要求 | - |
| **Probe Handler** | 处理探测/健康检查请求 | - |
| **Session Guard** | 维护 Session 粘性，复用供应商 | Redis |
| **Sensitive Guard** | 检测敏感词，阻止违规内容 | PostgreSQL |
| **Rate Limit Guard** | 多维度限流（RPM/金额/并发） | Redis |
| **Provider Selector** | 选择最优供应商 | PostgreSQL、Redis |
| **Message Context** | 初始化请求日志上下文 | - |

### Provider Selector（供应商选择器）

供应商选择器实现智能调度算法，根据多种因素选择最优供应商。

#### 选择算法流程

```
1. Session 复用检查
   └─ 是否有已绑定的供应商？
      ├─ 是 → 验证供应商可用性 → 复用
      └─ 否 → 进入供应商选择流程

2. 供应商选择流程
   ├─ Step 1: 基础过滤（启用状态、格式兼容、模型支持）
   ├─ Step 2: 分组过滤（用户 groupTag 匹配）
   ├─ Step 3: 健康度过滤（熔断器状态、限流检查）
   ├─ Step 4: 优先级分层（只选最高优先级）
   └─ Step 5: 加权随机选择

3. 并发检查与绑定
   └─ 原子性检查并发限制 → 成功则绑定
```

#### 选择因素

| 因素 | 说明 |
|------|------|
| **weight** | 权重（0-100），决定同优先级内的流量分配 |
| **priority** | 优先级（数值越小越高），决定故障转移顺序 |
| **costMultiplier** | 成本系数，影响选择顺序 |
| **groupTag** | 分组标签，实现资源隔离 |
| **熔断状态** | OPEN 状态的供应商被排除 |
| **Session 绑定** | 优先复用已绑定的供应商 |

### Format Converter（格式转换器）

格式转换器实现不同 AI API 格式之间的双向转换，使系统能够接受多种格式的请求并路由到不同类型的供应商。

#### 支持的格式转换

| 源格式 | 目标格式 | 说明 |
|--------|----------|------|
| Claude Messages | OpenAI Chat | 支持 streaming、tools、thinking |
| Claude Messages | Codex Response | 支持 instructions 注入 |
| Claude Messages | Gemini | 支持 generateContent |
| OpenAI Chat | Claude Messages | 反向转换 |
| Codex Response | Claude Messages | CLI 请求适配 |
| Gemini CLI | Claude Messages | Gemini CLI 格式支持 |

#### 转换器接口

```typescript
interface FormatConverter {
  // 请求格式转换
  convertRequest(request: any, targetFormat: string): any;
  // 响应格式转换
  convertResponse(response: any, sourceFormat: string): any;
  // 流式响应块转换
  convertStreamChunk(chunk: any, sourceFormat: string): any;
}
```

### Circuit Breaker（熔断器）

熔断器采用经典的三态状态机模型，实现故障检测和自动恢复。

#### 状态转换图

```
                    失败次数 >= 阈值
        ┌───────────────────────────────────────┐
        │                                       ▼
    ┌───────┐                             ┌─────────┐
    │CLOSED │                             │  OPEN   │
    │ 正常  │                             │  熔断   │
    └───┬───┘                             └────┬────┘
        │                                      │
        │ 成功次数 >= 恢复阈值                  │ 熔断时间到期
        │                                      ▼
        │                               ┌───────────┐
        └───────────────────────────────│ HALF-OPEN │
                                        │   探测    │
                                        └───────────┘
```

#### 状态说明

| 状态 | 说明 | 请求处理 |
|------|------|----------|
| **CLOSED** | 正常状态 | 请求正常转发，监控失败次数 |
| **OPEN** | 熔断状态 | 请求被快速失败，跳过该供应商 |
| **HALF-OPEN** | 探测状态 | 允许少量请求验证供应商恢复情况 |

#### 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `failureThreshold` | 5 | 触发熔断的失败次数 |
| `openDuration` | 1800000（30分钟） | 熔断持续时间（毫秒） |
| `halfOpenSuccessThreshold` | 2 | 关闭熔断需要的连续成功次数 |

{% callout type="warning" title="熔断器状态存储" %}
熔断器状态存储在内存中，应用重启后会重置为 CLOSED 状态。这是有意设计，确保重启后供应商有机会被重新验证。配置信息缓存在 Redis 中以优化性能（5 分钟 TTL）。
{% /callout %}

### Response Handler（响应处理器）

响应处理器负责处理上游供应商的响应，支持流式和非流式两种模式。

#### 职责

| 职责 | 说明 |
|------|------|
| **流式转发** | 实时转发 SSE 数据块到客户端 |
| **格式转换** | 将上游响应转换为客户端期望的格式 |
| **Token 统计** | 统计输入/输出 Token 数量 |
| **成本计算** | 根据模型价格计算请求成本 |
| **错误分类** | 识别错误类型，决定是否重试 |
| **日志记录** | 记录请求元数据到数据库 |

#### 流式处理架构

```
Upstream Provider (SSE)
        │
        ▼
┌───────────────────┐
│ Response Handler  │
│  - 解析数据块      │
│  - 格式转换        │
│  - Token 计数      │
│  - 成本计算        │
└────────┬──────────┘
         │
         ▼
   Client (SSE)
```

---

## 数据流

### 请求处理流程

```
1. 客户端请求
   │
2. Auth Guard: 从 PostgreSQL 查询 API Key
   │
3. Session Guard: 从 Redis 检查 Session 绑定
   │
4. Rate Limit Guard: Redis Lua 脚本原子检查限流
   │
5. Provider Selector: 从缓存查询可用供应商
   │
6. Format Converter: 转换请求格式
   │
7. Forwarder: 发送请求到上游供应商
   │
8. Response Handler: 流式响应处理
   │
9. Message Service: 写入请求日志到 PostgreSQL
```

### Session 数据流

```
Redis Key: session:{session_id}
Value: { providerId: number, createdAt: timestamp }
TTL: 300 秒（5 分钟，可配置）

操作复杂度:
- 查询: O(1) hash get
- 创建: O(1) hash set with TTL
- 每次复用刷新 TTL（滑动窗口）
```

### 限流数据流

```
Redis Keys:
- ratelimit:rpm:{userId}:{minute}      # RPM 限制
- ratelimit:5h:{userId}:{window}       # 5 小时金额限制
- ratelimit:daily:{userId}:{day}       # 日金额限制
- ratelimit:weekly:{userId}:{week}     # 周金额限制
- ratelimit:monthly:{userId}:{month}   # 月金额限制

操作: Lua 脚本原子性 increment + check
降级: Redis 不可用时 Fail-Open（允许请求）
```

---

## 设计原则

### Fail-Open 策略

当依赖服务不可用时，系统采用 Fail-Open 策略保证服务可用性：

| 场景 | 行为 |
|------|------|
| Redis 不可用 | 限流检查跳过，允许请求通过 |
| Session 创建失败 | 每次重新选择供应商 |
| 熔断器配置加载失败 | 使用默认配置 |

{% callout type="warning" title="Fail-Open 风险" %}
Fail-Open 策略提高了可用性，但也带来风险（如限流失效可能导致成本超支）。建议监控 Redis 健康状态，确保及时恢复。
{% /callout %}

### Session 粘性

Session 粘性机制确保同一对话的请求路由到同一供应商：

| 好处 | 说明 |
|------|------|
| **提高缓存命中率** | Claude API Prompt Caching 受益 |
| **降低成本** | 缓存命中可显著降低 Token 计费 |
| **一致性体验** | 避免不同供应商响应差异 |

**复用条件**：

- `messages.length > 1`（有历史上下文）
- Redis 中存在 Session 绑定
- 绑定的供应商仍然可用

### 无状态设计

应用层完全无状态，所有状态存储在外部服务：

| 状态类型 | 存储位置 |
|----------|----------|
| 用户/Key/供应商配置 | PostgreSQL |
| Session 绑定 | Redis |
| 限流计数器 | Redis |
| 熔断器运行状态 | 内存（重启重置） |
| 熔断器配置缓存 | Redis |

---

## 扩展性考虑

### 水平扩展

系统支持通过添加应用实例实现水平扩展：

```
                    Load Balancer
                          │
          ┌───────────────┼───────────────┐
          │               │               │
      ┌───┴───┐       ┌───┴───┐       ┌───┴───┐
      │ CCH-1 │       │ CCH-2 │       │ CCH-3 │
      └───┬───┘       └───┬───┘       └───┬───┘
          │               │               │
          └───────────────┼───────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
          ┌───┴───┐               ┌───┴───┐
          │ Redis │               │Postgres│
          └───────┘               └────────┘
```

**扩展触发条件**：

| 指标 | 阈值 |
|------|------|
| CPU 使用率 | > 70% 持续 |
| 内存使用率 | > 80% |
| 请求延迟 p99 | > 200ms |

### 缓存策略

系统采用多层缓存架构：

```
┌─────────────────────────────────────┐
│     应用内存缓存 (短 TTL)            │
│  - 供应商列表                        │
│  - 错误规则                          │
│  - 敏感词列表                        │
├─────────────────────────────────────┤
│         Redis 缓存 (中 TTL)          │
│  - Session 绑定                      │
│  - 限流计数器                        │
│  - 熔断器配置缓存                    │
├─────────────────────────────────────┤
│        PostgreSQL (持久化)           │
│  - 所有业务数据                      │
└─────────────────────────────────────┘
```

**缓存失效策略**：

- 供应商配置变更：失效相关缓存
- 规则变更：重新加载规则
- Session：TTL 自动过期

### 健康检查

系统提供健康检查端点供负载均衡器使用：

```bash
GET /api/health
```

响应示例：

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

---

## 代码组织

### 目录结构

```
src/
├── app/                    # Next.js App Router
│   ├── v1/                 # 代理端点
│   │   └── _lib/           # 代理核心
│   │       ├── proxy/      # Guard Pipeline、Forwarder
│   │       ├── converters/ # 格式转换器
│   │       └── codex/      # Codex 特定逻辑
│   ├── api/                # REST API
│   │   └── actions/        # OpenAPI 文档
│   ├── dashboard/          # 管理后台页面
│   └── settings/           # 设置页面
├── actions/                # Server Actions
├── repository/             # 数据库查询
├── drizzle/                # Schema + 迁移
├── lib/                    # 共享工具
│   ├── rate-limit/         # 限流服务
│   ├── circuit-breaker.ts  # 熔断器
│   └── session-manager.ts  # Session 管理
├── types/                  # TypeScript 类型
└── components/             # React 组件
```

### 模块边界

| 模块 | 职责 | 依赖 |
|------|------|------|
| **Proxy** | 请求处理、格式转换、供应商选择 | Repository、Redis |
| **Admin** | 用户管理、供应商管理、配置 | Repository |
| **Analytics** | 统计、日志、监控 | Repository |

**依赖规则**：

- Repository 只依赖 Drizzle Schema
- Actions 依赖 Repository
- Guards 依赖 Repository 和 Redis
- UI 依赖 Actions

---

## 相关文档

- [智能调度详解](/docs/reference/intelligent-routing) - 供应商选择算法详解
- [熔断器配置](/docs/reference/circuit-breaker) - 熔断器状态机和配置
- [限流配置](/docs/reference/rate-limiting) - 多维限流机制
- [Redis 架构](/docs/reference/redis-architecture) - Redis 数据结构设计
- [环境变量](/docs/reference/env-variables) - 完整配置参考
