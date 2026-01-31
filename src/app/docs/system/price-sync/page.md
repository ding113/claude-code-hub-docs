---
title: 价格同步
description: 价格同步系统如何保持模型计费数据与云端同步，同时支持手动覆盖。
---

价格同步系统确保您的 Claude Code Hub 实例始终拥有来自云端源的最新模型计费信息。它支持自动定时同步、手动触发以及按需异步更新。

## 概述

AI 模型供应商经常调整价格。价格同步系统通过自动从云端获取更新的定价并将其应用到本地数据库来解决这一挑战。系统采用“本地优先”策略，这意味着手动配置的价格始终优先于云端数据。

### 核心能力

- **云端价格表获取**：从官方云端 CDN 检索定价数据
- **TOML 格式解析**：支持标准的 TOML 配置文件
- **增量同步**：仅更新价格发生变化的模型
- **冲突检测**：识别云端价格与手动设置发生冲突的情况
- **定时自动同步**：每 30 分钟运行一次
- **按需异步同步**：遇到未知模型时自动触发
- **节流与去重**：防止冗余的同步操作

## 系统架构

价格同步功能由三个核心模块组成，共同协作完成数据的获取、解析和存储。

### 模块结构

```
src/lib/price-sync/
├── cloud-price-table.ts      # 获取并解析云端价格表
├── cloud-price-updater.ts    # 将数据同步到数据库并管理调度
└── seed-initializer.ts       # 首次启动时初始化价格

src/actions/model-prices.ts    # 用于价格管理的 Server Actions
src/repository/model-price.ts  # 数据库访问层
src/types/model-price.ts       # TypeScript 类型定义
```

### 数据流

```
云端 CDN (TOML 文件)
        │
        ▼
cloud-price-table.ts
        │
        ▼
cloud-price-updater.ts
        │
        ▼
AsyncTaskManager (任务队列)
        │
        ▼
   数据库 (PostgreSQL)
```

### 核心组件

#### 云端价格表获取器

`cloud-price-table.ts` 模块负责获取 TOML 价格文件并解析其内容。

**核心函数：**

- `fetchCloudPriceTableToml()`：带有超时保护的 TOML 文件获取
- `parseCloudPriceTableToml()`：将 TOML 内容解析为结构化的价格数据

**安全机制：**

- 10 秒请求超时
- URL 重定向检测，防止劫持
- 空内容验证

```typescript
const FETCH_TIMEOUT_MS = 10000;

export async function fetchCloudPriceTableToml(
  url: string = CLOUD_PRICE_TABLE_URL
): Promise<CloudPriceTableResult<string>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/plain" },
      cache: "no-store",
    });
    // 重定向检测和响应处理
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### 云端价格更新器

`cloud-price-updater.ts` 模块将解析后的价格数据写入数据库，并提供异步同步调度。核心函数包括执行完整数据库同步工作流的 `syncCloudPriceTableToDatabase()`，以及请求带有节流和去重功能的异步同步的 `requestCloudPriceTableSync()`。

**节流机制：**

- 默认节流间隔：5 分钟
- 全局变量跟踪上次同步时间
- 并发调度标志防止重复触发
- 在 Edge 运行时环境中跳过执行

#### 种子数据初始化器

`seed-initializer.ts` 模块在应用程序启动时运行，以确保数据库中存有价格数据。它会检查价格记录是否存在，如果为空则从云端获取，并在失败时记录警告，而不会阻塞应用程序启动。

## 数据模型

### ModelPriceData 接口

`ModelPriceData` 接口定义了单个模型的完整计费结构：

```typescript
export interface ModelPriceData {
  // 基础计费
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  input_cost_per_request?: number;

  // 缓存相关计费
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
  cache_read_input_token_cost?: number;

  // 200K 分级计费 (Gemini 模型使用)
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;

  // 图像生成计费
  output_cost_per_image?: number;
  output_cost_per_image_token?: number;

  // 模型能力
  display_name?: string;
  litellm_provider?: string;
  providers?: string[];
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  mode?: "chat" | "image_generation" | "completion";

  // 功能标志
  supports_function_calling?: boolean;
  supports_prompt_caching?: boolean;
  supports_vision?: boolean;
}
```

### 数据库模式

`model_prices` 表存储定价记录：

```sql
CREATE TABLE model_prices (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR NOT NULL,
  price_data JSONB NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'litellm',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 优化索引
CREATE INDEX idx_model_prices_latest ON model_prices (model_name, created_at DESC);
CREATE INDEX idx_model_prices_model_name ON model_prices (model_name);
```

### 价格来源策略

系统支持两种价格来源：

| 来源 | 描述 | 优先级 |
|--------|-------------|----------|
| `litellm` | 从云端 LiteLLM 价格表同步 | 低 |
| `manual` | 由管理员添加或修改 | 高 |

**本地优先策略：**

- 查询模型价格时，`source = 'manual'` 的记录会被优先返回
- 即使云端数据更新，手动设置的价格仍具有优先权
- 同步操作默认不会覆盖手动设置的价格

## 同步机制

### 定时自动同步

系统在 `instrumentation.ts` 中配置了 30 分钟间隔的定时同步。它在启动时立即触发，之后每 30 分钟执行一次。调度器仅在数据库可用时启用，以避免在本地开发环境中出错。

### 按需异步同步

当请求处理遇到未知模型或缺失价格数据时，系统通过调用 `requestCloudPriceTableSync({ reason: "missing-model" })` 自动触发同步。这会异步执行，不会阻塞当前请求。5 分钟的节流间隔防止了频繁触发，且同步在 Edge 运行时会跳过，因为它需要数据库访问。

### 手动同步

管理员可以通过 Web UI 触发同步。系统首先检查云端价格与手动价格之间的冲突。如果存在冲突，将弹出一个对话框显示冲突的模型，并允许选择性覆盖。

## 冲突检测与解决

### 冲突检测

当云端价格表包含管理员已手动配置的模型时，就会发生冲突。`checkLiteLLMSyncConflicts()` 函数获取云端价格表，从数据库查询所有手动记录，比较模型列表，并生成供审查的冲突列表。

### 冲突解决 UI

`SyncConflictDialog` 组件为解决冲突提供了一个可视化界面，包括冲突模型的表格显示、并排的价格对比、搜索和过滤功能以及价格差异高亮。

### 覆盖策略

管理员可以选择性地覆盖手动设置的价格。在执行包含所选覆盖模型的同步时，系统会删除旧的手动记录并插入新的以 litellm 为来源的记录。

## 批量处理

`processPriceTableInternal` 函数处理批量处理：解析 JSON 价格表，通过批量查询获取现有价格以避免 N+1 问题，检索手动价格列表，并处理每个模型以确定是应该添加、更新、因冲突跳过还是标记为未更改。系统通过检查 `input_cost_per_token`、`output_cost_per_token` 和 `input_cost_per_request` 等核心字段来判断是否需要更新。

## 错误处理与日志

### 错误分类

| 错误类型 | 处理方式 | 用户反馈 |
|------------|----------|---------------|
| 网络错误 (超时, DNS) | 返回错误结果，记录警告 | 显示“无法获取云端价格表” |
| HTTP 错误 (4xx, 5xx) | 返回错误结果，记录错误 | 显示 HTTP 状态码 |
| TOML 解析错误 | 返回错误结果，记录错误 | 显示解析错误详情 |
| 数据库写入错误 | 返回错误结果，记录错误 | 显示“写入失败” |
| 单个模型处理失败 | 记录到失败列表，继续处理 | 显示部分失败通知 |

### 日志规范

所有价格同步操作均使用带有 `[PriceSync]` 前缀的结构化日志。日志包含同步开始、完成（带有添加/更新/未更改/失败模型的计数）以及带有错误信息的失败详情。

## 与成本计算的集成

价格同步系统与成本计算系统紧密配合，确保每个请求都使用最新的定价数据。

### 成本计算流程

```
来自供应商的响应
        │
        ▼
提取使用量 (tokens, cache)
        │
        ▼
获取价格数据 (来自 Session)
        │
        ▼
应用计费规则 (分级计费等)
        │
        ▼
计算成本 (Decimal.js)
        │
        ▼
将成本存储到数据库
```

### 价格数据检索策略

**计费模型来源配置：**

系统支持由 `billingModelSource` 设置控制的两种计费模型来源：

- `"original"`：使用请求中的原始模型名称查找价格
- `"redirected"`：使用重定向后的模型名称查找价格

**价格数据缓存：**

```typescript
// 在 Session 中缓存价格数据
getCachedPriceDataByBillingSource(billingModelSource: string) {
  const cacheKey = `price:${billingModelSource}`;
  if (this.priceDataCache.has(cacheKey)) {
    return this.priceDataCache.get(cacheKey);
  }
  // 从数据库查询并缓存
  const price = await findLatestPriceByModel(modelName);
  this.priceDataCache.set(cacheKey, price);
  return price;
}
```

**回退策略：**

1. 首先尝试获取对应于 `billingModelSource` 的模型价格
2. 如果未找到，尝试使用另一个模型名称（原始/重定向）
3. 如果仍未找到，触发异步价格同步并记录警告

### 成本计算公式

**基础成本计算：**

```
总成本 = (输入 Tokens × 每 Token 输入成本)
       + (输出 Tokens × 每 Token 输出成本)
       + (缓存创建 Tokens × 每 Token 缓存创建成本)
       + (缓存读取 Tokens × 每 Token 缓存读取成本)
       + 每请求固定费用
```

**分级计费 (200K+ tokens)：**

对于像 Gemini 这样支持分级计费的模型：

```
如果 input_tokens > 200,000:
  前 200K 成本 = 200,000 × 基础输入成本
  超出部分成本 = (input_tokens - 200,000) × 200K 以上输入成本
否则:
  成本 = input_tokens × 基础输入成本
```

**1M 上下文窗口 (Claude Sonnet)：**

```typescript
const CONTEXT_1M_TOKEN_THRESHOLD = 200000;
const CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER = 2.0;
const CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER = 1.5;

// 输入成本
if (context1mApplied && inputTokens > CONTEXT_1M_TOKEN_THRESHOLD) {
  baseCost = 200000 × inputCostPerToken;
  premiumCost = (inputTokens - 200000) × inputCostPerToken × 2.0;
  inputCost = baseCost + premiumCost;
}

// 输出成本
if (context1mApplied && outputTokens > CONTEXT_1M_TOKEN_THRESHOLD) {
  baseCost = 200000 × outputCostPerToken;
  premiumCost = (outputTokens - 200000) × outputCostPerToken × 1.5;
  outputCost = baseCost + premiumCost;
}
```

**缓存计费回退：**

当未明确配置缓存价格时，将应用默认倍数：

```typescript
const cacheCreation5mCost = priceData.cache_creation_input_token_cost
  ?? (inputCostPerToken × 1.25);  // 默认 1.25x

const cacheCreation1hCost = priceData.cache_creation_input_token_cost_above_1hr
  ?? (inputCostPerToken × 2.0);   // 默认 2x

const cacheReadCost = priceData.cache_read_input_token_cost
  ?? (inputCostPerToken × 0.1);   // 默认 0.1x
```

### 价格缺失处理

当请求处理发现模型没有价格数据时：

```typescript
// 在 response-handler.ts 中
if (!priceData?.priceData) {
  logger.warn("[CostCalculation] 未找到价格数据，跳过计费", {
    messageId,
    originalModel,
    redirectedModel
  });

  // 触发异步价格同步
  requestCloudPriceTableSync({ reason: "missing-model" });
  return; // 继续处理请求但不计费
}
```

**处理策略：**

1. 记录包含模型名称和消息 ID 的警告
2. 触发异步价格同步（5 分钟节流）
3. 继续处理请求，记录的成本为零
4. 用户体验不受影响，后续请求可能会有定价

### 精度控制

所有成本计算均使用 `Decimal.js` 库以保证高精度：

```typescript
import Decimal from "decimal.js";

const COST_SCALE = 15; // 15 位小数精度

function multiplyCost(tokens: number, costPerToken?: number): Decimal {
  if (costPerToken == null || tokens <= 0) return new Decimal(0);
  return new Decimal(tokens).mul(costPerToken).toDecimalPlaces(COST_SCALE);
}
```

**精度要求：**

- Token 单位价格通常非常小（例如每 token $0.000001）
- 大量的 token 需要高精度以避免舍入误差
- 15 位小数能够满足财务精度要求

## Web UI 价格管理

### 价格列表页面

**路径：** `/settings/prices`

**功能：**

- **分页**：支持每页 20/50/100/200 条目
- **搜索过滤**：按模型名称搜索（后端 SQL 查询，500ms 防抖）
- **来源过滤**：全部 / 本地 (manual) / 云端 (litellm)
- **供应商过滤**：Anthropic / OpenAI / Vertex AI 的快速过滤器
- **能力图标**：显示模型功能（函数调用、缓存、视觉等）

**价格显示格式：**

- 输入/输出价格：显示为 $/M tokens
- 图像生成：显示为 $/img
- 缓存价格：分别显示读取、5 分钟创建和 1 小时创建价格

### 同步按钮工作流

`SyncLiteLLMButton` 组件处理同步工作流：

1. **点击触发**：显示加载状态“正在检查...”
2. **冲突检测**：调用 `checkLiteLLMSyncConflicts()`
3. **冲突处理**：
   - 有冲突：打开 `SyncConflictDialog` 显示冲突列表
   - 无冲突：直接执行同步
4. **执行同步**：调用 `syncLiteLLMPrices(overwriteManual[])`
5. **结果反馈**：
   - 成功：显示添加/更新/未更改的计数
   - 部分失败：显示失败的模型名称
   - 跳过冲突：显示跳过的手动模型计数

### 手动价格管理

**添加/编辑模型价格：**

`ModelPriceDrawer` 组件提供：

- **创建模式**：搜索现有模型以预填数据
- **编辑模式**：模型名称只读，其他字段可编辑
- **表单字段**：
  - 模型名称（唯一标识符）
  - 显示名称（可选）
  - 模型模式：chat / image_generation / completion
  - 供应商 (litellm_provider)
  - 每请求价格
  - 输入价格 ($/M tokens)
  - 输出价格 ($/M tokens 或 $/img)
  - 提示词缓存开关
  - 缓存价格（读取、5 分钟创建、1 小时创建）

**价格单位转换：**

```typescript
// UI 显示：$/M tokens
// 存储：$/token
function parsePricePerMillionToPerToken(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed / 1000000;  // 转换为每 token 价格
}
```

**删除模型：**

- 确认对话框显示模型名称
- 异步删除操作
- 删除后列表刷新
- 智能分页处理（如果删除的是页面最后一项，则返回上一页）

## 性能优化

### 数据库查询优化

**批量查询避免 N+1：**

```typescript
// 一次性获取所有最新价格
const existingLatestPrices = await findAllLatestPrices();
const existingByModelName = new Map(
  existingLatestPrices.map(p => [p.modelName, p])
);

// 使用 O(1) 的 Map 查找进行迭代
for (const [modelName, priceData] of Object.entries(priceTable)) {
  const existingPrice = existingByModelName.get(modelName);
  // ...
}
```

**数据库索引：**

```sql
-- 优化用于获取最新价格的复合索引
CREATE INDEX idx_model_prices_latest
ON model_prices (model_name, created_at DESC);

-- 来源过滤索引
CREATE INDEX idx_model_prices_source
ON model_prices (source);
```

**DISTINCT ON 查询：**

PostgreSQL 的 `DISTINCT ON` 语法能高效获取每个模型的最新价格：

```sql
SELECT DISTINCT ON (model_name)
  id, model_name, price_data, source, created_at
FROM model_prices
ORDER BY model_name, (source = 'manual') DESC, created_at DESC;
```

### 缓存策略

**Session 级价格缓存：**

```typescript
// 在单个请求中缓存价格数据
private priceDataCache = new Map<string, ModelPrice | null>();

getCachedPriceData(modelName: string): ModelPrice | null {
  if (!this.priceDataCache.has(modelName)) {
    const price = await findLatestPriceByModel(modelName);
    this.priceDataCache.set(modelName, price);
  }
  return this.priceDataCache.get(modelName);
}
```

**防止重复同步：**

- 5 分钟节流窗口
- AsyncTaskManager 去重
- 全局变量调度标志

### 异步处理

**非阻塞同步：**

```typescript
// 触发异步同步，不等待结果
requestCloudPriceTableSync({ reason: "missing-model" });

// 请求继续处理
return response;
```

**后台任务管理：**

- 使用 AsyncTaskManager 管理同步任务生命周期
- 自动清理已完成的任务
- 错误捕获防止未捕获的异常

## 安全考虑

### 权限控制

**管理员权限检查：**

```typescript
// 所有价格管理操作都需要管理员权限
const session = await getSession();
if (!session || session.user.role !== "admin") {
  return { ok: false, error: "权限不足" };
}
```

**受保护的操作：**

- 同步 LiteLLM 价格
- 上传价格表
- 添加/编辑/删除模型价格
- 查看价格列表（非管理员返回空数组）

### 输入验证

**价格数据验证：**

```typescript
// 确保价格数据有效
if (!hasValidPriceData(priceData)) {
  return { ok: false, error: "无效的价格数据" };
}

// 检查必填字段
if (!modelName || modelName.trim().length === 0) {
  return { ok: false, error: "模型名称不能为空" };
}
```

**文件上传验证：**

- 文件类型限制 (.json, .toml)
- 文件大小限制 (10MB)
- 内容格式验证

### URL 安全

**云端价格表获取：**

```typescript
// 检测是否重定向到非预期的地址
if (finalUrl.host !== expectedUrl.host) {
  return { ok: false, error: "云端价格表获取失败：重定向到非预期地址" };
}
```

**请求头：**

- 使用 `Accept: text/plain` 明确期望文本响应
- `cache: "no-store"` 避免缓存过时的价格

## 故障排除

### 常见问题

**问题 1：同步失败，提示“无法获取云端价格表”**

- 检查网络连接
- 验证 `CLOUD_PRICE_TABLE_URL` 是否可访问
- 查看日志中的具体错误详情

**问题 2：新模型没有价格**

- 等待 5 分钟以便系统自动同步（节流间隔）
- 或者手动点击“同步 LiteLLM 价格”
- 检查日志确认同步是否成功

**问题 3：手动设置的价格被覆盖**

- 确认是否在冲突对话框中勾选了该模型
- 手动价格默认不会被覆盖
- 检查 `source` 字段是否为 `manual`

**问题 4：成本计算结果为零**

- 检查模型是否有价格数据
- 查看日志中的“未找到价格数据”警告
- 验证价格数据中包含有效的价格字段

### 调试日志

启用详细日志：

```typescript
// 查看详细的价格同步日志
logger.info("[PriceSync] 正在开始云端价格同步...", {
  reason: options.reason,
  throttleMs: options.throttleMs,
});

// 查看成本计算详情
logger.info("[CostCalculation] 正在计算成本", {
  modelName,
  inputTokens,
  outputTokens,
  priceData,
});
```

### 数据库查询

手动检查价格数据：

```sql
-- 查看特定模型的最新价格
SELECT * FROM model_prices
WHERE model_name = 'claude-3-sonnet-20240229'
ORDER BY (source = 'manual') DESC, created_at DESC
LIMIT 1;

-- 查看手动设置的价格
SELECT model_name, source, created_at
FROM model_prices
WHERE source = 'manual'
ORDER BY created_at DESC;

-- 按来源统计价格记录
SELECT source, COUNT(*)
FROM model_prices
GROUP BY source;
```

## 配置

### 环境变量

| 变量 | 描述 | 默认值 |
|----------|-------------|---------|
| `NEXT_RUNTIME` | 运行时环境 (edge/node) | - |
| `CI` | CI 环境标志 | `false` |
| `NEXT_PHASE` | Next.js 构建阶段 | - |

### 可配置选项

**云端价格表 URL：**

```typescript
export const CLOUD_PRICE_TABLE_URL = "https://claude-code-hub.app/config/prices-base.toml";
```

**请求超时：**

```typescript
const FETCH_TIMEOUT_MS = 10000; // 10 秒
```

**默认节流间隔：**

```typescript
const DEFAULT_THROTTLE_MS = 5 * 60 * 1000; // 5 分钟
```

**定时同步间隔：**

```typescript
const intervalMs = 30 * 60 * 1000; // 30 分钟
```

### 扩展点

1. **自定义价格源**：修改 `CLOUD_PRICE_TABLE_URL` 指向内部价格表
2. **自定义同步间隔**：修改 `instrumentation.ts` 中的定时器配置
3. **自定义节流策略**：调用 `requestCloudPriceTableSync` 时传入自定义的 `throttleMs`

## 最佳实践

### 管理员指南

1. **首次部署**：系统在启动时会自动从云端同步，无需手动操作
2. **日常维护**：依赖自动同步，每 30 分钟更新一次
3. **紧急更新**：点击“同步 LiteLLM 价格”立即获取最新价格
4. **自定义定价**：针对特殊计费需求，手动添加模型价格，它们将优先于云端价格
5. **冲突处理**：同步前系统会提示冲突，允许选择性地覆盖手动价格

### 开发指南

1. **Edge 运行时**：价格同步依赖数据库访问，不会在 Edge 运行时执行
2. **错误处理**：所有同步操作均返回 `ok/data/error` 格式，调用者必须检查结果
3. **事务安全**：手动价格更新使用数据库事务以保证原子性
4. **性能优化**：批量查询现有价格以避免 N+1 问题
5. **向后兼容性**：`source` 字段默认为 `litellm`，以兼容旧数据
