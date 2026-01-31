# 系统配置管理 - Round 1 Exploration Draft

## 1. 概述

Claude Code Hub 的系统配置管理采用分层架构设计，将配置分为环境变量层和数据库持久化层两大类别。环境变量层负责基础设施相关的核心配置，如数据库连接、Redis 配置、安全策略等；数据库持久化层则管理业务层面的动态配置，如系统设置、供应商配置、用户限额等。这种分层设计既保证了系统的可部署性和安全性，又提供了灵活的运行时配置能力。

配置系统的核心设计原则包括：
- **类型安全**：所有配置均通过 Zod Schema 进行严格验证
- **延迟加载**：使用 getter 模式避免构建时触发配置验证
- **Fail-Open 策略**：关键依赖（如 Redis）不可用时自动降级
- **缓存优化**：多级缓存机制减少配置读取开销
- **运行时动态更新**：数据库配置支持热更新，无需重启服务

---

## 2. 环境变量配置体系

### 2.1 配置验证架构

环境变量配置位于 `src/lib/config/env.schema.ts`，采用 Zod 进行声明式验证。该模块实现了以下核心功能：

#### 2.1.1 布尔值转换函数

由于 JavaScript 中 `Boolean("false") === true` 的特性，系统实现了专门的布尔值转换逻辑：

```typescript
const booleanTransform = (s: string) => s !== "false" && s !== "0";
```

此转换函数确保字符串 `"false"` 和 `"0"` 被正确转换为布尔值 `false`，其他所有值（包括 `"true"`、`"1"`、任意非空字符串）转换为 `true`。

#### 2.1.2 可选数值解析

针对可能为空的数值配置，实现了预处理函数：

```typescript
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return undefined;
    if (typeof val === "string") return Number(val);
    return val;
  }, schema.optional());
```

该函数将空值统一转换为 `undefined`，字符串值转换为数字，确保数值配置的灵活性。

#### 2.1.3 单例模式与延迟加载

配置对象采用单例模式管理，首次访问时才触发验证：

```typescript
let _envConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (!_envConfig) {
    _envConfig = EnvSchema.parse(process.env);
  }
  return _envConfig;
}
```

这种设计避免了在构建阶段（如 Next.js 构建时）触发环境变量验证错误。

### 2.2 核心环境变量详解

#### 2.2.1 基础环境配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `NODE_ENV` | enum | `"development"` | 运行环境：development/production/test |
| `PORT` | number | `23000` | 应用监听端口 |
| `TZ` | string | `"Asia/Shanghai"` | 系统时区，影响时间边界计算 |

`NODE_ENV` 的验证使用 `z.enum(["development", "production", "test"])`，确保只有预定义的环境值被接受。

#### 2.2.2 数据库连接配置

**DSN（数据源名称）**：

```typescript
DSN: z.preprocess((val) => {
  if (!val || typeof val !== "string") return undefined;
  if (val.includes("user:password@host:port")) return undefined;
  return val;
}, z.string().url("数据库URL格式无效").optional())
```

DSN 配置支持占位符检测，当值为模板字符串时自动转为 `undefined`，避免构建时错误。

**PostgreSQL 连接池配置**：

| 变量名 | 范围 | 默认值 | 说明 |
|--------|------|--------|------|
| `DB_POOL_MAX` | 1-200 | 生产20/开发10 | 每个进程的最大连接数 |
| `DB_POOL_IDLE_TIMEOUT` | 0-3600秒 | 20 | 空闲连接回收时间 |
| `DB_POOL_CONNECT_TIMEOUT` | 1-120秒 | 10 | 连接建立超时 |

连接池配置针对 Kubernetes 多副本部署场景设计，需要结合数据库 `max_connections` 进行分摊计算。

#### 2.2.3 消息请求写入模式

```typescript
MESSAGE_REQUEST_WRITE_MODE: z.enum(["sync", "async"]).default("async")
```

系统支持两种写入模式：
- **sync**：同步写入，兼容旧行为，但高并发会增加请求尾部阻塞
- **async**：异步批量写入（默认），降低数据库写放大与连接占用

异步模式的可调参数：

| 变量名 | 范围 | 默认值 | 说明 |
|--------|------|--------|------|
| `MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS` | 10-60000ms | 250 | 批量刷新间隔 |
| `MESSAGE_REQUEST_ASYNC_BATCH_SIZE` | 1-2000 | 200 | 单次批量写入条数 |
| `MESSAGE_REQUEST_ASYNC_MAX_PENDING` | 100-200000 | 5000 | 内存队列上限 |

#### 2.2.4 认证与安全配置

**ADMIN_TOKEN**：

```typescript
ADMIN_TOKEN: z.preprocess((val) => {
  if (!val || typeof val !== "string") return undefined;
  if (val === "change-me") return undefined;
  return val;
}, z.string().min(1, "管理员令牌不能为空").optional())
```

管理员令牌支持占位符检测（`"change-me"`），部署时必须修改为安全值。

**Cookie 安全策略**：

```typescript
ENABLE_SECURE_COOKIES: z.string().default("true").transform(booleanTransform)
```

- `true`（默认）：仅允许 HTTPS 传输 Cookie，浏览器自动放行 localhost 的 HTTP
- `false`：允许 HTTP 传输 Cookie，适用于内网部署

#### 2.2.5 Redis 与限流配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `REDIS_URL` | string | optional | Redis 连接地址，支持 `rediss://` TLS |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | boolean | `true` | 是否验证 TLS 证书 |
| `ENABLE_RATE_LIMIT` | boolean | `true` | 是否启用限流功能 |

Redis 配置实现了 Fail-Open 策略：当 Redis 不可用时，限流和 Session 统计自动降级，不影响服务可用性。

**Session 配置**：

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `SESSION_TTL` | number | 300 | Session 过期时间（秒） |
| `STORE_SESSION_MESSAGES` | boolean | `false` | 是否存储原始消息内容 |

`STORE_SESSION_MESSAGES` 控制消息存储模式：
- `false`（默认）：存储请求/响应体但对 message 内容脱敏 `[REDACTED]`
- `true`：原样存储 message 内容（注意隐私和存储空间影响）

#### 2.2.6 熔断器配置

```typescript
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS: z.string().default("false").transform(booleanTransform)
```

- `false`（默认）：网络错误（DNS 失败、连接超时等）不计入熔断器，仅供应商错误（4xx/5xx）计入
- `true`：所有错误都计入熔断器失败计数

此配置适用于网络不稳定环境（如使用代理），避免因临时网络抖动触发熔断器。

#### 2.2.7 供应商缓存配置

```typescript
ENABLE_PROVIDER_CACHE: z.string().default("true").transform(booleanTransform)
```

- `true`（默认）：启用进程级缓存，30 秒 TTL + Redis Pub/Sub 跨实例即时失效
- `false`：禁用缓存，每次请求直接查询数据库

#### 2.2.8 重试与超时配置

**最大重试次数**：

```typescript
MAX_RETRY_ATTEMPTS_DEFAULT: z.coerce
  .number()
  .min(1)
  .max(10)
  .default(2)
```

**Fetch 超时配置**（毫秒）：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `FETCH_CONNECT_TIMEOUT` | 30000 | TCP 连接建立超时（DNS、握手、TLS） |
| `FETCH_HEADERS_TIMEOUT` | 600000 | 响应头接收超时（首字节等待） |
| `FETCH_BODY_TIMEOUT` | 600000 | 请求/响应体传输超时 |

超时配置适用于不同网络环境：
- 缩短 `FETCH_CONNECT_TIMEOUT` 可快速切换到备用供应商
- 增加 `FETCH_HEADERS_TIMEOUT` 支持长时间首字节等待（如冷启动模型）

#### 2.2.9 日志配置

```typescript
LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")
DEBUG_MODE: z.string().default("false").transform(booleanTransform)
```

日志级别支持动态调整（通过 `/api/admin/log-level` API），无需重启服务。级别优先级：
- `fatal`：仅致命错误
- `error`：错误信息
- `warn`：警告 + 错误
- `info`：关键业务事件 + 警告 + 错误（推荐生产环境）
- `debug`：调试信息 + 所有级别（推荐开发环境）
- `trace`：极详细追踪 + 所有级别

#### 2.2.10 自动迁移配置

```typescript
AUTO_MIGRATE: z.string().default("true").transform(booleanTransform)
```

控制启动时是否自动执行 Drizzle 数据库迁移。生产环境可设置为 `false` 以人工控制迁移时机。

### 2.3 配置访问模式

简化配置访问通过 `src/lib/config/config.ts` 提供：

```typescript
export const config = {
  auth: {
    get adminToken() {
      return getEnvConfig().ADMIN_TOKEN;
    },
  },
};
```

使用 getter 实现延迟求值，避免构建时触发环境变量验证。

---

## 3. 数据库持久化配置

### 3.1 系统设置表（system_settings）

系统设置存储在 PostgreSQL 的 `system_settings` 表中，支持运行时动态更新。

#### 3.1.1 基础设置字段

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `siteTitle` | varchar(128) | "Claude Code Hub" | 站点标题 |
| `allowGlobalUsageView` | boolean | false | 是否允许全局用量查看 |
| `currencyDisplay` | varchar(10) | "USD" | 货币显示类型 |
| `billingModelSource` | varchar(20) | "original" | 计费模型来源 |
| `timezone` | varchar(64) | null | 系统时区（IANA 标识符） |

#### 3.1.2 日志清理配置

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableAutoCleanup` | boolean | false | 启用自动清理 |
| `cleanupRetentionDays` | integer | 30 | 日志保留天数 |
| `cleanupSchedule` | varchar(50) | "0 2 * * *" | 清理定时任务（Cron） |
| `cleanupBatchSize` | integer | 10000 | 单次清理批次大小 |

#### 3.1.3 代理与协议配置

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableHttp2` | boolean | false | 启用 HTTP/2 连接供应商 |
| `enableClientVersionCheck` | boolean | false | 启用客户端版本检查 |
| `verboseProviderError` | boolean | false | 供应商错误返回详细信息 |
| `interceptAnthropicWarmupRequests` | boolean | false | 拦截 Anthropic 预热请求 |

#### 3.1.4 响应修复配置

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableThinkingSignatureRectifier` | boolean | true | 启用 Thinking Signature 整流 |
| `enableCodexSessionIdCompletion` | boolean | true | 启用 Codex Session ID 补全 |
| `enableResponseFixer` | boolean | true | 启用响应修复器 |
| `responseFixerConfig` | jsonb | 见下文 | 响应修复详细配置 |

`responseFixerConfig` 结构：

```typescript
{
  fixTruncatedJson: true,    // 修复截断的 JSON
  fixSseFormat: true,        // 修复 SSE 格式
  fixEncoding: true,         // 修复编码问题
  maxJsonDepth: 200,         // 最大 JSON 解析深度
  maxFixSize: 1024 * 1024    // 最大修复数据大小（1MB）
}
```

#### 3.1.5 配额租赁配置

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `quotaDbRefreshIntervalSeconds` | integer | 10 | 配额数据库刷新间隔 |
| `quotaLeasePercent5h` | numeric | 0.05 | 5小时限额租赁百分比 |
| `quotaLeasePercentDaily` | numeric | 0.05 | 日限额租赁百分比 |
| `quotaLeasePercentWeekly` | numeric | 0.05 | 周限额租赁百分比 |
| `quotaLeasePercentMonthly` | numeric | 0.05 | 月限额租赁百分比 |
| `quotaLeaseCapUsd` | numeric | null | 租赁上限（美元） |

### 3.2 系统设置缓存机制

为避免每次代理请求都查询数据库，系统实现了内存缓存层（`src/lib/config/system-settings-cache.ts`）：

#### 3.2.1 缓存策略

- **缓存 TTL**：60 秒（1 分钟）
- **懒加载**：首次访问时从数据库加载
- **手动失效**：设置更新时调用 `invalidateSystemSettingsCache()`
- **Fail-Open**：读取失败时返回默认值或缓存值

#### 3.2.2 默认配置

当数据库不可用时，使用以下默认配置：

```typescript
const DEFAULT_SETTINGS = {
  enableHttp2: false,
  interceptAnthropicWarmupRequests: false,
  enableThinkingSignatureRectifier: true,
  enableCodexSessionIdCompletion: true,
  enableResponseFixer: true,
  responseFixerConfig: {
    fixTruncatedJson: true,
    fixSseFormat: true,
    fixEncoding: true,
    maxJsonDepth: 200,
    maxFixSize: 1024 * 1024,
  },
};
```

### 3.3 供应商配置

供应商配置存储在 `providers` 表中，支持丰富的调度策略：

#### 3.3.1 基础调度配置

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `weight` | integer | 1 | 权重（1-100） |
| `priority` | integer | 0 | 优先级（0-2147483647） |
| `costMultiplier` | numeric | 1.0 | 成本倍率 |
| `groupTag` | varchar(50) | null | 分组标签 |

#### 3.3.2 熔断器配置

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxRetryAttempts` | integer | null | 最大重试次数（null=使用全局默认值） |
| `circuitBreakerFailureThreshold` | integer | 5 | 失败阈值 |
| `circuitBreakerOpenDuration` | integer | 1800000 | 熔断时长（毫秒，默认30分钟） |
| `circuitBreakerHalfOpenSuccessThreshold` | integer | 2 | 半开恢复阈值 |

#### 3.3.3 网络配置

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `proxyUrl` | varchar(512) | null | 代理地址（HTTP/HTTPS/SOCKS5） |
| `proxyFallbackToDirect` | boolean | false | 代理失败时回退到直连 |

#### 3.3.4 超时配置

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `firstByteTimeoutStreamingMs` | integer | 流式首字节超时 |
| `streamingIdleTimeoutMs` | integer | 流式空闲超时 |
| `requestTimeoutNonStreamingMs` | integer | 非流式请求超时 |

### 3.4 用户与密钥配置

#### 3.4.1 用户级别配置

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `rpmLimit` | integer | 每分钟请求数限制 |
| `dailyLimitUsd` | numeric | 每日消费限额（美元） |
| `providerGroup` | varchar(200) | 供应商分组 |
| `tags` | jsonb | 用户标签数组 |
| `allowedClients` | jsonb | 允许的客户端模式 |
| `allowedModels` | jsonb | 允许的模型列表 |

#### 3.4.2 密钥级别配置

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `limit5hUsd` | numeric | 5小时消费上限 |
| `limitDailyUsd` | numeric | 日消费上限 |
| `dailyResetMode` | enum | 日限额重置模式：fixed/rolling |
| `dailyResetTime` | varchar(5) | 日限额重置时间（HH:mm） |
| `limitWeeklyUsd` | numeric | 周消费上限 |
| `limitMonthlyUsd` | numeric | 月消费上限 |
| `limitTotalUsd` | numeric | 总消费上限 |
| `limitConcurrentSessions` | integer | 并发 Session 上限 |
| `cacheTtlPreference` | varchar(10) | 缓存 TTL 偏好 |

---

## 4. 智能探测配置

### 4.1 熔断器智能探测

智能探测用于在熔断器处于 OPEN 状态时定期检查供应商恢复情况。

#### 4.1.1 环境变量配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ENABLE_SMART_PROBING` | `false` | 是否启用智能探测 |
| `PROBE_INTERVAL_MS` | `30000` | 探测周期间隔（毫秒） |
| `PROBE_TIMEOUT_MS` | `5000` | 单次探测超时（毫秒） |

#### 4.1.2 工作原理

1. 定期检查处于 OPEN 状态的熔断器
2. 使用轻量级测试请求探测供应商
3. 探测成功则提前将熔断器转为 HALF_OPEN 状态
4. 支持通过 `triggerManualProbe(providerId)` 手动触发探测

### 4.2 Provider Endpoint 探测

Endpoint 探测始终启用，用于监控所有可用端点并刷新选择排名。

#### 4.2.1 动态间隔规则

探测间隔根据端点状态动态调整（优先级顺序）：

1. **超时覆盖**（10秒）：当端点 `lastProbeErrorType === "timeout"` 且未恢复时
2. **单供应商**（10分钟）：当供应商仅有 1 个可用端点时
3. **基础间隔**（默认60秒）：其他所有端点

#### 4.2.2 配置参数

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ENDPOINT_PROBE_INTERVAL_MS` | `60000` | 基础探测间隔 |
| `ENDPOINT_PROBE_TIMEOUT_MS` | `5000` | 探测超时 |
| `ENDPOINT_PROBE_CONCURRENCY` | `10` | 并发探测数 |
| `ENDPOINT_PROBE_CYCLE_JITTER_MS` | `1000` | 周期抖动（避免惊群） |
| `ENDPOINT_PROBE_LOCK_TTL_MS` | `30000` | 分布式锁 TTL |
| `ENDPOINT_PROBE_LOG_RETENTION_DAYS` | `1` | 探测日志保留天数 |
| `ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE` | `10000` | 清理批次大小 |

---

## 5. 配置验证与 Schema

### 5.1 验证 Schema 定义

所有配置更新均通过 Zod Schema 验证，位于 `src/lib/validation/schemas.ts`。

#### 5.1.1 系统设置更新 Schema

```typescript
export const UpdateSystemSettingsSchema = z.object({
  siteTitle: z.string().min(1).max(128).optional(),
  allowGlobalUsageView: z.boolean().optional(),
  currencyDisplay: z.enum(Object.keys(CURRENCY_CONFIG)).optional(),
  billingModelSource: z.enum(["original", "redirected"]).optional(),
  timezone: z.string().refine(isValidIANATimezone).optional(),
  // ... 其他字段
});
```

#### 5.1.2 时区验证

时区验证使用 IANA 时区数据库：

```typescript
export function isValidIANATimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
```

#### 5.1.3 供应商创建/更新 Schema

供应商配置验证包含丰富的约束：

```typescript
export const CreateProviderSchema = z.object({
  name: z.string().min(1).max(64),
  url: z.string().url().max(255),
  key: z.string().min(1).max(1024),
  weight: z.number().int().min(1).max(100).default(1),
  priority: z.number().int().min(0).max(2147483647).default(0),
  cost_multiplier: z.number().min(0).default(1.0),
  // 熔断器配置
  circuit_breaker_failure_threshold: z.number().int().min(0).optional(),
  circuit_breaker_open_duration: z.number().int().min(1000).max(86400000).optional(),
  circuit_breaker_half_open_success_threshold: z.number().int().min(1).max(10).optional(),
  // 代理配置
  proxy_url: z.string().max(512).nullable().optional(),
  proxy_fallback_to_direct: z.boolean().default(false),
});
```

### 5.2 常量定义

配置约束常量集中定义，便于维护和复用：

```typescript
// src/lib/constants/provider.constants.ts
export const PROVIDER_LIMITS = {
  WEIGHT: { MIN: 1, MAX: 100 },
  MAX_RETRY_ATTEMPTS: { MIN: 1, MAX: 10 },
  LIMIT_5H_USD: { MIN: 0.1, MAX: 1000, STEP: 1 },
  LIMIT_WEEKLY_USD: { MIN: 1, MAX: 5000, STEP: 1 },
  LIMIT_MONTHLY_USD: { MIN: 10, MAX: 30000, STEP: 1 },
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 150 },
} as const;
```

---

## 6. 运行时配置更新

### 6.1 系统设置更新流程

系统设置支持通过管理界面实时更新：

1. **表单提交**：管理员在设置页面修改配置
2. **Schema 验证**：使用 `UpdateSystemSettingsSchema` 验证输入
3. **数据库更新**：调用 `updateSystemSettings()` 更新记录
4. **缓存失效**：调用 `invalidateSystemSettingsCache()` 清除内存缓存
5. **路径重验证**：使用 `revalidatePath()` 刷新 Next.js 缓存

```typescript
// src/actions/system-config.ts
export async function saveSystemSettings(formData: {...}) {
  const validated = UpdateSystemSettingsSchema.parse(formData);
  const updated = await updateSystemSettings(validated);
  
  // 使缓存失效
  invalidateSystemSettingsCache();
  
  // 重验证所有语言路径
  for (const locale of locales) {
    revalidatePath(`/${locale}/settings/config`);
    revalidatePath(`/${locale}/dashboard`);
  }
  
  return { ok: true, data: updated };
}
```

### 6.2 日志级别动态调整

日志级别支持通过 API 实时调整：

```typescript
// src/app/api/admin/log-level/route.ts
export async function POST(req: Request) {
  const { level } = await req.json();
  setLogLevel(level as LogLevel);
  return Response.json({ success: true, level });
}
```

调整后立即生效，无需重启服务。

### 6.3 时区解析策略

系统时区采用多级回退策略：

```
DB timezone -> env TZ -> UTC
```

1. 优先使用数据库 `system_settings.timezone`
2. 如果未设置，使用环境变量 `TZ`
3. 如果都未设置，默认使用 UTC

---

## 7. 配置架构设计原则

### 7.1 分层架构

Claude Code Hub 的配置系统采用清晰的分层架构：

```
┌─────────────────────────────────────────────────────────────┐
│                    运行时配置层 (Runtime)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 系统设置缓存 │  │ 熔断器状态  │  │ 日志级别            │  │
│  │ (60s TTL)   │  │ (内存+Redis)│  │ (动态可调)          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    数据库配置层 (Database)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ system_settings│ │ providers   │  │ users/keys          │  │
│  │ (全局设置)   │  │ (供应商配置)│  │ (用户/密钥限额)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    环境变量层 (Environment)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 数据库连接  │  │ Redis 配置  │  │ 安全/超时策略       │  │
│  │ (DSN)       │  │ (URL/TLS)   │  │ (Token/Timeouts)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Fail-Open 策略

关键依赖组件实现 Fail-Open 策略，确保高可用性：

- **Redis 不可用**：限流降级、Session 降级、熔断器使用内存状态
- **数据库不可用**：使用默认配置值，避免服务中断
- **配置验证失败**：使用默认值，记录警告日志

### 7.3 类型安全

全链路类型安全：

- 环境变量：`EnvConfig` 类型由 Zod Schema 推断
- 数据库配置：Drizzle ORM 提供类型安全的查询
- API 接口：Server Actions 使用 Zod 验证输入输出

### 7.4 配置热更新

支持热更新的配置：

- 系统设置（siteTitle、currencyDisplay 等）
- 日志级别
- 供应商配置（通过数据库更新）

需要重启的配置：

- 环境变量（需重启进程）
- 数据库连接池参数
- 监听端口

---

## 8. 配置最佳实践

### 8.1 部署配置建议

**生产环境必改配置**：

```bash
# 安全相关
ADMIN_TOKEN=your-secure-random-token

# 数据库
DSN=postgresql://user:password@postgres:5432/db_name

# Redis
REDIS_URL=redis://redis:6379

# 时区
TZ=Asia/Shanghai

# 自动迁移（首次部署后建议关闭）
AUTO_MIGRATE=false
```

### 8.2 性能调优建议

**高并发场景**：

```bash
# 增加连接池（需根据数据库 max_connections 调整）
DB_POOL_MAX=50

# 启用异步写入
MESSAGE_REQUEST_WRITE_MODE=async
MESSAGE_REQUEST_ASYNC_BATCH_SIZE=500

# 启用供应商缓存
ENABLE_PROVIDER_CACHE=true
```

**网络不稳定场景**：

```bash
# 增加超时时间
FETCH_CONNECT_TIMEOUT=60000

# 禁用网络错误熔断
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false

# 增加重试次数
MAX_RETRY_ATTEMPTS_DEFAULT=3
```

### 8.3 监控配置建议

```bash
# 生产环境日志级别
LOG_LEVEL=info

# 启用详细供应商错误（调试用）
# verboseProviderError: true (通过系统设置界面)

# 启用自动日志清理
# enableAutoCleanup: true (通过系统设置界面)
# cleanupRetentionDays: 7
```

---

## 9. 总结

Claude Code Hub 的配置管理系统设计体现了以下核心思想：

1. **分层清晰**：环境变量负责基础设施，数据库负责业务配置，内存缓存负责运行时优化
2. **类型安全**：全链路 Zod 验证，编译时和运行时双重保障
3. **高可用性**：Fail-Open 策略确保依赖故障时服务可用
4. **灵活可调**：支持运行时动态更新，无需频繁重启
5. **向后兼容**：默认值设计和降级策略确保平滑升级

配置系统的模块化设计使得各个组件可以独立演进，同时保持整体的一致性和可靠性。通过合理的缓存策略和验证机制，在保证性能的同时确保了配置的准确性和安全性。
