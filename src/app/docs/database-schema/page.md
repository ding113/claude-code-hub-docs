---
dimensions:
  type:
    primary: reference
    detail: schema
  level: advanced
standard_title: 数据库设计
language: zh
---

# 数据库设计

Claude Code Hub 使用 PostgreSQL 作为持久化存储，配合 Drizzle ORM 提供类型安全的数据库访问。本文档详细介绍数据库架构设计。 {% .lead %}

---

## 数据库概述

### 技术栈

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| 数据库 | PostgreSQL 15+ | 支持 JSONB、完整 ACID、优秀的索引性能 |
| ORM | Drizzle ORM | 类型安全、SQL-first、极低开销 |
| 连接池 | pg 驱动 | 兼容 pgBouncer |

### 核心数据表

系统包含 **10 个核心表**，分为以下几类：

- **用户管理**: `users`、`keys`
- **供应商管理**: `providers`
- **请求日志**: `message_request`
- **系统配置**: `system_settings`、`notification_settings`
- **规则管理**: `error_rules`、`sensitive_words`
- **价格管理**: `model_prices`

---

## 表结构详解

### users - 用户表

用户表存储所有用户信息，包括配额限制和角色设置。

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT,
  role VARCHAR DEFAULT 'user',
  rpm_limit INTEGER DEFAULT 60,
  daily_limit_usd NUMERIC(10,2) DEFAULT '100.00',
  provider_group VARCHAR(50),

  -- 多维度配额字段
  limit_5h_usd NUMERIC(10,2),
  limit_weekly_usd NUMERIC(10,2),
  limit_monthly_usd NUMERIC(10,2),
  limit_concurrent_sessions INTEGER,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);
```

**字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | SERIAL | 自增主键 |
| `name` | VARCHAR | 用户名称（必填） |
| `description` | TEXT | 用户描述 |
| `role` | VARCHAR | 角色：`admin` / `user` |
| `rpm_limit` | INTEGER | 每分钟请求限制 |
| `daily_limit_usd` | NUMERIC | 每日消费限额（美元） |
| `provider_group` | VARCHAR | 供应商分组标签 |
| `limit_5h_usd` | NUMERIC | 5 小时滚动窗口限额 |
| `limit_weekly_usd` | NUMERIC | 每周消费限额 |
| `limit_monthly_usd` | NUMERIC | 每月消费限额 |
| `limit_concurrent_sessions` | INTEGER | 并发会话数限制 |
| `deleted_at` | TIMESTAMP | 软删除标记 |

---

### keys - API Key 表

API Key 表管理用户的访问密钥，支持独立的配额限制。

```sql
CREATE TABLE keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  key VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  is_enabled BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP,

  -- Web UI 登录权限
  can_login_web_ui BOOLEAN DEFAULT TRUE,

  -- 金额限流配置
  limit_5h_usd NUMERIC(10,2),
  limit_daily_usd NUMERIC(10,2),
  daily_reset_mode daily_reset_mode DEFAULT 'fixed',
  daily_reset_time VARCHAR(5) DEFAULT '00:00',
  limit_weekly_usd NUMERIC(10,2),
  limit_monthly_usd NUMERIC(10,2),
  limit_concurrent_sessions INTEGER DEFAULT 0,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);
```

**重要特性**:

- **密钥哈希存储**: `key` 字段存储 SHA-256 哈希值，非明文
- **独立配额**: 每个 Key 可配置独立的消费限额
- **重置模式**: 支持固定时间重置（fixed）和滚动窗口（rolling）

**日重置模式枚举**:

```sql
CREATE TYPE daily_reset_mode AS ENUM ('fixed', 'rolling');
```

- `fixed`: 每天固定时间重置（由 `daily_reset_time` 指定）
- `rolling`: 24 小时滚动窗口

---

### providers - 供应商表

供应商表是系统的核心配置，定义上游 AI 服务提供商。

```sql
CREATE TABLE providers (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT,
  url VARCHAR NOT NULL,
  key VARCHAR NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  weight INTEGER NOT NULL DEFAULT 1,

  -- 优先级和分组
  priority INTEGER NOT NULL DEFAULT 0,
  cost_multiplier NUMERIC(10,4) DEFAULT '1.0',
  group_tag VARCHAR(50),

  -- 供应商类型
  provider_type VARCHAR(20) NOT NULL DEFAULT 'claude',

  -- 模型配置
  model_redirects JSONB,
  allowed_models JSONB DEFAULT NULL,
  join_claude_pool BOOLEAN DEFAULT FALSE,

  -- Codex 策略
  codex_instructions_strategy VARCHAR(20) DEFAULT 'auto',

  -- MCP 透传配置
  mcp_passthrough_type VARCHAR(20) NOT NULL DEFAULT 'none',
  mcp_passthrough_url VARCHAR(512),

  -- 配额限制
  limit_5h_usd NUMERIC(10,2),
  limit_daily_usd NUMERIC(10,2),
  daily_reset_mode daily_reset_mode DEFAULT 'fixed',
  daily_reset_time VARCHAR(5) DEFAULT '00:00',
  limit_weekly_usd NUMERIC(10,2),
  limit_monthly_usd NUMERIC(10,2),
  limit_concurrent_sessions INTEGER DEFAULT 0,

  -- 熔断器配置
  circuit_breaker_failure_threshold INTEGER DEFAULT 5,
  circuit_breaker_open_duration INTEGER DEFAULT 1800000,
  circuit_breaker_half_open_success_threshold INTEGER DEFAULT 2,

  -- 代理配置
  proxy_url VARCHAR(512),
  proxy_fallback_to_direct BOOLEAN DEFAULT FALSE,

  -- 超时配置（毫秒）
  first_byte_timeout_streaming_ms INTEGER NOT NULL DEFAULT 0,
  streaming_idle_timeout_ms INTEGER NOT NULL DEFAULT 0,
  request_timeout_non_streaming_ms INTEGER NOT NULL DEFAULT 0,

  -- 官网信息
  website_url TEXT,
  favicon_url TEXT,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);
```

**供应商类型（provider_type）**:

| 类型 | 说明 |
|------|------|
| `claude` | Anthropic 官方 API（标准认证） |
| `claude-auth` | Claude 中转服务（仅 Bearer 认证） |
| `codex` | Codex CLI (Response API) |
| `gemini-cli` | Gemini CLI |
| `gemini` | Gemini API |
| `openai-compatible` | OpenAI 兼容 API |

**模型重定向配置示例**:

```json
{
  "claude-3-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-opus": "claude-sonnet-4-20250514"
}
```

**Codex Instructions 策略**:

| 策略 | 说明 |
|------|------|
| `auto` | 透传客户端 instructions，400 错误时自动重试 |
| `force_official` | 始终使用官方 Codex CLI instructions |
| `keep_original` | 始终透传客户端 instructions，不自动重试 |

---

### message_request - 请求日志表

请求日志表记录所有通过代理的 API 请求，用于统计和审计。

```sql
CREATE TABLE message_request (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  key VARCHAR NOT NULL,
  model VARCHAR(128),
  duration_ms INTEGER,
  cost_usd NUMERIC(21,15) DEFAULT '0',
  cost_multiplier NUMERIC(10,4),

  -- 会话追踪
  session_id VARCHAR(64),
  provider_chain JSONB,

  -- 请求信息
  status_code INTEGER,
  api_type VARCHAR(20),
  endpoint VARCHAR(256),
  original_model VARCHAR(128),

  -- Token 统计
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens INTEGER,

  -- 错误信息
  error_message TEXT,
  blocked_by VARCHAR(50),
  blocked_reason TEXT,

  -- 客户端信息
  user_agent VARCHAR(512),
  messages_count INTEGER,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);
```

**provider_chain 示例**:

```json
[
  {"id": 1, "name": "Anthropic Primary"},
  {"id": 2, "name": "Anthropic Backup"}
]
```

---

### system_settings - 系统设置表

系统级全局配置表，采用单行设计。

```sql
CREATE TABLE system_settings (
  id SERIAL PRIMARY KEY,
  site_title VARCHAR(128) NOT NULL DEFAULT 'Claude Code Hub',
  allow_global_usage_view BOOLEAN NOT NULL DEFAULT FALSE,

  -- 货币显示
  currency_display VARCHAR(10) NOT NULL DEFAULT 'USD',

  -- 计费模型来源
  billing_model_source VARCHAR(20) NOT NULL DEFAULT 'original',

  -- 日志清理配置
  enable_auto_cleanup BOOLEAN DEFAULT FALSE,
  cleanup_retention_days INTEGER DEFAULT 30,
  cleanup_schedule VARCHAR(50) DEFAULT '0 2 * * *',
  cleanup_batch_size INTEGER DEFAULT 10000,

  -- 客户端版本检查
  enable_client_version_check BOOLEAN NOT NULL DEFAULT FALSE,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**计费模型来源（billing_model_source）**:

- `original`: 使用重定向前的模型计费
- `redirected`: 使用重定向后的模型计费

---

### notification_settings - 通知设置表

企业微信机器人等通知渠道配置。

```sql
CREATE TABLE notification_settings (
  id SERIAL PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- 熔断器告警
  circuit_breaker_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  circuit_breaker_webhook VARCHAR(512),

  -- 每日排行榜
  daily_leaderboard_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  daily_leaderboard_webhook VARCHAR(512),
  daily_leaderboard_time VARCHAR(10) DEFAULT '09:00',
  daily_leaderboard_top_n INTEGER DEFAULT 5,

  -- 成本预警
  cost_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  cost_alert_webhook VARCHAR(512),
  cost_alert_threshold NUMERIC(5,2) DEFAULT '0.80',
  cost_alert_check_interval INTEGER DEFAULT 60,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

### error_rules - 错误规则表

定义错误响应的匹配和覆写规则。

```sql
CREATE TABLE error_rules (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  match_type VARCHAR(20) NOT NULL DEFAULT 'regex',
  category VARCHAR(50) NOT NULL,
  description TEXT,

  -- 响应覆写
  override_response JSONB,
  override_status_code INTEGER,

  -- 状态
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 0,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**匹配类型（match_type）**:

| 类型 | 说明 |
|------|------|
| `regex` | 正则表达式匹配 |
| `contains` | 包含字符串匹配 |
| `exact` | 精确字符串匹配 |

**override_response 示例**:

```json
{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "message": "请求频率超限，请稍后重试"
  }
}
```

---

### sensitive_words - 敏感词表

内容过滤的敏感词配置。

```sql
CREATE TABLE sensitive_words (
  id SERIAL PRIMARY KEY,
  word VARCHAR(255) NOT NULL,
  match_type VARCHAR(20) NOT NULL DEFAULT 'contains',
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

### model_prices - 模型价格表

AI 模型的定价信息，支持历史追溯。

```sql
CREATE TABLE model_prices (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR NOT NULL,
  price_data JSONB NOT NULL,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**price_data 结构示例**:

```json
{
  "input": 0.000003,
  "output": 0.000015,
  "cache_creation": 0.00000375,
  "cache_read": 0.0000003
}
```

---

## 索引策略

### 主键索引

所有表都使用 `id` 字段作为自增主键。

### 复合索引

系统针对高频查询场景设计了多个复合索引：

**users 表索引**:

```sql
-- 优化用户列表查询（按角色排序，管理员优先）
CREATE INDEX idx_users_active_role_sort
  ON users(deleted_at, role, id)
  WHERE deleted_at IS NULL;

-- 基础索引
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_deleted_at ON users(deleted_at);
```

**keys 表索引**:

```sql
CREATE INDEX idx_keys_user_id ON keys(user_id);
CREATE INDEX idx_keys_created_at ON keys(created_at);
CREATE INDEX idx_keys_deleted_at ON keys(deleted_at);
```

**providers 表索引**:

```sql
-- 优化启用状态的供应商查询（按优先级和权重排序）
CREATE INDEX idx_providers_enabled_priority
  ON providers(is_enabled, priority, weight)
  WHERE deleted_at IS NULL;

-- 分组查询优化
CREATE INDEX idx_providers_group
  ON providers(group_tag)
  WHERE deleted_at IS NULL;
```

**message_request 表索引**:

```sql
-- 优化统计查询（用户 + 时间 + 费用）
CREATE INDEX idx_message_request_user_date_cost
  ON message_request(user_id, created_at, cost_usd)
  WHERE deleted_at IS NULL;

-- 优化用户查询（按创建时间倒序）
CREATE INDEX idx_message_request_user_query
  ON message_request(user_id, created_at)
  WHERE deleted_at IS NULL;

-- Session 查询索引
CREATE INDEX idx_message_request_session_id
  ON message_request(session_id)
  WHERE deleted_at IS NULL;

-- Endpoint 过滤查询索引
CREATE INDEX idx_message_request_endpoint
  ON message_request(endpoint)
  WHERE deleted_at IS NULL;
```

**error_rules 表索引**:

```sql
CREATE INDEX idx_error_rules_enabled ON error_rules(is_enabled, priority);
CREATE UNIQUE INDEX unique_pattern ON error_rules(pattern);
CREATE INDEX idx_category ON error_rules(category);
CREATE INDEX idx_match_type ON error_rules(match_type);
```

**model_prices 表索引**:

```sql
-- 优化获取最新价格
CREATE INDEX idx_model_prices_latest
  ON model_prices(model_name, created_at DESC);
```

---

## 设计模式

### 软删除模式

所有主要业务表都采用软删除模式，通过 `deleted_at` 字段标记删除状态：

```typescript
// 查询时过滤已删除记录
const users = await db.query.users.findMany({
  where: isNull(users.deletedAt)
});

// 软删除操作
await db.update(users)
  .set({ deletedAt: new Date() })
  .where(eq(users.id, userId));
```

**优点**:
- 保留历史数据，支持审计和恢复
- 保持外键引用完整性
- 支持数据分析和统计

### JSON 列使用

系统在以下场景使用 JSONB 列存储灵活数据：

| 表 | 字段 | 用途 |
|---|------|------|
| `providers` | `model_redirects` | 模型名称映射 |
| `providers` | `allowed_models` | 允许的模型列表 |
| `message_request` | `provider_chain` | 请求路由历史 |
| `model_prices` | `price_data` | 灵活的定价结构 |
| `error_rules` | `override_response` | 错误响应覆写 |

### 时间戳约定

所有表遵循统一的时间戳约定：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `created_at` | 记录创建时间 | `NOW()` |
| `updated_at` | 最后更新时间 | `NOW()` |
| `deleted_at` | 软删除时间 | `NULL` |

所有时间戳字段均使用 `TIMESTAMP WITH TIME ZONE` 类型，确保时区正确性。

---

## 关系图

```
┌─────────────────┐     ┌─────────────────┐
│     users       │     │    providers    │
├─────────────────┤     ├─────────────────┤
│ id (PK)         │     │ id (PK)         │
│ name            │     │ name            │
│ role            │     │ url             │
│ limits...       │     │ key             │
└────────┬────────┘     │ weight          │
         │              │ provider_type   │
         │              └────────┬────────┘
         ▼                       │
┌─────────────────┐              │
│      keys       │              │
├─────────────────┤              │
│ id (PK)         │              │
│ user_id (FK)────┼──────────────┤
│ key             │              │
│ limits...       │              │
└─────────────────┘              │
                                 ▼
                        ┌─────────────────┐
                        │ message_request │
                        ├─────────────────┤
                        │ id (PK)         │
                        │ user_id (FK)    │
                        │ provider_id(FK) │
                        │ session_id      │
                        │ cost_usd        │
                        │ tokens...       │
                        └─────────────────┘
```

---

## Drizzle ORM 定义

完整的 Schema 定义位于 `src/drizzle/schema.ts`：

```typescript
import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

// 枚举定义
export const dailyResetModeEnum = pgEnum('daily_reset_mode', ['fixed', 'rolling']);

// 用户表
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  // ... 其他字段
}, (table) => ({
  usersActiveRoleSortIdx: index('idx_users_active_role_sort')
    .on(table.deletedAt, table.role, table.id)
    .where(sql`${table.deletedAt} IS NULL`),
}));

// 关系定义
export const usersRelations = relations(users, ({ many }) => ({
  keys: many(keys),
  messageRequests: many(messageRequest),
}));
```

---

## 数据迁移

### 迁移命令

```bash
# 生成迁移文件
bun run drizzle-kit generate

# 执行迁移
bun run drizzle-kit migrate

# 推送 Schema 变更（开发环境）
bun run drizzle-kit push
```

### 迁移最佳实践

1. **向后兼容**: 新增字段应设置合理默认值
2. **分步迁移**: 大型变更拆分为多个小迁移
3. **数据备份**: 生产环境迁移前务必备份
4. **索引优先**: 新增索引时使用 `CONCURRENTLY` 避免锁表

{% callout type="warning" title="生产环境注意事项" %}
在生产环境执行迁移前，请确保已备份数据库，并在低峰期进行操作。
{% /callout %}
