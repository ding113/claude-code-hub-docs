# 价格同步功能 (Price Synchronization)

## 1. 概述

价格同步功能是 Claude Code Hub 的核心组件之一，负责从云端价格表获取最新的模型定价信息，并将其同步到本地数据库中。该系统支持自动定时同步、手动触发同步以及按需异步同步三种模式，确保系统始终使用最新的模型价格数据进行成本计算和计费。

### 1.1 功能定位

价格同步功能主要解决以下问题：
- **价格时效性**：AI 模型提供商经常调整价格，需要及时获取最新定价
- **多模型支持**：系统需要支持 Claude、OpenAI、Gemini 等多种模型的定价
- **本地优先策略**：允许管理员手动覆盖云端价格，满足特殊定价需求
- **零停机更新**：同步过程不影响正在进行的请求处理

### 1.2 核心特性

- **云端价格表拉取**：从 `https://claude-code-hub.app/config/prices-base.toml` 获取官方价格表
- **TOML 格式解析**：支持解析标准 TOML 格式的价格配置文件
- **增量同步**：只更新发生变化的模型价格，避免不必要的数据库操作
- **冲突检测与解决**：检测手动设置价格与云端价格的冲突，允许选择性覆盖
- **定时自动同步**：每 30 分钟自动执行一次同步
- **按需异步同步**：当遇到未知模型时自动触发同步
- **节流与去重**：防止短时间内重复触发同步任务

## 2. 系统架构

### 2.1 模块组成

价格同步功能由以下核心模块组成：

```
src/lib/price-sync/
├── cloud-price-table.ts      # 云端价格表获取与解析
├── cloud-price-updater.ts    # 数据库同步与任务调度
└── seed-initializer.ts       # 初始化价格表

src/actions/model-prices.ts    # Server Actions 价格管理接口
src/repository/model-price.ts  # 数据库访问层
src/types/model-price.ts       # 类型定义
```

### 2.2 数据流

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Cloud CDN     │────▶│  cloud-price-    │────▶│   Database      │
│  (TOML File)    │     │   table.ts       │     │ (PostgreSQL)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ cloud-price-     │
                        │ updater.ts       │
                        └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  AsyncTaskManager │
                        │   (Task Queue)    │
                        └──────────────────┘
```

### 2.3 核心组件说明

#### 2.3.1 cloud-price-table.ts

该模块负责从云端 CDN 获取价格表文件并解析 TOML 格式。

**主要功能：**
- `fetchCloudPriceTableToml()`: 发起 HTTP 请求获取 TOML 文件内容
- `parseCloudPriceTableToml()`: 解析 TOML 内容并提取模型价格数据

**安全机制：**
- 请求超时控制（10 秒）
- URL 重定向检测，防止被劫持到非预期地址
- 内容为空检测

**代码示例：**
```typescript
export const CLOUD_PRICE_TABLE_URL = "https://claude-code-hub.app/config/prices-base.toml";
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
    // ... 重定向检测和响应处理
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### 2.3.2 cloud-price-updater.ts

该模块负责将解析后的价格数据写入数据库，并提供异步同步调度功能。

**主要功能：**
- `syncCloudPriceTableToDatabase()`: 执行完整的数据库同步流程
- `requestCloudPriceTableSync()`: 请求一次异步同步（带节流和去重）

**节流机制：**
- 默认节流间隔：5 分钟
- 全局变量记录上次同步时间
- 并发调度标志防止重复触发

**代码示例：**
```typescript
const DEFAULT_THROTTLE_MS = 5 * 60 * 1000;

export function requestCloudPriceTableSync(options: {
  reason: "missing-model" | "scheduled" | "manual";
  throttleMs?: number;
}): void {
  if (process.env.NEXT_RUNTIME === "edge") {
    return; // Edge 环境不执行
  }

  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const g = globalThis as unknown as {
    __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number;
    __CCH_CLOUD_PRICE_SYNC_SCHEDULING__?: boolean;
  };

  // 节流检查
  const lastAt = g.__CCH_CLOUD_PRICE_SYNC_LAST_AT__ ?? 0;
  const now = Date.now();
  if (now - lastAt < throttleMs) {
    return;
  }

  // 避免并发重复触发
  if (g.__CCH_CLOUD_PRICE_SYNC_SCHEDULING__) {
    return;
  }
  g.__CCH_CLOUD_PRICE_SYNC_SCHEDULING__ = true;

  // 异步加载 AsyncTaskManager 并注册任务
  void (async () => {
    try {
      const { AsyncTaskManager } = await import("@/lib/async-task-manager");
      // 去重检查
      const active = AsyncTaskManager.getActiveTasks();
      if (active.some((t) => t.taskId === taskId)) {
        return;
      }
      // 注册同步任务
      AsyncTaskManager.register(taskId, syncPromise, "cloud_price_table_sync");
    } finally {
      g.__CCH_CLOUD_PRICE_SYNC_SCHEDULING__ = false;
    }
  })();
}
```

#### 2.3.3 seed-initializer.ts

该模块在应用启动时执行，确保数据库中存在价格数据。

**初始化策略：**
1. 检查数据库是否已有价格记录
2. 如果为空，从云端价格表拉取并写入
3. 失败时记录警告但不阻塞应用启动

**代码示例：**
```typescript
export async function ensurePriceTable(): Promise<void> {
  try {
    const hasPrices = await hasAnyPriceRecords();
    if (hasPrices) {
      logger.info("[PriceSync] Price table already exists, skipping initialization");
      return;
    }

    logger.info("[PriceSync] No price data found in database, syncing from cloud...");
    const result = await syncCloudPriceTableToDatabase();
    
    if (result.ok) {
      logger.info("[PriceSync] Cloud price table synced for initialization", {
        added: result.data.added.length,
        updated: result.data.updated.length,
        total: result.data.total,
      });
    }
  } catch (error) {
    // 不阻塞应用启动
    logger.error("[PriceSync] Failed to ensure price table", { error });
  }
}
```

## 3. 数据模型

### 3.1 ModelPriceData 接口

`ModelPriceData` 定义了单个模型的完整价格数据结构：

```typescript
export interface ModelPriceData {
  // 基础价格信息
  input_cost_per_token?: number;                    // 输入 token 单价
  output_cost_per_token?: number;                   // 输出 token 单价
  input_cost_per_request?: number;                  // 按次调用固定费用

  // 缓存相关价格
  cache_creation_input_token_cost?: number;         // 缓存创建单价（5分钟TTL）
  cache_creation_input_token_cost_above_1hr?: number; // 缓存创建单价（1小时TTL）
  cache_read_input_token_cost?: number;             // 缓存读取单价

  // 200K 分层价格（Gemini 等模型使用）
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  cache_creation_input_token_cost_above_200k_tokens?: number;
  cache_read_input_token_cost_above_200k_tokens?: number;

  // 图片生成价格
  output_cost_per_image?: number;                   // 按张计费
  output_cost_per_image_token?: number;             // 按 token 计费
  input_cost_per_image?: number;                    // 图片输入按张计费
  input_cost_per_image_token?: number;              // 图片输入按 token 计费

  // 搜索上下文价格
  search_context_cost_per_query?: {
    search_context_size_high?: number;
    search_context_size_low?: number;
    search_context_size_medium?: number;
  };

  // 模型能力信息
  display_name?: string;                            // 显示名称
  litellm_provider?: string;                        // LiteLLM 提供商
  providers?: string[];                             // 支持的提供商列表
  max_input_tokens?: number;                        // 最大输入 token 数
  max_output_tokens?: number;                       // 最大输出 token 数
  max_tokens?: number;                              // 最大总 token 数
  mode?: "chat" | "image_generation" | "completion"; // 模型模式

  // 支持的功能标志
  supports_assistant_prefill?: boolean;
  supports_computer_use?: boolean;
  supports_function_calling?: boolean;
  supports_pdf_input?: boolean;
  supports_prompt_caching?: boolean;
  supports_reasoning?: boolean;
  supports_response_schema?: boolean;
  supports_tool_choice?: boolean;
  supports_vision?: boolean;

  // 其他字段
  tool_use_system_prompt_tokens?: number;
  [key: string]: unknown; // 允许额外字段
}
```

### 3.2 ModelPrice 数据库记录

数据库表 `model_prices` 的结构：

```typescript
export interface ModelPrice {
  id: number;
  modelName: string;           // 模型名称（唯一标识）
  priceData: ModelPriceData;   // 价格数据（JSONB）
  source: ModelPriceSource;    // 价格来源
  createdAt: Date;
  updatedAt: Date;
}

export type ModelPriceSource = "litellm" | "manual";
```

**数据库 Schema：**
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

### 3.3 价格来源策略

系统支持两种价格来源：

| 来源 | 说明 | 优先级 |
|------|------|--------|
| `litellm` | 从云端 LiteLLM 价格表同步 | 低 |
| `manual` | 管理员手动添加或修改 | 高 |

**本地优先策略：**
- 查询模型价格时，`source = 'manual'` 的记录优先返回
- 即使云端数据更新得更晚，手动设置的价格仍然优先
- 同步时默认不会覆盖手动设置的价格

## 4. 同步机制

### 4.1 定时自动同步

在 `instrumentation.ts` 中配置定时同步：

```typescript
async function startCloudPriceSyncScheduler(): Promise<void> {
  const intervalMs = 30 * 60 * 1000; // 30 分钟

  // 启动后立即触发一次
  requestCloudPriceTableSync({ reason: "scheduled", throttleMs: 0 });

  // 设置定时器
  setInterval(() => {
    requestCloudPriceTableSync({ reason: "scheduled", throttleMs: 0 });
  }, intervalMs);
}
```

**触发时机：**
1. 应用启动时立即执行一次
2. 之后每 30 分钟执行一次
3. 仅在数据库可用时启用（避免本地开发环境反复报错）

### 4.2 按需异步同步

当请求处理遇到未知模型或无价格数据时，自动触发同步：

```typescript
// 在 response-handler.ts 中
import { requestCloudPriceTableSync } from "@/lib/price-sync/cloud-price-updater";

if (!hasValidPriceData(priceData)) {
  // 触发异步价格同步
  requestCloudPriceTableSync({ reason: "missing-model" });
}
```

**设计考虑：**
- 异步执行，不阻塞当前请求
- 5 分钟节流间隔，避免频繁触发
- Edge 运行时跳过（无数据库访问能力）

### 4.3 手动同步

管理员可以通过 Web UI 手动触发同步：

```typescript
// SyncLiteLLMButton 组件
const handleSync = async () => {
  // 先检查冲突
  const checkResult = await checkLiteLLMSyncConflicts();
  
  if (checkResult.data?.hasConflicts) {
    // 显示冲突对话框
    setConflicts(checkResult.data.conflicts);
    setConflictDialogOpen(true);
  } else {
    // 无冲突，直接同步
    await syncLiteLLMPrices();
  }
};
```

## 5. 冲突检测与解决

### 5.1 冲突检测机制

当云端价格表中包含管理员手动设置过的模型时，产生冲突。

**检测流程：**
1. 拉取云端价格表
2. 查询数据库中所有 `source = 'manual'` 的价格记录
3. 对比云端和本地的模型列表
4. 生成冲突列表

**代码实现：**
```typescript
export async function checkLiteLLMSyncConflicts(): Promise<ActionResult<SyncConflictCheckResult>> {
  // 拉取云端价格表
  const tomlResult = await fetchCloudPriceTableToml();
  const parseResult = parseCloudPriceTableToml(tomlResult.data);
  const priceTable = parseResult.data.models;

  // 获取所有手动价格
  const manualPrices = await findAllManualPrices();

  // 构建冲突列表
  const conflicts: SyncConflict[] = [];
  for (const [modelName, manualPrice] of manualPrices) {
    const litellmPrice = priceTable[modelName];
    if (litellmPrice) {
      conflicts.push({
        modelName,
        manualPrice: manualPrice.priceData,
        litellmPrice: litellmPrice as ModelPriceData,
      });
    }
  }

  return {
    ok: true,
    data: {
      hasConflicts: conflicts.length > 0,
      conflicts,
    },
  };
}
```

### 5.2 冲突解决界面

`SyncConflictDialog` 组件提供可视化的冲突解决界面：

**功能特性：**
- 表格展示所有冲突模型
- 对比显示手动价格和 LiteLLM 价格
- 支持搜索过滤
- 分页展示（每页 10 条）
- 价格差异高亮显示

**价格对比弹窗：**
```typescript
function PriceDiffPopover({ manualPrice, litellmPrice }: { ... }) {
  const diffs = useMemo(() => {
    const items = [];
    // 输入价格对比
    items.push({
      field: t("diff.inputPrice"),
      manual: formatPrice(manualPrice.input_cost_per_token),
      litellm: formatPrice(litellmPrice.input_cost_per_token),
      changed: manualInput !== litellmInput,
    });
    // 输出价格对比
    // ...
    return items;
  }, [manualPrice, litellmPrice]);
  
  return (
    <Popover>
      <PopoverTrigger>
        <Button variant="ghost" size="sm">{t("viewDiff")}</Button>
      </PopoverTrigger>
      <PopoverContent>
        {/* 差异对比表格 */}
      </PopoverContent>
    </Popover>
  );
}
```

### 5.3 覆盖策略

管理员可以选择性覆盖手动设置的价格：

```typescript
const handleConflictConfirm = async (selectedModels: string[]) => {
  // 执行同步，传入要覆盖的模型列表
  await syncLiteLLMPrices(selectedModels);
};

// 在 processPriceTableInternal 中
if (isManualPrice && overwriteSet.has(modelName)) {
  // 先删除旧记录
  await deleteModelPriceByName(modelName);
}
// 插入新记录
await createModelPrice(modelName, priceData, "litellm");
```

## 6. 批量处理逻辑

### 6.1 价格表处理流程

`processPriceTableInternal` 函数是批量处理的核心：

```typescript
export async function processPriceTableInternal(
  jsonContent: string,
  overwriteManual?: string[]
): Promise<ActionResult<PriceUpdateResult>> {
  // 1. 解析 JSON
  const priceTable: PriceTableJson = JSON.parse(jsonContent);

  // 2. 获取现有价格数据（批量查询避免 N+1）
  const existingLatestPrices = await findAllLatestPrices();
  const existingByModelName = new Map(existingLatestPrices.map(p => [p.modelName, p]));

  // 3. 获取手动价格列表
  const manualPrices = await findAllManualPrices();
  const overwriteSet = new Set(overwriteManual ?? []);

  // 4. 遍历处理每个模型
  const result: PriceUpdateResult = {
    added: [],
    updated: [],
    unchanged: [],
    failed: [],
    skippedConflicts: [],
    total: 0,
  };

  for (const [modelName, priceData] of Object.entries(priceTable)) {
    try {
      const existingPrice = existingByModelName.get(modelName);
      const isManualPrice = manualPrices.has(modelName);

      if (!existingPrice) {
        // 新增模型
        await createModelPrice(modelName, priceData, "litellm");
        result.added.push(modelName);
      } else if (!isPriceDataEqual(existingPrice.priceData, priceData)) {
        // 价格发生变化
        if (isManualPrice && !overwriteSet.has(modelName)) {
          // 手动价格且未选择覆盖，跳过
          result.skippedConflicts?.push(modelName);
          continue;
        }
        if (isManualPrice && overwriteSet.has(modelName)) {
          await deleteModelPriceByName(modelName);
        }
        await createModelPrice(modelName, priceData, "litellm");
        result.updated.push(modelName);
      } else {
        // 价格未变化
        result.unchanged.push(modelName);
      }
    } catch (error) {
      result.failed.push(modelName);
    }
  }

  return { ok: true, data: result };
}
```

### 6.2 价格数据比较

判断两个价格数据是否相等：

```typescript
function isPriceDataEqual(a: ModelPriceData, b: ModelPriceData): boolean {
  // 比较关键价格字段
  return (
    a.input_cost_per_token === b.input_cost_per_token &&
    a.output_cost_per_token === b.output_cost_per_token &&
    a.input_cost_per_request === b.input_cost_per_request &&
    // ... 其他字段比较
  );
}
```

## 7. 错误处理与日志

### 7.1 错误分类

| 错误类型 | 处理方式 | 用户反馈 |
|----------|----------|----------|
| 网络错误（超时、DNS） | 返回错误结果，记录警告日志 | 显示"云端价格表拉取失败" |
| HTTP 错误（4xx、5xx） | 返回错误结果，记录错误日志 | 显示 HTTP 状态码 |
| TOML 解析错误 | 返回错误结果，记录错误日志 | 显示解析错误信息 |
| 数据库写入错误 | 返回错误结果，记录错误日志 | 显示"写入失败" |
| 单个模型处理失败 | 记录到 failed 列表，继续处理其他 | 显示部分失败提示 |

### 7.2 日志规范

所有价格同步操作都使用结构化日志：

```typescript
// 同步开始
logger.info("[PriceSync] Starting cloud price sync...");

// 同步完成
logger.info("[PriceSync] Cloud price sync completed", {
  added: result.data.added.length,
  updated: result.data.updated.length,
  unchanged: result.data.unchanged.length,
  failed: result.data.failed.length,
  skippedConflicts: result.data.skippedConflicts?.length ?? 0,
  total: result.data.total,
});

// 同步失败
logger.error("[PriceSync] Cloud price sync failed", { error: result.error });

// 任务调度失败
logger.warn("[PriceSync] Cloud price sync scheduling failed", {
  reason: options.reason,
  error: error instanceof Error ? error.message : String(error),
});
```

## 8. 测试覆盖

### 8.1 单元测试

价格同步功能有完整的单元测试覆盖：

**cloud-price-updater.test.ts：**
- 云端获取失败场景（HTTP 错误、空内容）
- TOML 解析失败场景（缺少 models 表）
- 数据库写入失败场景
- 节流机制测试
- 去重机制测试
- Edge 运行时跳过测试

**cloud-price-table.test.ts：**
- TOML 解析正确性
- 嵌套 pricing 表处理
- 元数据提取
- 空 models 表错误处理

**model-prices.test.ts：**
- 冲突检测逻辑
- 批量处理逻辑
- 权限检查

### 8.2 测试示例

```typescript
describe("syncCloudPriceTableToDatabase", () => {
  it("returns ok=false when cloud fetch fails with HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "server error",
    })));

    const result = await syncCloudPriceTableToDatabase();
    expect(result.ok).toBe(false);
  });

  it("throttles when called within throttle window", async () => {
    (globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number })
      .__CCH_CLOUD_PRICE_SYNC_LAST_AT__ = Date.now();

    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 60_000 });
    await flushAsync();

    expect(asyncTaskManagerLoaded).toBe(false);
  });
});
```

## 9. 配置与扩展

### 9.1 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NEXT_RUNTIME` | 运行时环境（edge/node） | - |
| `CI` | CI 环境标志 | `false` |
| `NEXT_PHASE` | Next.js 构建阶段 | - |

### 9.2 可配置项

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

### 9.3 扩展点

1. **自定义价格源**：修改 `CLOUD_PRICE_TABLE_URL` 指向内部价格表
2. **自定义同步间隔**：修改 `instrumentation.ts` 中的定时器配置
3. **自定义节流策略**：调用 `requestCloudPriceTableSync` 时传入自定义 `throttleMs`

## 10. 最佳实践

### 10.1 管理员操作指南

1. **首次部署**：系统会自动从云端同步价格表，无需手动操作
2. **日常维护**：依赖自动同步即可，每 30 分钟自动更新
3. **紧急更新**：如需立即获取最新价格，点击"同步 LiteLLM 价格"按钮
4. **自定义价格**：对于特殊定价需求，手动添加模型价格，手动价格会优先于云端价格
5. **冲突处理**：同步前系统会提示冲突，可选择性覆盖手动设置的价格

### 10.2 开发注意事项

1. **Edge 运行时**：价格同步依赖数据库，在 Edge 运行时不会执行
2. **错误处理**：所有同步操作都返回 `ok/data/error` 格式，调用方需要检查
3. **事务安全**：手动价格更新使用数据库事务，确保原子性
4. **性能优化**：批量查询现有价格，避免 N+1 问题
5. **向后兼容**：`source` 字段默认为 `litellm`，兼容旧数据

## 11. 与成本计算的集成

价格同步功能与成本计算系统紧密集成，确保每次请求都能使用最新的价格数据进行计费。

### 11.1 成本计算流程

当处理 AI 请求时，系统按以下流程计算成本：

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Response       │────▶│  Extract Usage   │────▶│  Get Price Data │
│  from Provider  │     │  (tokens, cache) │     │  (from Session) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Store Cost     │◀────│  Calculate Cost  │◀────│  Apply Pricing  │
│  to Database    │     │  (Decimal.js)    │     │  (tiered, etc.) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### 11.2 价格数据获取策略

**计费模型来源配置：**
系统支持两种计费模型来源，通过 `billingModelSource` 设置控制：
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
1. 首先尝试根据 `billingModelSource` 获取对应模型的价格
2. 如果未找到，尝试使用另一个模型名称（original/redirected）
3. 如果仍未找到，触发异步价格同步并记录警告

### 11.3 成本计算公式

**基础成本计算：**
```
总成本 = (输入tokens × 输入单价) 
       + (输出tokens × 输出单价)
       + (缓存创建tokens × 缓存创建单价)
       + (缓存读取tokens × 缓存读取单价)
       + 按次调用固定费用
```

**分层定价（200K+ tokens）：**
对于 Gemini 等支持分层定价的模型：
```
如果 input_tokens > 200,000:
  前200K成本 = 200,000 × base_input_cost
  超出成本 = (input_tokens - 200,000) × above_200k_input_cost
否则:
  成本 = input_tokens × base_input_cost
```

**1M 上下文窗口（Claude Sonnet）：**
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

**缓存定价回退：**
当价格数据中未明确配置缓存价格时，使用默认倍数：
```typescript
const cacheCreation5mCost = priceData.cache_creation_input_token_cost 
  ?? (inputCostPerToken × 1.25);  // 默认 1.25 倍

const cacheCreation1hCost = priceData.cache_creation_input_token_cost_above_1hr
  ?? (inputCostPerToken × 2.0);   // 默认 2 倍

const cacheReadCost = priceData.cache_read_input_token_cost
  ?? (inputCostPerToken × 0.1);   // 默认 0.1 倍
```

### 11.4 缺失价格处理

当请求处理过程中发现模型没有价格数据时：

```typescript
// response-handler.ts
if (!priceData?.priceData) {
  logger.warn("[CostCalculation] No price data found, skipping billing", {
    messageId,
    originalModel,
    redirectedModel
  });
  
  // 触发异步价格同步
  requestCloudPriceTableSync({ reason: "missing-model" });
  return; // 继续处理请求，但不计费
}
```

**处理策略：**
1. 记录警告日志，包含模型名称和消息 ID
2. 触发异步价格同步（5 分钟节流）
3. 请求继续处理，成本记录为 0
4. 不影响用户体验，后续请求可能能获取到价格

### 11.5 精度控制

所有成本计算使用 `Decimal.js` 库，确保高精度：
```typescript
import Decimal from "decimal.js";

const COST_SCALE = 15; // 15 位小数精度

function multiplyCost(tokens: number, costPerToken?: number): Decimal {
  if (costPerToken == null || tokens <= 0) return new Decimal(0);
  return new Decimal(tokens).mul(costPerToken).toDecimalPlaces(COST_SCALE);
}
```

**精度要求：**
- Token 单价通常很小（如 $0.000001 per token）
- 大量 token 累积需要高精度避免舍入误差
- 15 位小数足以满足财务精度要求

## 12. Web UI 价格管理

### 12.1 价格列表页面

**路径：** `/settings/prices`

**功能特性：**
- **分页显示**：支持 20/50/100/200 条每页
- **搜索过滤**：按模型名称搜索（后端 SQL 查询，500ms 防抖）
- **来源过滤**：全部/本地(manual)/云端(litellm)
- **提供商过滤**：Anthropic/OpenAI/Vertex AI 快捷筛选
- **能力图标**：显示模型支持的功能（函数调用、缓存、视觉等）

**价格显示格式：**
- 输入/输出价格：转换为 $/M tokens 显示
- 图片生成：显示为 $/img
- 缓存价格：分别显示读取、5分钟创建、1小时创建价格

### 12.2 同步按钮工作流

**SyncLiteLLMButton 组件：**

1. **点击触发**：显示加载状态 "检查中..."
2. **冲突检测**：调用 `checkLiteLLMSyncConflicts()`
3. **冲突处理**：
   - 有冲突：打开 SyncConflictDialog，显示冲突列表
   - 无冲突：直接执行同步
4. **执行同步**：调用 `syncLiteLLMPrices(overwriteManual[])`
5. **结果反馈**：
   - 成功：显示新增/更新/未变化数量
   - 部分失败：显示失败模型名称
   - 跳过冲突：显示跳过的手动模型数量

**冲突对话框功能：**
- 表格展示冲突模型（模型名、手动价格、LiteLLM价格）
- 价格差异弹窗：详细对比各项价格字段
- 选择性覆盖：勾选要覆盖的模型
- 搜索过滤：在冲突列表中搜索
- 分页：每页 10 条冲突

### 12.3 手动价格管理

**添加/编辑模型价格：**

**ModelPriceDrawer 组件：**
- **创建模式**：支持搜索现有模型预填充数据
- **编辑模式**：模型名只读，其他字段可修改
- **表单字段**：
  - 模型名称（唯一标识）
  - 显示名称（可选）
  - 模型模式：chat/image_generation/completion
  - 提供商（litellm_provider）
  - 按次调用价格
  - 输入价格（$/M tokens）
  - 输出价格（$/M tokens 或 $/img）
  - 提示缓存开关
  - 缓存价格（读取、5分钟创建、1小时创建）

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
- 删除后刷新列表
- 智能分页处理（如果删除的是最后一页唯一项，返回上一页）

### 12.4 价格表上传

**UploadPriceDialog 组件：**

**支持格式：**
- JSON：标准 PriceTableJson 格式
- TOML：云端价格表格式（自动提取 models 表）

**文件验证：**
- 扩展名：`.json` 或 `.toml`
- 大小限制：10MB
- 内容解析验证

**上传流程：**
1. 选择文件
2. 读取文件内容
3. 调用 `uploadPriceTable(content)`
4. 显示处理结果：
   - 新增模型列表（绿色）
   - 更新模型列表（蓝色）
   - 未变化模型（灰色）
   - 失败模型（红色，显示名称）

**首次部署模式：**
- 当数据库为空时，对话框自动打开
- 上传成功后自动跳转到仪表板
- 显示加载遮罩防止重复操作

## 13. 性能优化

### 13.1 数据库查询优化

**批量查询避免 N+1：**
```typescript
// 一次性获取所有最新价格
const existingLatestPrices = await findAllLatestPrices();
const existingByModelName = new Map(
  existingLatestPrices.map(p => [p.modelName, p])
);

// 遍历时直接 Map 查找，O(1) 复杂度
for (const [modelName, priceData] of Object.entries(priceTable)) {
  const existingPrice = existingByModelName.get(modelName);
  // ...
}
```

**数据库索引：**
```sql
-- 优化获取最新价格的复合索引
CREATE INDEX idx_model_prices_latest 
ON model_prices (model_name, created_at DESC);

-- source 过滤索引
CREATE INDEX idx_model_prices_source 
ON model_prices (source);
```

**DISTINCT ON 查询：**
使用 PostgreSQL 的 `DISTINCT ON` 语法高效获取每个模型的最新价格：
```sql
SELECT DISTINCT ON (model_name)
  id, model_name, price_data, source, created_at
FROM model_prices
ORDER BY model_name, (source = 'manual') DESC, created_at DESC;
```

### 13.2 缓存策略

**Session 级别价格缓存：**
```typescript
// 单个请求内缓存价格数据
private priceDataCache = new Map<string, ModelPrice | null>();

getCachedPriceData(modelName: string): ModelPrice | null {
  if (!this.priceDataCache.has(modelName)) {
    const price = await findLatestPriceByModel(modelName);
    this.priceDataCache.set(modelName, price);
  }
  return this.priceDataCache.get(modelName);
}
```

**避免重复同步：**
- 5 分钟节流窗口
- AsyncTaskManager 去重
- 全局变量标记调度状态

### 13.3 异步处理

**非阻塞同步：**
```typescript
// 触发异步同步，不等待结果
requestCloudPriceTableSync({ reason: "missing-model" });

// 请求继续处理
return response;
```

**后台任务管理：**
- 使用 AsyncTaskManager 管理同步任务生命周期
- 自动清理已完成任务
- 错误捕获防止 uncaughtException

## 14. 安全考虑

### 14.1 权限控制

**管理员权限检查：**
```typescript
// 所有价格管理操作都需要管理员权限
const session = await getSession();
if (!session || session.user.role !== "admin") {
  return { ok: false, error: "无权限执行此操作" };
}
```

**受保护的操作：**
- 同步 LiteLLM 价格
- 上传价格表
- 添加/编辑/删除模型价格
- 查看价格列表（返回空数组给非管理员）

### 14.2 输入验证

**价格数据验证：**
```typescript
// 确保价格数据有效
if (!hasValidPriceData(priceData)) {
  return { ok: false, error: "价格数据无效" };
}

// 检查必需字段
if (!modelName || modelName.trim().length === 0) {
  return { ok: false, error: "模型名称不能为空" };
}
```

**文件上传验证：**
- 文件类型限制（.json, .toml）
- 文件大小限制（10MB）
- 内容格式验证

### 14.3 URL 安全

**云端价格表获取：**
```typescript
// 检测重定向到非预期地址
if (finalUrl.host !== expectedUrl.host) {
  return { ok: false, error: "云端价格表拉取失败：重定向到非预期地址" };
}
```

**请求头：**
- 使用 `Accept: text/plain` 明确期望文本响应
- `cache: "no-store"` 避免缓存旧价格

## 15. 故障排查

### 15.1 常见问题

**问题 1：同步失败，提示"云端价格表拉取失败"**
- 检查网络连接
- 确认 `CLOUD_PRICE_TABLE_URL` 可访问
- 查看日志中的具体错误信息

**问题 2：新模型没有价格**
- 等待 5 分钟后系统自动同步（节流间隔）
- 或手动点击"同步 LiteLLM 价格"
- 检查日志确认同步是否成功

**问题 3：手动设置的价格被覆盖**
- 确认是否在冲突对话框中勾选了该模型
- 手动价格默认不会被覆盖
- 检查 `source` 字段是否为 `manual`

**问题 4：成本计算为 0**
- 检查模型是否有价格数据
- 查看日志是否有 "No price data found" 警告
- 确认价格数据包含有效的价格字段

### 15.2 调试日志

启用详细日志：
```typescript
// 查看价格同步详细日志
logger.info("[PriceSync] Starting cloud price sync...", {
  reason: options.reason,
  throttleMs: options.throttleMs,
});

// 查看成本计算详情
logger.info("[CostCalculation] Calculating cost", {
  modelName,
  inputTokens,
  outputTokens,
  priceData,
});
```

### 15.3 数据库查询

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

-- 统计价格记录数量
SELECT source, COUNT(*) 
FROM model_prices 
GROUP BY source;
```

## 16. 与其他系统的交互

### 16.1 与会话管理系统的交互

价格数据在会话级别进行缓存，避免重复查询数据库：

```typescript
// src/app/v1/_lib/proxy/session.ts
export class ProxySession {
  private priceDataCache = new Map<string, ModelPrice | null>();

  async getCachedPriceDataByBillingSource(
    billingModelSource: "original" | "redirected"
  ): Promise<ModelPrice | null> {
    const modelName = billingModelSource === "original" 
      ? this.getOriginalModel() 
      : this.getCurrentModel();
    
    const cacheKey = `price:${modelName}`;
    
    if (this.priceDataCache.has(cacheKey)) {
      return this.priceDataCache.get(cacheKey)!;
    }
    
    const price = await findLatestPriceByModel(modelName);
    this.priceDataCache.set(cacheKey, price);
    return price;
  }
}
```

**缓存策略：**
- 单个请求内价格数据只查询一次
- 使用 Map 结构实现 O(1) 查找
- 会话结束后缓存自动释放

### 16.2 与限流系统的交互

成本计算结果用于实时限流控制：

```typescript
// 在 response-handler.ts 中
const costUsd = calculateRequestCost(usage, priceData, provider.costMultiplier);

// 更新 Redis 限流计数器
await trackCostToRedis(session, {
  costUsd: costUsd.toNumber(),
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
});
```

**限流维度：**
- 用户 5 小时消费限额
- 用户日消费限额
- 提供商消费限额
- 租赁窗口预算扣除

### 16.3 与通知系统的交互

价格同步结果可以触发通知：

```typescript
// 同步完成后记录日志，可用于审计
logger.info("[PriceSync] Cloud price sync completed", {
  added: result.data.added.length,
  updated: result.data.updated.length,
  unchanged: result.data.unchanged.length,
  failed: result.data.failed.length,
  total: result.data.total,
  triggeredBy: options.reason, // "scheduled" | "manual" | "missing-model"
});
```

**审计日志：**
- 谁在什么时间触发了同步
- 同步结果统计
- 失败原因记录

### 16.4 与监控系统的交互

价格相关指标可用于监控：

**关键指标：**
- `price_sync_total`：同步总次数（按 reason 标签区分）
- `price_sync_failed_total`：同步失败次数
- `price_sync_duration_seconds`：同步耗时
- `models_without_price`：无价格模型数量

**健康检查：**
```typescript
// 检查价格表是否可用
export async function checkPriceTableHealth(): Promise<HealthStatus> {
  const hasPrices = await hasAnyPriceRecords();
  const lastSync = getLastSyncTimestamp();
  
  if (!hasPrices) {
    return { status: "critical", message: "No price data available" };
  }
  
  if (lastSync && Date.now() - lastSync > 24 * 60 * 60 * 1000) {
    return { status: "warning", message: "Price data is stale (>24h)" };
  }
  
  return { status: "healthy", message: "Price table is up to date" };
}
```

## 17. 未来扩展方向

### 17.1 多价格源支持

当前系统仅支持单一云端价格源，未来可扩展支持：

```typescript
interface PriceSource {
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
}

const priceSources: PriceSource[] = [
  { name: "litellm", url: "https://claude-code-hub.app/config/prices-base.toml", priority: 1, enabled: true },
  { name: "custom", url: process.env.CUSTOM_PRICE_URL, priority: 2, enabled: !!process.env.CUSTOM_PRICE_URL },
];
```

### 17.2 价格变更通知

当云端价格发生变化时，主动通知管理员：

```typescript
interface PriceChangeEvent {
  modelName: string;
  oldPrice: ModelPriceData;
  newPrice: ModelPriceData;
  changeType: "increase" | "decrease" | "new";
  percentageChange?: number;
}

async function notifyPriceChanges(changes: PriceChangeEvent[]) {
  const significantChanges = changes.filter(c => 
    c.changeType === "new" || 
    (c.percentageChange && Math.abs(c.percentageChange) > 10)
  );
  
  if (significantChanges.length > 0) {
    await sendNotification({
      type: "price_change",
      changes: significantChanges,
    });
  }
}
```

### 17.3 价格预测与建议

基于历史价格数据提供趋势分析：

```typescript
interface PriceTrend {
  modelName: string;
  currentPrice: number;
  averagePrice7d: number;
  averagePrice30d: number;
  trend: "rising" | "falling" | "stable";
  recommendation?: "buy_now" | "wait" | "switch_model";
}
```

### 17.4 多币种支持

当前系统仅支持 USD，未来可扩展支持多币种：

```typescript
interface MultiCurrencyPrice {
  usd: number;
  eur?: number;
  gbp?: number;
  cny?: number;
  exchangeRateSource: string;
  lastRateUpdate: Date;
}
```

## 18. 总结

价格同步功能是 Claude Code Hub 计费系统的基石，通过多层次的同步机制确保价格数据的准确性和时效性。系统采用本地优先策略，允许管理员灵活控制定价，同时通过自动同步减少维护成本。完善的冲突检测、节流机制和错误处理确保了系统的稳定性和可靠性。

### 核心设计原则

1. **本地优先**：手动设置的价格永远优先于云端价格
2. **自动同步**：多种触发机制确保价格数据及时更新
3. **容错设计**：同步失败不影响正常请求处理
4. **权限控制**：只有管理员可以修改价格数据
5. **高性能**：批量处理、缓存优化、异步执行

### 关键技术指标

- **同步间隔**：30 分钟自动同步
- **节流窗口**：5 分钟最小间隔
- **请求超时**：10 秒云端获取超时
- **成本精度**：15 位小数
- **支持模型**：Claude、OpenAI、Gemini 等主流模型

### 架构亮点

1. **模块化设计**：清晰的模块划分便于维护和扩展
2. **类型安全**：完整的 TypeScript 类型定义
3. **测试覆盖**：全面的单元测试确保可靠性
4. **文档完善**：详细的代码注释和架构文档

---

*文档版本：Round 1 Exploration Draft*  
*最后更新：2026-01-29*  
*关联模块：`src/lib/price-sync/*`, `src/actions/model-prices.ts`, `src/repository/model-price.ts`, `src/lib/utils/cost-calculation.ts`*
