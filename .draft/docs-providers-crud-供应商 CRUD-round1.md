# 供应商 CRUD 操作 - Round 1 探索草稿

## Intent Analysis

供应商（Provider）是 Claude Code Hub 中用于配置上游 AI 服务提供商的核心实体。供应商 CRUD 操作允许管理员添加、查看、修改和删除 AI 服务提供商的配置，包括 Anthropic、OpenAI 兼容 API、Codex、Gemini 等多种类型。

供应商管理的核心意图包括：

1. **多类型供应商支持**：系统支持 6 种供应商类型（claude、claude-auth、codex、gemini、gemini-cli、openai-compatible），每种类型有不同的认证方式和 API 格式
2. **智能路由基础**：供应商的权重、优先级、分组标签等属性是智能路由算法的核心输入
3. **成本管控**：通过成本倍率、消费限额等字段实现精细化的成本控制
4. **高可用保障**：熔断器配置、超时设置、代理配置等确保服务稳定性
5. **供应商聚合**：通过 vendor 实体按官网域名归一聚合，实现端点池管理

## Behavior Summary

### 供应商数据模型

供应商数据存储在 PostgreSQL 数据库中，主要涉及三个表：

**1. providers 表**（`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` 第 148-297 行）

核心字段包括：

```typescript
// 基础信息
id: serial('id').primaryKey()
name: varchar('name').notNull()           // 供应商名称
description: text('description')          // 描述
url: varchar('url').notNull()             // API 地址
key: varchar('key').notNull()             // API 密钥
providerVendorId: integer('provider_vendor_id').notNull()  // 关联的 vendor

// 状态控制
isEnabled: boolean('is_enabled').notNull().default(true)  // 是否启用
weight: integer('weight').notNull().default(1)            // 权重 1-100

// 优先级和分组
priority: integer('priority').notNull().default(0)        // 优先级
costMultiplier: numeric('cost_multiplier').default('1.0') // 成本倍率
groupTag: varchar('group_tag', { length: 50 })            // 分组标签

// 供应商类型
providerType: varchar('provider_type', { length: 20 })
  .notNull()
  .default('claude')
  .$type<ProviderType>()  // 'claude' | 'claude-auth' | 'codex' | 'gemini' | 'gemini-cli' | 'openai-compatible'

// 模型配置
preserveClientIp: boolean('preserve_client_ip').notNull().default(false)
modelRedirects: jsonb('model_redirects').$type<Record<string, string>>()  // 模型重定向
allowedModels: jsonb('allowed_models').$type<string[] | null>().default(null)  // 允许/声明的模型
joinClaudePool: boolean('join_claude_pool').default(false)  // 加入 Claude 调度池

// MCP 透传配置
mcpPassthroughType: varchar('mcp_passthrough_type', { length: 20 })
  .notNull()
  .default('none')
  .$type<'none' | 'minimax' | 'glm' | 'custom'>()
mcpPassthroughUrl: varchar('mcp_passthrough_url', { length: 512 })

// 金额限流配置
limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 })
limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 })
dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed').notNull()
dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00')
limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 })
limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 })
limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 })
totalCostResetAt: timestamp('total_cost_reset_at', { withTimezone: true })
limitConcurrentSessions: integer('limit_concurrent_sessions').default(0)

// 熔断器配置
maxRetryAttempts: integer('max_retry_attempts')
circuitBreakerFailureThreshold: integer('circuit_breaker_failure_threshold').default(5)
circuitBreakerOpenDuration: integer('circuit_breaker_open_duration').default(1800000)  // 30分钟
circuitBreakerHalfOpenSuccessThreshold: integer('circuit_breaker_half_open_success_threshold').default(2)

// 代理配置
proxyUrl: varchar('proxy_url', { length: 512 })
proxyFallbackToDirect: boolean('proxy_fallback_to_direct').default(false)

// 超时配置（毫秒）
firstByteTimeoutStreamingMs: integer('first_byte_timeout_streaming_ms').notNull().default(0)
streamingIdleTimeoutMs: integer('streaming_idle_timeout_ms').notNull().default(0)
requestTimeoutNonStreamingMs: integer('request_timeout_non_streaming_ms').notNull().default(0)

// 特殊属性配置
cacheTtlPreference: varchar('cache_ttl_preference', { length: 10 })
context1mPreference: varchar('context_1m_preference', { length: 20 })

// Codex 参数覆写
codexReasoningEffortPreference: varchar('codex_reasoning_effort_preference', { length: 20 })
codexReasoningSummaryPreference: varchar('codex_reasoning_summary_preference', { length: 20 })
codexTextVerbosityPreference: varchar('codex_text_verbosity_preference', { length: 10 })
codexParallelToolCallsPreference: varchar('codex_parallel_tool_calls_preference', { length: 10 })

// 废弃字段（保留向后兼容）
tpm: integer('tpm').default(0)
rpm: integer('rpm').default(0)
rpd: integer('rpd').default(0)
cc: integer('cc').default(0)

// 时间戳
createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
deletedAt: timestamp('deleted_at', { withTimezone: true })  // 软删除标记
```

**2. provider_vendors 表**（`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` 第 132-146 行）

供应商聚合实体，按官网域名归一：

```typescript
export const providerVendors = pgTable('provider_vendors', {
  id: serial('id').primaryKey(),
  websiteDomain: varchar('website_domain', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 200 }),
  websiteUrl: text('website_url'),
  faviconUrl: text('favicon_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  providerVendorsWebsiteDomainUnique: uniqueIndex('uniq_provider_vendors_website_domain').on(
    table.websiteDomain
  ),
}));
```

**3. provider_endpoints 表**（`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` 第 299-342 行）

端点池管理表：

```typescript
export const providerEndpoints = pgTable('provider_endpoints', {
  id: serial('id').primaryKey(),
  vendorId: integer('vendor_id')
    .notNull()
    .references(() => providerVendors.id, { onDelete: 'cascade' }),
  providerType: varchar('provider_type', { length: 20 })
    .notNull()
    .default('claude')
    .$type<ProviderType>(),
  url: text('url').notNull(),
  label: varchar('label', { length: 200 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  // 测活快照
  lastProbedAt: timestamp('last_probed_at', { withTimezone: true }),
  lastProbeOk: boolean('last_probe_ok'),
  lastProbeStatusCode: integer('last_probe_status_code'),
  lastProbeLatencyMs: integer('last_probe_latency_ms'),
  lastProbeErrorType: varchar('last_probe_error_type', { length: 64 }),
  lastProbeErrorMessage: text('last_probe_error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

### TypeScript 类型定义

**Provider 类型**（`/Users/ding/Github/claude-code-hub/src/types/provider.ts` 第 39-144 行）

```typescript
export interface Provider {
  id: number;
  name: string;
  url: string;
  key: string;
  providerVendorId: number | null;
  isEnabled: boolean;
  weight: number;
  priority: number;
  costMultiplier: number;
  groupTag: string | null;
  providerType: ProviderType;  // 'claude' | 'claude-auth' | 'codex' | 'gemini' | 'gemini-cli' | 'openai-compatible'
  preserveClientIp: boolean;
  modelRedirects: Record<string, string> | null;
  allowedModels: string[] | null;
  joinClaudePool: boolean;
  codexInstructionsStrategy: CodexInstructionsStrategy;
  mcpPassthroughType: McpPassthroughType;
  mcpPassthroughUrl: string | null;
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  totalCostResetAt: Date | null;
  limitConcurrentSessions: number;
  maxRetryAttempts: number | null;
  circuitBreakerFailureThreshold: number;
  circuitBreakerOpenDuration: number;  // 毫秒
  circuitBreakerHalfOpenSuccessThreshold: number;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
  firstByteTimeoutStreamingMs: number;
  streamingIdleTimeoutMs: number;
  requestTimeoutNonStreamingMs: number;
  websiteUrl: string | null;
  faviconUrl: string | null;
  cacheTtlPreference: CacheTtlPreference | null;
  context1mPreference: Context1mPreference | null;
  codexReasoningEffortPreference: CodexReasoningEffortPreference | null;
  codexReasoningSummaryPreference: CodexReasoningSummaryPreference | null;
  codexTextVerbosityPreference: CodexTextVerbosityPreference | null;
  codexParallelToolCallsPreference: CodexParallelToolCallsPreference | null;
  tpm: number | null;
  rpm: number | null;
  rpd: number | null;
  cc: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}
```

**CreateProviderData 类型**（`/Users/ding/Github/claude-code-hub/src/types/provider.ts` 第 235-303 行）

创建供应商时使用的数据类型，字段与 Provider 类似但使用蛇形命名法（is_enabled、cost_multiplier 等）。

**UpdateProviderData 类型**（`/Users/ding/Github/claude-code-hub/src/types/provider.ts` 第 305-373 行）

更新供应商时使用的数据类型，所有字段都是可选的。

### 供应商状态管理

供应商的启用/禁用状态通过 `isEnabled` 字段控制，这是一个核心的运行时开关：

**启用状态的作用域：**

1. **路由决策**：禁用的供应商不会参与智能路由选择
2. **熔断器状态**：禁用供应商的熔断器状态会被忽略
3. **统计计算**：禁用供应商仍会计入历史统计，但不参与新的请求分配
4. **缓存策略**：状态变更会触发跨实例缓存失效

**状态变更流程：**

```typescript
// 1. 更新数据库状态
await updateProvider(providerId, { is_enabled: false });

// 2. 广播缓存失效（跨实例同步）
await broadcastProviderCacheInvalidation({ operation: "edit", providerId });

// 3. 运行时立即生效（下次路由时生效）
```

**批量状态管理：**

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 1006-1071 行
export async function batchUpdateProviders(params: {
  providerIds: number[];
  updates: {
    is_enabled?: boolean;
    priority?: number;
    weight?: number;
    cost_multiplier?: number;
    group_tag?: string | null;
  };
}): Promise<ActionResult<{ updatedCount: number }>> {
  const BATCH_OPERATION_MAX_SIZE = 500;
  
  if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
    return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
  }
  
  const updatedCount = await updateProvidersBatch(providerIds, repositoryUpdates);
  await broadcastProviderCacheInvalidation({ operation: "edit", providerId: providerIds[0] });
  
  return { ok: true, data: { updatedCount } };
}
```

### 供应商分组机制

分组标签（`groupTag`）支持多标签以逗号分隔，用于实现供应商的灵活分组：

```typescript
// 分组标签解析逻辑
const groups = groupTag
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
```

**分组的使用场景：**

1. **用户-供应商绑定**：用户通过 `providerGroup` 字段指定可访问的供应商分组
2. **路由隔离**：不同分组可以实现请求流量的物理隔离
3. **灰度发布**：新供应商可以先放入测试分组，验证后再加入生产分组

**获取所有分组：**

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 752-776 行
export async function getDistinctProviderGroups(): Promise<string[]> {
  const result = await db
    .selectDistinct({ groupTag: providers.groupTag })
    .from(providers)
    .where(
      and(
        isNull(providers.deletedAt),
        and(isNotNull(providers.groupTag), ne(providers.groupTag, ""))
      )
    )
    .orderBy(providers.groupTag);

  // 拆分逗号分隔的标签并去重
  const allTags = result
    .map((r) => r.groupTag)
    .filter((tag): tag is string => tag !== null)
    .flatMap((tag) =>
      tag
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );

  return [...new Set(allTags)].sort();
}
```

## Config/Commands

### Repository 层 CRUD 操作

Repository 层位于 `/Users/ding/Github/claude-code-hub/src/repository/provider.ts`，提供数据库直接操作：

#### Create - 创建供应商

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 17-153 行
export async function createProvider(providerData: CreateProviderData): Promise<Provider> {
  // 1. 获取或创建 providerVendor
  const providerVendorId = await getOrCreateProviderVendorIdFromUrls({
    providerUrl: providerData.url,
    websiteUrl: providerData.website_url ?? null,
    faviconUrl: providerData.favicon_url ?? null,
    displayName: providerData.name,
  });

  // 2. 构建数据库数据
  const dbData = {
    name: providerData.name,
    url: providerData.url,
    key: providerData.key,
    providerVendorId,
    isEnabled: providerData.is_enabled,
    weight: providerData.weight,
    priority: providerData.priority,
    costMultiplier: providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0",
    // ... 其他字段
  };

  // 3. 插入数据库
  const [provider] = await db.insert(providers).values(dbData).returning({
    id: providers.id,
    name: providers.name,
    // ... 返回所有字段
  });

  // 4. 自动创建端点
  if (created.providerVendorId) {
    await ensureProviderEndpointExistsForUrl({
      vendorId: created.providerVendorId,
      providerType: created.providerType,
      url: created.url,
    });
  }

  return created;
}
```

#### Read - 查询供应商

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 155-225 行
// 分页查询供应商列表
export async function findProviderList(
  limit: number = 50,
  offset: number = 0
): Promise<Provider[]> {
  const result = await db
    .select({ /* 所有字段 */ })
    .from(providers)
    .where(isNull(providers.deletedAt))  // 排除软删除
    .orderBy(desc(providers.createdAt))
    .limit(limit)
    .offset(offset);

  return result.map(toProvider);
}

// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 234-299 行
// 获取所有供应商（绕过缓存，直接从数据库读取）
export async function findAllProvidersFresh(): Promise<Provider[]> {
  const result = await db
    .select({ /* 所有字段 */ })
    .from(providers)
    .where(isNull(providers.deletedAt))
    .orderBy(desc(providers.createdAt));

  return result.map(toProvider);
}

// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 301-312 行
// 获取所有供应商（带缓存）
export async function findAllProviders(): Promise<Provider[]> {
  return getCachedProviders(findAllProvidersFresh);
}

// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 314-374 行
// 根据 ID 查询单个供应商
export async function findProviderById(id: number): Promise<Provider | null> {
  const [provider] = await db
    .select({ /* 所有字段 */ })
    .from(providers)
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)));

  if (!provider) return null;
  return toProvider(provider);
}
```

#### Update - 更新供应商

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 376-593 行
export async function updateProvider(
  id: number,
  providerData: UpdateProviderData
): Promise<Provider | null> {
  // 空更新直接返回
  if (Object.keys(providerData).length === 0) {
    return findProviderById(id);
  }

  // 构建更新数据
  const dbData: any = { updatedAt: new Date() };
  if (providerData.name !== undefined) dbData.name = providerData.name;
  if (providerData.url !== undefined) dbData.url = providerData.url;
  if (providerData.key !== undefined) dbData.key = providerData.key;
  if (providerData.is_enabled !== undefined) dbData.isEnabled = providerData.is_enabled;
  // ... 其他字段

  // 处理 vendor 变更
  let previousVendorId: number | null = null;
  if (providerData.url !== undefined || providerData.website_url !== undefined) {
    // 获取当前记录
    const [current] = await db.select({ /* ... */ }).from(providers).where(...);
    if (current) {
      previousVendorId = current.providerVendorId;
      const providerVendorId = await getOrCreateProviderVendorIdFromUrls({
        providerUrl: providerData.url ?? current.url,
        websiteUrl: providerData.website_url ?? current.websiteUrl,
        faviconUrl: providerData.favicon_url ?? current.faviconUrl,
        displayName: providerData.name ?? current.name,
      });
      dbData.providerVendorId = providerVendorId;
    }
  }

  // 执行更新
  const [provider] = await db
    .update(providers)
    .set(dbData)
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
    .returning({ /* 所有字段 */ });

  if (!provider) return null;
  const transformed = toProvider(provider);

  // 更新端点
  if (providerData.url !== undefined || providerData.provider_type !== undefined) {
    await ensureProviderEndpointExistsForUrl({
      vendorId: transformed.providerVendorId,
      providerType: transformed.providerType,
      url: transformed.url,
    });
  }

  // 清理空 vendor
  if (previousVendorId && transformed.providerVendorId !== previousVendorId) {
    await tryDeleteProviderVendorIfEmpty(previousVendorId);
  }

  return transformed;
}

// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 595-630 行
// 批量更新优先级
export async function updateProviderPrioritiesBatch(
  updates: Array<{ id: number; priority: number }>
): Promise<number> {
  // 使用 CASE WHEN 批量更新
  const query = sql`
    UPDATE providers
    SET
      priority = CASE id ${sql.join(cases, sql` `)} ELSE priority END,
      updated_at = NOW()
    WHERE id IN (${idList}) AND deleted_at IS NULL
  `;
  const result = await db.execute(query);
  return (result as any).rowCount || 0;
}

// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 650-699 行
// 批量更新多个字段
export async function updateProvidersBatch(
  ids: number[],
  updates: BatchProviderUpdates
): Promise<number> {
  // 支持批量更新：isEnabled, priority, weight, costMultiplier, groupTag
  const result = await db
    .update(providers)
    .set(setClauses)
    .where(sql`id IN (${idList}) AND deleted_at IS NULL`)
    .returning({ id: providers.id });
  return result.length;
}
```

#### Delete - 删除供应商

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 632-640 行
// 软删除单个供应商
export async function deleteProvider(id: number): Promise<boolean> {
  const result = await db
    .update(providers)
    .set({ deletedAt: new Date() })
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
    .returning({ id: providers.id });

  return result.length > 0;
}

// /Users/ding/Github/claude-code-hub/src/repository/provider.ts 第 701-724 行
// 批量软删除
export async function deleteProvidersBatch(ids: number[]): Promise<number> {
  const result = await db
    .update(providers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(sql`id IN (${idList}) AND deleted_at IS NULL`)
    .returning({ id: providers.id });
  return result.length;
}
```

### Action 层业务操作

Action 层位于 `/Users/ding/Github/claude-code-hub/src/actions/providers.ts`，处理业务逻辑和权限控制：

#### 获取供应商列表

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 164-307 行
export async function getProviders(): Promise<ProviderDisplay[]> {
  // 权限检查
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return [];
  }

  // 获取供应商列表
  const providers = await findAllProvidersFresh();

  // 转换为显示格式
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    url: provider.url,
    maskedKey: maskKey(provider.key),  // 脱敏显示
    isEnabled: provider.isEnabled,
    weight: provider.weight,
    priority: provider.priority,
    costMultiplier: provider.costMultiplier,
    groupTag: provider.groupTag,
    providerType: provider.providerType,
    // ... 其他字段
    createdAt: createdAtStr,
    updatedAt: updatedAtStr,
    todayTotalCostUsd: stats?.today_cost ?? "0",
    todayCallCount: stats?.today_calls ?? 0,
    lastCallTime: lastCallTimeStr,
    lastCallModel: stats?.last_call_model ?? null,
  }));
}
```

#### 添加供应商

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 442-605 行
export async function addProvider(data: {
  name: string;
  url: string;
  key: string;
  is_enabled?: boolean;
  weight?: number;
  priority?: number;
  cost_multiplier?: number;
  group_tag?: string | null;
  provider_type?: ProviderType;
  // ... 其他字段
}): Promise<ActionResult> {
  // 权限检查
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  // 代理 URL 格式验证
  if (data.proxy_url && !isValidProxyUrl(data.proxy_url)) {
    return {
      ok: false,
      error: "代理地址格式无效，支持格式: http://, https://, socks5://, socks4://",
    };
  }

  // Schema 验证
  const validated = CreateProviderSchema.parse(data);

  // 自动生成 favicon
  let faviconUrl: string | null = null;
  if (validated.website_url) {
    const url = new URL(validated.website_url);
    const domain = url.hostname;
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  }

  // 构建 payload
  const payload = { ...validated, favicon_url: faviconUrl };

  // 创建供应商
  const provider = await createProvider(payload);

  // 同步熔断器配置到 Redis
  await saveProviderCircuitConfig(provider.id, {
    failureThreshold: provider.circuitBreakerFailureThreshold,
    openDuration: provider.circuitBreakerOpenDuration,
    halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
  });

  // 广播缓存失效通知
  await broadcastProviderCacheInvalidation({ operation: "add", providerId: provider.id });

  return { ok: true };
}
```

#### 编辑供应商

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 608-739 行
export async function editProvider(
  providerId: number,
  data: {
    name?: string;
    url?: string;
    key?: string;
    is_enabled?: boolean;
    // ... 其他可选字段
  }
): Promise<ActionResult> {
  // 权限检查
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  // 代理 URL 验证
  if (data.proxy_url && !isValidProxyUrl(data.proxy_url)) {
    return { ok: false, error: "代理地址格式无效" };
  }

  // Schema 验证
  const validated = UpdateProviderSchema.parse(data);

  // 更新 favicon（如果 website_url 变更）
  let faviconUrl: string | null | undefined;
  if (validated.website_url !== undefined) {
    if (validated.website_url) {
      const url = new URL(validated.website_url);
      faviconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
    } else {
      faviconUrl = null;
    }
  }

  // 更新供应商
  const provider = await updateProvider(providerId, payload);
  if (!provider) {
    return { ok: false, error: "供应商不存在" };
  }

  // 同步熔断器配置（如有变更）
  const hasCircuitConfigChange =
    validated.circuit_breaker_failure_threshold !== undefined ||
    validated.circuit_breaker_open_duration !== undefined ||
    validated.circuit_breaker_half_open_success_threshold !== undefined;

  if (hasCircuitConfigChange) {
    await saveProviderCircuitConfig(providerId, {
      failureThreshold: provider.circuitBreakerFailureThreshold,
      openDuration: provider.circuitBreakerOpenDuration,
      halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
    });
    clearConfigCache(providerId);
  }

  // 广播缓存失效
  await broadcastProviderCacheInvalidation({ operation: "edit", providerId });

  return { ok: true };
}
```

#### 删除供应商

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 742-781 行
export async function removeProvider(providerId: number): Promise<ActionResult> {
  // 权限检查
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  // 获取供应商信息（用于后续清理）
  const provider = await findProviderById(providerId);

  // 软删除
  await deleteProvider(providerId);

  // 清除内存缓存
  clearConfigCache(providerId);
  await clearProviderState(providerId);

  // 删除 Redis 缓存
  await deleteProviderCircuitConfig(providerId);

  // 自动清理：如果 vendor 没有活跃的 providers/endpoints，则删除
  if (provider?.providerVendorId) {
    await tryDeleteProviderVendorIfEmpty(provider.providerVendorId);
  }

  // 广播缓存失效
  await broadcastProviderCacheInvalidation({ operation: "remove", providerId });

  return { ok: true };
}
```

#### 批量删除供应商

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 1073-1121 行
export async function batchDeleteProviders(
  params: { providerIds: number[] }
): Promise<ActionResult<{ deletedCount: number }>> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  const { providerIds } = params;

  if (!providerIds || providerIds.length === 0) {
    return { ok: false, error: "请选择要删除的供应商" };
  }

  if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
    return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
  }

  const deletedCount = await deleteProvidersBatch(providerIds);

  // 清理所有被删除供应商的缓存
  for (const id of providerIds) {
    clearProviderState(id);
    clearConfigCache(id);
  }

  await broadcastProviderCacheInvalidation({
    operation: "remove",
    providerId: providerIds[0],
  });

  return { ok: true, data: { deletedCount } };
}
```

#### 自动排序供应商优先级

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 783-907 行
export async function autoSortProviderPriority(args: {
  confirm: boolean;
}): Promise<ActionResult<AutoSortResult>> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  const providers = await findAllProvidersFresh();

  // 按成本倍率分组
  const groupsByCostMultiplier = new Map<number, typeof providers>();
  for (const provider of providers) {
    const costMultiplier = Number(provider.costMultiplier);
    const bucket = groupsByCostMultiplier.get(costMultiplier);
    if (bucket) {
      bucket.push(provider);
    } else {
      groupsByCostMultiplier.set(costMultiplier, [provider]);
    }
  }

  // 按成本倍率排序分配优先级
  const sortedCostMultipliers = Array.from(groupsByCostMultiplier.keys()).sort((a, b) => a - b);
  const changes: Array<{ providerId: number; name: string; oldPriority: number; newPriority: number }> = [];

  for (const [priority, costMultiplier] of sortedCostMultipliers.entries()) {
    const groupProviders = groupsByCostMultiplier.get(costMultiplier) ?? [];
    for (const provider of groupProviders) {
      const oldPriority = provider.priority ?? 0;
      const newPriority = priority;
      if (oldPriority !== newPriority) {
        changes.push({ providerId: provider.id, name: provider.name, oldPriority, newPriority });
      }
    }
  }

  if (args.confirm && changes.length > 0) {
    await updateProviderPrioritiesBatch(
      changes.map((change) => ({ id: change.providerId, priority: change.newPriority }))
    );
    await publishProviderCacheInvalidation();
  }

  return {
    ok: true,
    data: {
      groups,
      changes,
      summary: {
        totalProviders: providers.length,
        changedCount: changes.length,
        groupCount: groups.length,
      },
      applied: args.confirm,
    },
  };
}
```

#### 获取供应商限额使用情况

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 1169-1264 行
export async function getProviderLimitUsage(providerId: number): Promise<
  ActionResult<{
    cost5h: { current: number; limit: number | null; resetInfo: string };
    costDaily: { current: number; limit: number | null; resetAt?: Date };
    costWeekly: { current: number; limit: number | null; resetAt: Date };
    costMonthly: { current: number; limit: number | null; resetAt: Date };
    concurrentSessions: { current: number; limit: number };
  }>
> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  const provider = await findProviderById(providerId);
  if (!provider) {
    return { ok: false, error: "供应商不存在" };
  }

  // 计算各周期的时间范围
  const [range5h, rangeDaily, rangeWeekly, rangeMonthly] = await Promise.all([
    getTimeRangeForPeriod("5h"),
    getTimeRangeForPeriodWithMode("daily", provider.dailyResetTime, provider.dailyResetMode),
    getTimeRangeForPeriod("weekly"),
    getTimeRangeForPeriod("monthly"),
  ]);

  // 获取金额消费和并发数
  const [cost5h, costDaily, costWeekly, costMonthly, concurrentSessions] = await Promise.all([
    sumProviderCostInTimeRange(providerId, range5h.startTime, range5h.endTime),
    sumProviderCostInTimeRange(providerId, rangeDaily.startTime, rangeDaily.endTime),
    sumProviderCostInTimeRange(providerId, rangeWeekly.startTime, rangeWeekly.endTime),
    sumProviderCostInTimeRange(providerId, rangeMonthly.startTime, rangeMonthly.endTime),
    SessionTracker.getProviderSessionCount(providerId),
  ]);

  return {
    ok: true,
    data: {
      cost5h: { current: cost5h, limit: provider.limit5hUsd, resetInfo: "..." },
      costDaily: { current: costDaily, limit: provider.limitDailyUsd, resetAt: ... },
      costWeekly: { current: costWeekly, limit: provider.limitWeeklyUsd, resetAt: ... },
      costMonthly: { current: costMonthly, limit: provider.limitMonthlyUsd, resetAt: ... },
      concurrentSessions: { current: concurrentSessions, limit: provider.limitConcurrentSessions || 0 },
    },
  };
}
```

### 验证 Schema

**CreateProviderSchema**（`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` 第 355-532 行）

```typescript
export const CreateProviderSchema = z.object({
  name: z.string().min(1, "服务商名称不能为空").max(64, "服务商名称不能超过64个字符"),
  url: z.string().url("请输入有效的URL地址").max(255, "URL长度不能超过255个字符"),
  key: z.string().min(1, "API密钥不能为空").max(1024, "API密钥长度不能超过1024个字符"),
  is_enabled: z.boolean().optional().default(true),
  weight: z.number().int("权重必须是整数").min(1, "权重不能小于 1").max(100, "权重不能超过 100").optional().default(1),
  priority: z.number().int("优先级必须是整数").min(0, "优先级不能为负数").optional().default(0),
  cost_multiplier: z.coerce.number().min(0, "成本倍率不能为负数").optional().default(1.0),
  group_tag: z.string().max(50, "分组标签不能超过50个字符").nullable().optional(),
  provider_type: z.enum(["claude", "claude-auth", "codex", "gemini", "gemini-cli", "openai-compatible"]).optional().default("claude"),
  preserve_client_ip: z.boolean().optional().default(false),
  model_redirects: z.record(z.string(), z.string()).nullable().optional(),
  allowed_models: z.array(z.string()).nullable().optional(),
  join_claude_pool: z.boolean().optional().default(false),
  // 金额限流
  limit_5h_usd: z.coerce.number().min(0).max(10000).nullable().optional(),
  limit_daily_usd: z.coerce.number().min(0).max(10000).nullable().optional(),
  daily_reset_mode: z.enum(["fixed", "rolling"]).optional().default("fixed"),
  daily_reset_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "重置时间格式必须为 HH:mm").optional().default("00:00"),
  limit_weekly_usd: z.coerce.number().min(0).max(50000).nullable().optional(),
  limit_monthly_usd: z.coerce.number().min(0).max(200000).nullable().optional(),
  limit_total_usd: z.coerce.number().min(0).max(10000000).nullable().optional(),
  limit_concurrent_sessions: z.coerce.number().int().min(0).max(1000).optional().default(0),
  // 熔断器配置
  max_retry_attempts: z.coerce.number().int().min(1).max(10).nullable().optional(),
  circuit_breaker_failure_threshold: z.coerce.number().int().min(0).optional(),
  circuit_breaker_open_duration: z.coerce.number().int().min(1000).max(86400000).optional(),
  circuit_breaker_half_open_success_threshold: z.coerce.number().int().min(1).max(10).optional(),
  // 代理配置
  proxy_url: z.string().max(512).nullable().optional(),
  proxy_fallback_to_direct: z.boolean().optional().default(false),
  // 超时配置
  first_byte_timeout_streaming_ms: z.union([z.literal(0), z.coerce.number().int().min(1000).max(180000)]).optional(),
  streaming_idle_timeout_ms: z.union([z.literal(0), z.coerce.number().int().min(60000).max(600000)]).optional(),
  request_timeout_non_streaming_ms: z.union([z.literal(0), z.coerce.number().int().min(60000).max(1800000)]).optional(),
  // 其他配置...
});
```

**UpdateProviderSchema**（`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` 第 537-650 行）

与 CreateProviderSchema 类似，但所有字段都是可选的（使用 `.optional()`）。

### 常量定义

**Provider 限制和默认值**（`/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts`）

```typescript
export const PROVIDER_LIMITS = {
  WEIGHT: { MIN: 1, MAX: 100 },
  MAX_RETRY_ATTEMPTS: { MIN: 1, MAX: 10 },
  LIMIT_5H_USD: { MIN: 0.1, MAX: 1000, STEP: 1 },
  LIMIT_WEEKLY_USD: { MIN: 1, MAX: 5000, STEP: 1 },
  LIMIT_MONTHLY_USD: { MIN: 10, MAX: 30000, STEP: 1 },
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 150 },
} as const;

export const PROVIDER_DEFAULTS = {
  IS_ENABLED: true,
  WEIGHT: 1,
  MAX_RETRY_ATTEMPTS: 2,
} as const;

export const PROVIDER_GROUP = {
  DEFAULT: "default",
  ALL: "*",
} as const;

export const PROVIDER_TIMEOUT_LIMITS = {
  FIRST_BYTE_TIMEOUT_STREAMING_MS: { MIN: 1000, MAX: 180000 },
  STREAMING_IDLE_TIMEOUT_MS: { MIN: 60000, MAX: 600000 },
  REQUEST_TIMEOUT_NON_STREAMING_MS: { MIN: 60000, MAX: 1800000 },
} as const;

export const PROVIDER_TIMEOUT_DEFAULTS = {
  FIRST_BYTE_TIMEOUT_STREAMING_MS: 0,
  STREAMING_IDLE_TIMEOUT_MS: 0,
  REQUEST_TIMEOUT_NON_STREAMING_MS: 0,
} as const;
```

## Edge Cases

### 1. 供应商类型与行为差异

不同供应商类型有不同的默认行为和限制：

- **claude**：标准 Anthropic 提供商，发送 x-api-key 和 Authorization 头
- **claude-auth**：Claude 中转服务，仅发送 Bearer 认证，不发送 x-api-key
- **codex**：Codex CLI (Response API)，支持 reasoning_effort 等参数覆写
- **gemini**：Gemini API，支持 MCP 透传
- **gemini-cli**：Gemini CLI 专用
- **openai-compatible**：OpenAI 兼容 API，支持 chat completions 端点

### 2. 模型列表的双重语义

`allowedModels` 字段根据供应商类型有不同的含义：

- **Anthropic 提供商（claude/claude-auth）**：白名单模式，限制可调度的模型
- **非 Anthropic 提供商**：声明列表，声称支持的模型
- **null 或空数组**：Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型

### 3. 软删除与数据保留

供应商使用软删除（`deletedAt` 字段），删除时：

- 设置 `deletedAt` 为当前时间
- 不清除历史请求记录（message_request 表）
- 自动清理关联的 providerVendor（如果没有其他活跃 providers/endpoints）
- 清除 Redis 缓存和内存状态

### 4. Vendor 自动管理

创建/更新供应商时自动管理 vendor：

```typescript
// 创建时自动获取或创建 vendor
const providerVendorId = await getOrCreateProviderVendorIdFromUrls({
  providerUrl: providerData.url,
  websiteUrl: providerData.website_url ?? null,
  faviconUrl: providerData.favicon_url ?? null,
  displayName: providerData.name,
});

// 删除时自动清理空 vendor
await tryDeleteProviderVendorIfEmpty(providerVendorId);
```

### 5. 缓存失效机制

CRUD 操作后广播缓存失效：

```typescript
async function broadcastProviderCacheInvalidation(context: {
  operation: "add" | "edit" | "remove";
  providerId: number;
}): Promise<void> {
  try {
    await publishProviderCacheInvalidation();
  } catch (error) {
    // 失败不影响主流程，其他实例依赖 TTL 过期
  }
}
```

### 6. 批量操作限制

批量操作有数量限制防止滥用：

```typescript
const BATCH_OPERATION_MAX_SIZE = 500;
```

### 7. 成本倍率精度

成本倍率使用 `numeric(10, 4)` 存储，支持 4 位小数精度：

```typescript
costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }).default('1.0')
```

### 8. 时间配置验证

`daily_reset_time` 必须符合 HH:mm 格式：

```typescript
daily_reset_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "重置时间格式必须为 HH:mm")
```

### 9. 代理 URL 格式验证

支持 http://、https://、socks5://、socks4:// 格式：

```typescript
export function isValidProxyUrl(url: string): boolean {
  const validProtocols = ['http:', 'https:', 'socks5:', 'socks4:'];
  try {
    const parsed = new URL(url);
    return validProtocols.includes(parsed.protocol);
  } catch {
    return false;
  }
}
```

### 10. 熔断器配置同步

熔断器配置会同步到 Redis 供运行时读取：

```typescript
await saveProviderCircuitConfig(provider.id, {
  failureThreshold: provider.circuitBreakerFailureThreshold,
  openDuration: provider.circuitBreakerOpenDuration,
  halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
});
```

### 11. 供应商统计计算

统计查询使用 providerChain 最后一项确定最终供应商（兼容重试切换）：

```sql
CASE
  WHEN provider_chain IS NULL OR jsonb_array_length(provider_chain) = 0 THEN provider_id
  ELSE (provider_chain->-1->>'id')::int
END AS final_provider_id
```

### 12. 端点自动创建

创建/更新供应商时自动创建对应的 endpoint：

```typescript
await ensureProviderEndpointExistsForUrl({
  vendorId: created.providerVendorId,
  providerType: created.providerType,
  url: created.url,
});
```

### 13. 分组标签处理

分组标签支持逗号分隔的多标签：

```typescript
const groups = groupTag
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
```

### 14. 金额限流精度

金额字段使用 `numeric(10, 2)`，支持 2 位小数（分）：

```typescript
limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 })
```

### 15. 密钥脱敏显示

API 密钥在前端显示时脱敏：

```typescript
export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}
```

### 16. Provider Vendor 计算逻辑

Vendor 的 websiteDomain 计算有两种模式：

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts 第 112-125 行
export async function computeVendorKey(input: {
  providerUrl: string;
  websiteUrl?: string | null;
}): Promise<string | null> {
  // Case 1: websiteUrl 非空 - 使用 hostname（去掉 www，小写）
  if (websiteUrl?.trim()) {
    return normalizeWebsiteDomainFromUrl(websiteUrl);
  }

  // Case 2: websiteUrl 为空 - 使用 host:port 作为 key
  // IPv6 格式: [ipv6]:port
  // 默认端口: http=80, https=443
  return normalizeHostWithPort(providerUrl);
}
```

### 17. 供应商统计计算逻辑

统计查询使用 providerChain 确定最终供应商：

```typescript
// 情况1：无重试（provider_chain 为 NULL 或空数组），使用 provider_id
(mr.provider_chain IS NULL OR jsonb_array_length(mr.provider_chain) = 0) AND mr.provider_id = p.id

// 情况2：有重试，使用 providerChain 最后一项的 id
(mr.provider_chain IS NOT NULL AND jsonb_array_length(mr.provider_chain) > 0
 AND (mr.provider_chain->-1->>'id')::int = p.id)
```

### 18. 并发 Session 计数

供应商级别的并发 Session 限制使用 Redis 计数：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts
export class SessionTracker {
  static async getProviderSessionCount(providerId: number): Promise<number> {
    const key = `provider:${providerId}:sessions`;
    const count = await redis.scard(key);
    return count;
  }

  static async getProviderSessionCountBatch(providerIds: number[]): Promise<Map<number, number>> {
    // 使用 Pipeline 批量获取
    const pipeline = redis.pipeline();
    for (const id of providerIds) {
      pipeline.scard(`provider:${id}:sessions`);
    }
    const results = await pipeline.exec();
    // ...
  }
}
```

### 19. 熔断器状态重置

手动重置供应商熔断器状态：

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 961-976 行
export async function resetProviderCircuit(providerId: number): Promise<ActionResult> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  resetCircuit(providerId);
  return { ok: true };
}

// 批量重置
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 1123-1164 行
export async function batchResetProviderCircuits(
  params: { providerIds: number[] }
): Promise<ActionResult<{ resetCount: number }>> {
  for (const id of providerIds) {
    resetCircuit(id);
    clearConfigCache(id);
  }
  return { ok: true, data: { resetCount: providerIds.length } };
}
```

### 20. 总用量重置

手动重置供应商"总消费"统计起点：

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 978-1002 行
export async function resetProviderTotalUsage(providerId: number): Promise<ActionResult> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  // 不删除历史请求日志，仅更新 providers.total_cost_reset_at 作为聚合下限
  const ok = await resetProviderTotalCostResetAt(providerId, new Date());
  if (!ok) {
    return { ok: false, error: "供应商不存在" };
  }

  return { ok: true };
}
```

### 21. 供应商健康状态检查

获取所有供应商的熔断器健康状态：

```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts 第 909-956 行
export async function getProvidersHealthStatus() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return {};
  }

  const providerIds = await findAllProvidersFresh().then((providers) =>
    providers.map((p) => p.id)
  );
  const healthStatus = await getAllHealthStatusAsync(providerIds, { forceRefresh: true });

  // 转换为前端友好的格式
  const enrichedStatus: Record<number, {
    circuitState: "closed" | "open" | "half-open";
    failureCount: number;
    lastFailureTime: number | null;
    circuitOpenUntil: number | null;
    recoveryMinutes: number | null;
  }> = {};

  Object.entries(healthStatus).forEach(([providerId, health]) => {
    enrichedStatus[Number(providerId)] = {
      circuitState: health.circuitState,
      failureCount: health.failureCount,
      lastFailureTime: health.lastFailureTime,
      circuitOpenUntil: health.circuitOpenUntil,
      recoveryMinutes: health.circuitOpenUntil
        ? Math.ceil((health.circuitOpenUntil - Date.now()) / 60000)
        : null,
    };
  });

  return enrichedStatus;
}
```

### 22. 端点池管理

每个供应商创建时自动在端点池创建对应记录：

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts 第 717-751 行
export async function ensureProviderEndpointExistsForUrl(input: {
  vendorId: number;
  providerType: ProviderType;
  url: string;
  label?: string | null;
}): Promise<boolean> {
  const trimmedUrl = input.url.trim();
  if (!trimmedUrl) return false;

  try {
    new URL(trimmedUrl);
  } catch {
    return false;
  }

  const inserted = await db
    .insert(providerEndpoints)
    .values({
      vendorId: input.vendorId,
      providerType: input.providerType,
      url: trimmedUrl,
      label: input.label ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [providerEndpoints.vendorId, providerEndpoints.providerType, providerEndpoints.url],
    })
    .returning({ id: providerEndpoints.id });

  return inserted.length > 0;
}
```

### 23. 数据转换器

数据库原始数据到 TypeScript 类型的转换：

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts
export function toProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    key: row.key,
    providerVendorId: row.providerVendorId ?? null,
    isEnabled: row.isEnabled ?? true,
    weight: row.weight ?? 1,
    priority: row.priority ?? 0,
    costMultiplier: Number(row.costMultiplier ?? 1.0),
    // ... 其他字段转换
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toNullableDate(row.deletedAt),
  };
}
```

### 24. 缓存策略

供应商数据使用多层缓存：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts
export async function getCachedProviders(
  fetcher: () => Promise<Provider[]>
): Promise<Provider[]> {
  // 1. 进程级缓存（30s TTL）
  const cached = providerCache.get<Provider[]>('all');
  if (cached) return cached;

  // 2. 从数据库获取
  const providers = await fetcher();

  // 3. 写入缓存
  providerCache.set('all', providers, { ttl: PROVIDER_CACHE_TTL });

  return providers;
}

// Redis Pub/Sub 跨实例缓存失效
export async function publishProviderCacheInvalidation(): Promise<void> {
  await redis.publish(PROVIDER_CACHE_INVALIDATION_CHANNEL, Date.now().toString());
}
```

## References

### 核心文件

| 文件路径 | 说明 |
|---------|------|
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | 数据库表结构定义（providers、providerVendors、providerEndpoints） |
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | TypeScript 类型定义（Provider、CreateProviderData、UpdateProviderData） |
| `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` | Repository 层 CRUD 操作 |
| `/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` | Vendor 和 Endpoint 管理 |
| `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` | Action 层业务逻辑 |
| `/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` | Endpoint 相关 actions |
| `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` | 验证 Schema（CreateProviderSchema、UpdateProviderSchema） |
| `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` | 供应商相关常量 |
| `/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts` | API 路由定义 |

### 数据库索引

```typescript
// /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts 第 288-296 行
(table) => ({
  // 优化启用状态的服务商查询（按优先级和权重排序）
  providersEnabledPriorityIdx: index('idx_providers_enabled_priority')
    .on(table.isEnabled, table.priority, table.weight)
    .where(sql`${table.deletedAt} IS NULL`),
  // 分组查询优化
  providersGroupIdx: index('idx_providers_group')
    .on(table.groupTag)
    .where(sql`${table.deletedAt} IS NULL`),
  // 基础索引
  providersCreatedAtIdx: index('idx_providers_created_at').on(table.createdAt),
  providersDeletedAtIdx: index('idx_providers_deleted_at').on(table.deletedAt),
  providersVendorTypeIdx: index('idx_providers_vendor_type')
    .on(table.providerVendorId, table.providerType)
    .where(sql`${table.deletedAt} IS NULL`),
})
```

### API 端点

```typescript
// /Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts
// 供应商列表
GET /api/actions/providers/getProviders

// Vendor 列表
GET /api/actions/providers/getProviderVendors

// Endpoint 列表
POST /api/actions/providers/getProviderEndpoints
  { vendorId: number, providerType: ProviderType }

// 创建 Endpoint
POST /api/actions/providers/addProviderEndpoint
  { vendorId, providerType, url, label?, sortOrder?, isEnabled? }

// 更新 Endpoint
POST /api/actions/providers/editProviderEndpoint
  { endpointId, url?, label?, sortOrder?, isEnabled? }

// 删除 Endpoint
POST /api/actions/providers/removeProviderEndpoint
  { endpointId }
```

### 相关类型定义

```typescript
// Provider 类型枚举
export type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini"
  | "gemini-cli"
  | "openai-compatible";

// MCP 透传类型
export type McpPassthroughType = "none" | "minimax" | "glm" | "custom";

// Codex Instructions 策略
export type CodexInstructionsStrategy = "auto" | "force_official" | "keep_original";

// Codex 参数覆写偏好
type CodexReasoningEffortPreference = "inherit" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
type CodexReasoningSummaryPreference = "inherit" | "auto" | "detailed";
type CodexTextVerbosityPreference = "inherit" | "low" | "medium" | "high";
type CodexParallelToolCallsPreference = "inherit" | "true" | "false";
```

---

*文档生成时间：2026-01-29*
*基于 Claude Code Hub 代码库分析*
