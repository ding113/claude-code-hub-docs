# Provider Pricing Management

## Intent Analysis

The provider pricing management system in Claude Code Hub serves multiple critical
purposes:

1. **Cost Tracking**: Accurately calculate and track API usage costs for each
   request across different models and providers
2. **Rate Limiting**: Enable spending limits at provider and system levels based
   on calculated costs
3. **Billing Transparency**: Provide clear visibility into pricing for
   administrators
4. **Multi-Provider Support**: Handle different pricing models from various
   providers (Anthropic, OpenAI, Gemini, etc.)
5. **Custom Pricing**: Allow administrators to set custom prices through manual
   price entries that override cloud-synced prices

The pricing system is designed to be flexible enough to handle:
- Per-token pricing (input/output)
- Per-request fixed fees
- Tiered pricing (200K+ tokens threshold)
- Cache creation and read pricing
- Image generation pricing
- Provider-specific cost multipliers

## Behavior Summary

### Core Pricing Architecture

The pricing system consists of several interconnected components:

#### 1. Model Price Storage

Model prices are stored in the `model_prices` table
(`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`, lines 459-476):

```typescript
export const modelPrices = pgTable('model_prices', {
  id: serial('id').primaryKey(),
  modelName: varchar('model_name').notNull(),
  priceData: jsonb('price_data').notNull(),
  // 价格来源: 'litellm' = 从 LiteLLM 同步, 'manual' = 手动添加
  source: varchar('source', { length: 20 }).notNull().default('litellm')
    .$type<'litellm' | 'manual'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // 优化获取最新价格的复合索引
  modelPricesLatestIdx: index('idx_model_prices_latest')
    .on(table.modelName, table.createdAt.desc()),
  // 基础索引
  modelPricesModelNameIdx: index('idx_model_prices_model_name')
    .on(table.modelName),
  modelPricesCreatedAtIdx: index('idx_model_prices_created_at')
    .on(table.createdAt.desc()),
  // 按来源过滤的索引
  modelPricesSourceIdx: index('idx_model_prices_source').on(table.source),
}));
```

Key design decisions:
- **JSONB price_data**: Flexible schema to accommodate different pricing models
- **Source tracking**: Distinguishes between cloud-synced ('litellm') and
  manually-added ('manual') prices
- **Time-based versioning**: Multiple records per model allow price history
- **Manual priority**: When fetching latest prices, manual entries take
  precedence over cloud-synced entries

#### 2. Price Data Structure

The `ModelPriceData` interface
(`/Users/ding/Github/claude-code-hub/src/types/model-price.ts`, lines 4-60)
defines all supported pricing fields:

```typescript
export interface ModelPriceData {
  // Base pricing
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  input_cost_per_request?: number; // Fixed fee per request

  // Cache pricing
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
  cache_read_input_token_cost?: number;

  // 200K tiered pricing (for Gemini, etc.)
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  cache_creation_input_token_cost_above_200k_tokens?: number;
  cache_read_input_token_cost_above_200k_tokens?: number;

  // Image generation pricing
  output_cost_per_image?: number;
  output_cost_per_image_token?: number;
  input_cost_per_image?: number;
  input_cost_per_image_token?: number;

  // Search context pricing (for search-enabled models)
  search_context_cost_per_query?: {
    search_context_size_low?: number;
    search_context_size_medium?: number;
    search_context_size_high?: number;
  };

  // Model metadata
  display_name?: string;
  litellm_provider?: string;
  providers?: string[];
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  mode?: "chat" | "image_generation" | "completion";

  // Capability flags
  supports_assistant_prefill?: boolean;
  supports_computer_use?: boolean;
  supports_function_calling?: boolean;
  supports_pdf_input?: boolean;
  supports_prompt_caching?: boolean;
  supports_reasoning?: boolean;
  supports_response_schema?: boolean;
  supports_tool_choice?: boolean;
  supports_vision?: boolean;

  // Other
  tool_use_system_prompt_tokens?: number;
  [key: string]: unknown;
}
```

#### 3. Price Retrieval Logic

The system uses PostgreSQL's `DISTINCT ON` to get the latest price for each
model, with manual prices taking precedence:

```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts
// Lines 74-88: findAllLatestPrices function
const query = sql`
  SELECT DISTINCT ON (model_name)
    id,
    model_name as "modelName",
    price_data as "priceData",
    source,
    created_at as "createdAt",
    updated_at as "updatedAt"
  FROM model_prices
  ORDER BY
    model_name,
    (source = 'manual') DESC,  -- Manual prices first
    created_at DESC NULLS LAST,
    id DESC
`;
```

The `(source = 'manual') DESC` clause ensures that manual prices always take
precedence over cloud-synced prices, even if the cloud price is newer.

#### 4. Cost Calculation

The `calculateRequestCost` function
(`/Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts`,
lines 109-311) computes the total cost for a request:

```typescript
export function calculateRequestCost(
  usage: UsageMetrics,
  priceData: ModelPriceData,
  multiplier: number = 1.0,
  context1mApplied: boolean = false
): Decimal {
  const segments: Decimal[] = [];

  // 1. Fixed per-request fee
  if (typeof inputCostPerRequest === "number") {
    segments.push(toDecimal(inputCostPerRequest));
  }

  // 2. Input tokens (with tiered pricing support)
  if (context1mApplied && inputCostPerToken != null) {
    // Claude 1M context: use multiplier-based tiering
    segments.push(calculateTieredCost(
      usage.input_tokens,
      inputCostPerToken,
      CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER
    ));
  } else if (inputAbove200k != null) {
    // Gemini: use separate price fields
    segments.push(calculateTieredCostWithSeparatePrices(
      usage.input_tokens,
      inputCostPerToken,
      inputAbove200k
    ));
  } else {
    // Standard calculation
    segments.push(multiplyCost(usage.input_tokens, inputCostPerToken));
  }

  // 3. Output tokens (similar tiered logic)
  // ...

  // 4. Cache creation (5min and 1hour TTL)
  // ...

  // 5. Cache read
  // ...

  // 6. Image tokens
  // ...

  // Apply provider multiplier
  const total = segments.reduce((acc, seg) => acc.plus(seg), new Decimal(0));
  return total.mul(multiplier).toDecimalPlaces(COST_SCALE);
}
```

#### 5. Provider Cost Multiplier

Each provider can have a `costMultiplier` that scales the final cost:

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (line 165)
export const providers = pgTable('providers', {
  // ...
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 })
    .default('1.0'),
  // ...
});
```

This multiplier is applied at the end of cost calculation, allowing:
- Markup pricing (multiplier > 1.0)
- Discount pricing (multiplier < 1.0)
- Pass-through pricing (multiplier = 1.0)

## Config/Commands

### Price Synchronization

#### Automatic Sync from Cloud Price Table

The system syncs prices from a cloud-hosted TOML file:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/price-sync/cloud-price-table.ts
// Line 4
export const CLOUD_PRICE_TABLE_URL =
  "https://claude-code-hub.app/config/prices-base.toml";

// Lines 53-107
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

    // Security: Verify no unexpected redirects
    if (expectedUrl && typeof response.url === "string" && response.url) {
      try {
        const finalUrl = new URL(response.url);
        if (
          finalUrl.protocol !== expectedUrl.protocol ||
          finalUrl.host !== expectedUrl.host ||
          finalUrl.pathname !== expectedUrl.pathname
        ) {
          return { ok: false, error: "云端价格表拉取失败：重定向到非预期地址" };
        }
      } catch {
        // Continue if response.url cannot be parsed
      }
    }

    const tomlText = await response.text();
    return { ok: true, data: tomlText };
  } catch (error) {
    return { ok: false, error: `Fetch failed: ${message}` };
  }
}
```

#### TOML Parsing

The TOML price table format supports nested pricing tables:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/price-sync/cloud-price-table.ts
// Lines 18-51
export function parseCloudPriceTableToml(
  tomlText: string
): CloudPriceTableResult<CloudPriceTable> {
  const parsed = TOML.parse(tomlText) as unknown;

  const modelsValue = parsed.models;
  if (!isRecord(modelsValue)) {
    return { ok: false, error: "Invalid format: missing models table" };
  }

  const models: Record<string, ModelPriceData> = Object.create(null);
  for (const [modelName, value] of Object.entries(modelsValue)) {
    // Security: Skip prototype pollution keys
    if (modelName === "__proto__" || modelName === "constructor") {
      continue;
    }
    models[modelName] = value as unknown as ModelPriceData;
  }

  return { ok: true, data: { metadata, models } };
}
```

#### Processing Price Updates

The `processPriceTableInternal` function handles bulk price updates
(`/Users/ding/Github/claude-code-hub/src/actions/model-prices.ts`, lines 75-195):

```typescript
export async function processPriceTableInternal(
  jsonContent: string,
  overwriteManual?: string[]
): Promise<ActionResult<PriceUpdateResult>> {
  const priceTable: PriceTableJson = JSON.parse(jsonContent);

  // Get existing manual prices for conflict detection
  const manualPrices = await findAllManualPrices();
  const overwriteSet = new Set(overwriteManual ?? []);

  for (const [modelName, priceData] of entries) {
    // Skip manual prices not in overwrite list
    const isManualPrice = manualPrices.has(modelName);
    if (isManualPrice && !overwriteSet.has(modelName)) {
      result.skippedConflicts?.push(modelName);
      result.unchanged.push(modelName);
      continue;
    }

    if (!existingPrice) {
      await createModelPrice(modelName, priceData, "litellm");
      result.added.push(modelName);
    } else if (!isPriceDataEqual(existingPrice.priceData, priceData)) {
      // Delete old record first if overwriting manual
      if (isManualPrice && overwriteSet.has(modelName)) {
        await deleteModelPriceByName(modelName);
      }
      await createModelPrice(modelName, priceData, "litellm");
      result.updated.push(modelName);
    } else {
      result.unchanged.push(modelName);
    }
  }
}
```

### Manual Price Management

#### Creating/Updating Manual Prices

Administrators can manually add or update prices via the UI:

```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts
// Lines 205-225
export async function upsertModelPrice(
  modelName: string,
  priceData: ModelPriceData
): Promise<ModelPrice> {
  return await db.transaction(async (tx) => {
    // Delete all old records for this model
    await tx.delete(modelPrices)
      .where(eq(modelPrices.modelName, modelName));

    // Insert new record with source='manual'
    const [price] = await tx
      .insert(modelPrices)
      .values({
        modelName: modelName,
        priceData: priceData,
        source: "manual",
      })
      .returning();
    return toModelPrice(price);
  });
}
```

**Important**: This is a delete-then-insert pattern, not a true UPSERT. It removes
ALL historical prices for the model and creates a single new manual record.

### Conflict Detection

Before syncing from the cloud, the system checks for conflicts with manual
prices (`/Users/ding/Github/claude-code-hub/src/actions/model-prices.ts`,
lines 339-394):

```typescript
export async function checkLiteLLMSyncConflicts(): Promise<
  ActionResult<SyncConflictCheckResult>
> {
  const tomlResult = await fetchCloudPriceTableToml();
  const parseResult = parseCloudPriceTableToml(tomlResult.data);
  const priceTable: PriceTableJson = parseResult.data.models;

  // Get all manual prices from database
  const manualPrices = await findAllManualPrices();

  // Build conflict list
  const conflicts: SyncConflict[] = [];
  for (const [modelName, manualPrice] of manualPrices) {
    const litellmPrice = priceTable[modelName];
    if (litellmPrice && typeof litellmPrice === "object" &&
        "mode" in litellmPrice) {
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

### Provider Rate Limits

Providers can have spending limits configured
(`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`, lines 216-228):

```typescript
export const providers = pgTable('providers', {
  // ...
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode')
    .default('fixed')
    .notNull(), // 'fixed' or 'rolling'
  dailyResetTime: varchar('daily_reset_time', { length: 5 })
    .default('00:00')
    .notNull(), // HH:mm format (only used in fixed mode)
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  totalCostResetAt: timestamp('total_cost_reset_at', { withTimezone: true }),
  limitConcurrentSessions: integer('limit_concurrent_sessions')
    .default(0),
  // ...
});
```

**Daily Reset Modes**:
- **fixed**: Resets at a specific time every day (configured by `dailyResetTime`)
- **rolling**: Uses a 24-hour sliding window

## Edge Cases

### 1. Missing Price Data

When a model has no price data:
- Cost calculation returns 0
- Request is still processed
- Admin can trigger async price sync via
  `requestCloudPriceTableSync({ reason: "missing-model" })`

### 2. Cache Token Derivation

When cache tokens are reported without TTL separation:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts
// Lines 149-165
if (typeof usage.cache_creation_input_tokens === "number") {
  const remaining = usage.cache_creation_input_tokens -
    (cache5mTokens ?? 0) - (cache1hTokens ?? 0);

  if (remaining > 0) {
    const target = usage.cache_ttl === "1h" ? "1h" : "5m";
    if (target === "1h") {
      cache1hTokens = (cache1hTokens ?? 0) + remaining;
    } else {
      cache5mTokens = (cache5mTokens ?? 0) + remaining;
    }
  }
}
```

### 3. Tiered Pricing Calculation

For Claude 1M context models, tiered pricing uses multipliers
(`/Users/ding/Github/claude-code-hub/src/lib/special-attributes/index.ts`,
lines 38-46):

```typescript
export const CONTEXT_1M_TOKEN_THRESHOLD = 200000;
export const CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER = 2.0;   // 2x for >200k
export const CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER = 1.5;  // 1.5x for >200k
```

For Gemini models, separate price fields are used:

```typescript
// input_cost_per_token for <=200k
// input_cost_per_token_above_200k_tokens for >200k
```

### 4. Cache Price Fallbacks

When cache prices are not explicitly set:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts
// Lines 132-147
const cacheCreation5mCost =
  priceData.cache_creation_input_token_cost ??
  (inputCostPerToken != null ? inputCostPerToken * 1.25 : undefined);

const cacheCreation1hCost =
  priceData.cache_creation_input_token_cost_above_1hr ??
  (inputCostPerToken != null ? inputCostPerToken * 2 : undefined) ??
  cacheCreation5mCost;

const cacheReadCost =
  priceData.cache_read_input_token_cost ??
  (inputCostPerToken != null
    ? inputCostPerToken * 0.1
    : outputCostPerToken != null
      ? outputCostPerToken * 0.1
      : undefined);
```

### 5. Image Token Pricing

Image tokens have fallback logic:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts
// Lines 291-304
// Output image tokens
if (usage.output_image_tokens != null && usage.output_image_tokens > 0) {
  const imageCostPerToken =
    priceData.output_cost_per_image_token ??
    priceData.output_cost_per_token;
  segments.push(multiplyCost(usage.output_image_tokens, imageCostPerToken));
}

// Input image tokens
if (usage.input_image_tokens != null && usage.input_image_tokens > 0) {
  const imageCostPerToken =
    priceData.input_cost_per_image_token ??
    priceData.input_cost_per_token;
  segments.push(multiplyCost(usage.input_image_tokens, imageCostPerToken));
}
```

### 6. Price Sync Throttling

To prevent excessive sync requests:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/price-sync/cloud-price-updater.ts
// Lines 48-129
const DEFAULT_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

export function requestCloudPriceTableSync(options: {
  reason: "missing-model" | "scheduled" | "manual";
  throttleMs?: number;
}): void {
  const lastAt = g.__CCH_CLOUD_PRICE_SYNC_LAST_AT__ ?? 0;
  const now = Date.now();
  if (now - lastAt < throttleMs) {
    return; // Skip if within throttle period
  }

  // Deduplication: Check if task already running
  if (g.__CCH_CLOUD_PRICE_SYNC_SCHEDULING__) {
    return;
  }
  g.__CCH_CLOUD_PRICE_SYNC_SCHEDULING__ = true;

  const active = AsyncTaskManager.getActiveTasks();
  if (active.some((t) => t.taskId === taskId)) {
    return;
  }
  // ...
}
```

### 7. Manual Price Priority

Manual prices always take precedence over cloud-synced prices:

```sql
-- From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts
-- Lines 74-88
ORDER BY
  model_name,
  (source = 'manual') DESC,  -- Manual first
  created_at DESC NULLS LAST,
  id DESC
```

### 8. Cost Precision

Costs are stored with high precision (15 decimal places):

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/utils/currency.ts
// Line 12
export const COST_SCALE = 15;
export const COST_DISPLAY_SCALE = 6;
```

### 9. Provider Cost Multiplier Application

The multiplier is applied after all cost segments are summed:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts
// Lines 306-310
const total = segments.reduce((acc, segment) => acc.plus(segment),
  new Decimal(0));
const multiplierDecimal = new Decimal(multiplier);
return total.mul(multiplierDecimal).toDecimalPlaces(COST_SCALE);
```

This ensures consistent scaling across all cost components.

### 10. Pagination and Search

The price list supports server-side pagination and filtering
(`/Users/ding/Github/claude-code-hub/src/repository/model-price.ts`,
lines 13-19):

```typescript
export interface PaginationParams {
  page: number;
  pageSize: number;
  search?: string;  // Model name search (ILIKE)
  source?: ModelPriceSource;  // 'litellm' or 'manual'
  litellmProvider?: string;  // Filter by provider
}
```

### 11. Usage Metrics Type

The cost calculation accepts a `UsageMetrics` type that tracks all token usage
categories (`/Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts`,
lines 9-20):

```typescript
type UsageMetrics = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;      // Generic cache creation (legacy)
  cache_creation_5m_input_tokens?: number;   // 5-minute TTL cache
  cache_creation_1h_input_tokens?: number;   // 1-hour TTL cache
  cache_ttl?: "5m" | "1h" | "mixed";
  cache_read_input_tokens?: number;
  input_image_tokens?: number;   // Image modality input tokens
  output_image_tokens?: number;  // Image modality output tokens
};
```

### 12. Price Comparison Logic

When checking if a price has changed during sync, the system uses deep equality
comparison (`/Users/ding/Github/claude-code-hub/src/actions/model-prices.ts`,
lines 34-67):

```typescript
function isPriceDataEqual(
  existing: ModelPriceData,
  incoming: ModelPriceData
): boolean {
  const keys = new Set([
    ...Object.keys(existing),
    ...Object.keys(incoming),
  ]);

  for (const key of keys) {
    const existingVal = existing[key];
    const incomingVal = incoming[key];

    // Handle numeric comparisons with precision
    if (typeof existingVal === "number" && typeof incomingVal === "number") {
      if (Math.abs(existingVal - incomingVal) > 1e-15) {
        return false;
      }
      continue;
    }

    // Direct comparison for non-numeric values
    if (existingVal !== incomingVal) {
      return false;
    }
  }

  return true;
}
```

This ensures that minor floating-point differences don't trigger unnecessary
updates while still detecting actual price changes.

### 13. Transformer Layer

The repository uses a transformer to convert database rows to TypeScript objects
(`/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts`,
lines 157-164):

```typescript
export function toModelPrice(row: ModelPricesTable): ModelPrice {
  return {
    id: row.id,
    modelName: row.modelName,
    priceData: row.priceData as ModelPriceData,
    source: (row.source ?? "litellm") as ModelPriceSource,
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
  };
}
```

The transformer provides default values for missing dates and ensures the
source field defaults to 'litellm' if not specified.

### 14. Price List UI Capabilities

The price list component (`price-list.tsx`) provides extensive functionality:

**Column Display**:
- Model name with capability icons
- Input/output prices (displayed per million tokens)
- Cache read and creation prices
- Last updated timestamp
- Source badge (Local/Cloud)

**Capability Icons** (9 types):
- Function calling
- Tool choice
- Response schema
- Prompt caching
- Vision
- PDF input
- Reasoning
- Computer use
- Assistant prefill

**Quick Filters**:
- All prices
- Local (manual) only
- Anthropic models
- OpenAI models
- Vertex AI models

**Pagination Options**: 20, 50, 100, or 200 items per page

### 15. Conflict Resolution UI

The sync conflict dialog (`sync-conflict-dialog.tsx`) allows administrators to:

1. **Review conflicts**: See side-by-side comparison of manual vs cloud prices
2. **Search conflicts**: Filter by model name
3. **Selective overwrite**: Choose which models to update
4. **Price diff view**: Detailed comparison showing:
   - Input price changes
   - Output price changes
   - Image price changes
   - Provider changes
   - Mode changes

Color coding:
- Red: Current manual price
- Green: Cloud price that would replace it

## References

### Core Files

1. **Database Schema**
   - `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 459-476)
   - Defines `model_prices` table structure and indexes
   - `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 148-297)
   - Defines `providers` table with cost multiplier and limits

2. **Type Definitions**
   - `/Users/ding/Github/claude-code-hub/src/types/model-price.ts`
   - `ModelPriceData`, `ModelPrice`, `PriceUpdateResult`, `SyncConflict`

3. **Repository Layer**
   - `/Users/ding/Github/claude-code-hub/src/repository/model-price.ts`
   - CRUD operations, pagination, manual price queries

4. **Cost Calculation**
   - `/Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts`
   - `calculateRequestCost`, tiered pricing logic

5. **Price Sync**
   - `/Users/ding/Github/claude-code-hub/src/lib/price-sync/cloud-price-table.ts`
   - `fetchCloudPriceTableToml`, `parseCloudPriceTableToml`
   - `/Users/ding/Github/claude-code-hub/src/lib/price-sync/cloud-price-updater.ts`
   - `syncCloudPriceTableToDatabase`, `requestCloudPriceTableSync`

6. **Actions**
   - `/Users/ding/Github/claude-code-hub/src/actions/model-prices.ts`
   - `processPriceTableInternal`, `uploadPriceTable`,
     `syncLiteLLMPrices`, `checkLiteLLMSyncConflicts`

7. **UI Components**
   - `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/prices/page.tsx`
   - Main price management page
   - `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/prices/_components/price-list.tsx`
   - Price list with pagination (794 lines)
   - `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/prices/_components/sync-litellm-button.tsx`
   - Sync button with conflict detection (154 lines)
   - `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/prices/_components/model-price-drawer.tsx`
   - Manual price creation/editing (634 lines)
   - `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/prices/_components/sync-conflict-dialog.tsx`
   - Conflict resolution UI (392 lines)

8. **Constants**
   - `/Users/ding/Github/claude-code-hub/src/lib/special-attributes/index.ts`
   - `CONTEXT_1M_TOKEN_THRESHOLD`, premium multipliers
   - `/Users/ding/Github/claude-code-hub/src/lib/utils/currency.ts`
   - `COST_SCALE`, `COST_DISPLAY_SCALE`

9. **API Routes**
   - `/Users/ding/Github/claude-code-hub/src/app/api/prices/route.ts`
   - Price list API endpoint (GET only, admin-only)
   - `/Users/ding/Github/claude-code-hub/src/app/api/prices/cloud-model-count/route.ts`
   - Cloud price table model count (GET only, admin-only)

### Key Code Snippets

**Price Data Priority Query:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts
// Lines 79-87
.orderBy(
  sql`(${modelPrices.source} = 'manual') DESC`,
  sql`${modelPrices.createdAt} DESC NULLS LAST`,
  desc(modelPrices.id)
)
```

**Tiered Cost Calculation:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts
// Lines 42-65
function calculateTieredCost(
  tokens: number,
  baseCostPerToken: number,
  premiumMultiplier: number,
  threshold: number = CONTEXT_1M_TOKEN_THRESHOLD
): Decimal {
  if (tokens <= threshold) {
    return new Decimal(tokens).mul(baseCostPerToken);
  }

  const baseCost = new Decimal(threshold).mul(baseCostPerToken);
  const premiumTokens = tokens - threshold;
  const premiumCost = new Decimal(premiumTokens)
    .mul(baseCostPerToken)
    .mul(premiumMultiplier);

  return baseCost.add(premiumCost);
}
```

**Conflict Detection:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/model-prices.ts
// Lines 368-378
for (const [modelName, manualPrice] of manualPrices) {
  const litellmPrice = priceTable[modelName];
  if (litellmPrice && typeof litellmPrice === "object" &&
      "mode" in litellmPrice) {
    conflicts.push({
      modelName,
      manualPrice: manualPrice.priceData,
      litellmPrice: litellmPrice as ModelPriceData,
    });
  }
}
```

**Price Update Processing:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/model-prices.ts
// Lines 155-173
if (!existingPrice) {
  await createModelPrice(modelName, priceData, "litellm");
  result.added.push(modelName);
} else if (!isPriceDataEqual(existingPrice.priceData, priceData)) {
  if (isManualPrice && overwriteSet.has(modelName)) {
    await deleteModelPriceByName(modelName);
  }
  await createModelPrice(modelName, priceData, "litellm");
  result.updated.push(modelName);
} else {
  result.unchanged.push(modelName);
}
```

**Repository Functions:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts

// Lines 35-67: Get latest price for specific model
export async function findLatestPriceByModel(
  modelName: string
): Promise<ModelPrice | null>

// Lines 73-92: Get all latest prices (non-paginated)
export async function findAllLatestPrices(): Promise<ModelPrice[]>

// Lines 98-162: Get paginated prices with filters
export async function findAllLatestPricesPaginated(
  params: PaginationParams
): Promise<PaginatedResult<ModelPrice>>

// Lines 177-199: Create new price record
export async function createModelPrice(
  modelName: string,
  priceData: ModelPriceData,
  source?: ModelPriceSource
): Promise<ModelPrice>

// Lines 205-225: Delete old + insert new (manual only)
export async function upsertModelPrice(
  modelName: string,
  priceData: ModelPriceData
): Promise<ModelPrice>

// Lines 238-263: Get all manual prices as Map
export async function findAllManualPrices(): Promise<Map<string, ModelPrice>>
```

---

## Corrections from Round 1

The following corrections were made based on verification against the actual
codebase:

### 1. Price Sync URL (CORRECTED)
- **Round 1 Claim**: Syncs from "LiteLLM CDN"
- **Actual**: Syncs from `https://claude-code-hub.app/config/prices-base.toml`
- **Correction**: Updated all references to "cloud price table" instead of
  "LiteLLM CDN"

### 2. Throttle Duration (CORRECTED)
- **Round 1 Claim**: 1 minute throttle
- **Actual**: 5 minutes (`5 * 60 * 1000` ms)
- **Correction**: Updated to reflect actual 5-minute default throttle

### 3. Missing ModelPriceData Fields (ADDED)
- **Round 1 Omission**: Did not document several fields
- **Correction**: Added complete list of 35+ fields including:
  - `search_context_cost_per_query` (lines 31-35)
  - `providers` array (line 40)
  - `max_input_tokens`, `max_output_tokens`, `max_tokens` (lines 41-43)
  - `tool_use_system_prompt_tokens` (line 58)
  - Index signature `[key: string]: unknown` (line 59)

### 4. API Route Methods (CLARIFIED)
- **Round 1**: Did not specify HTTP methods
- **Correction**: Both price API routes are GET only, admin-only:
  - `/api/prices` - GET only
  - `/api/prices/cloud-model-count` - GET only

### 5. Line Number Precision (CORRECTED)
- All line numbers verified against actual source files:
  - `model_prices` table: Lines 459-476
  - `calculateRequestCost`: Lines 109-311
  - `processPriceTableInternal`: Lines 75-195
  - `upsertModelPrice`: Lines 205-225
  - `checkLiteLLMSyncConflicts`: Lines 339-394

### 6. Upsert Behavior (CLARIFIED)
- **Round 1**: Described as "update or insert"
- **Actual**: Delete-then-insert pattern that removes ALL historical prices
- **Correction**: Added explicit note about delete-then-insert behavior

### 7. Cost Scale Constant (VERIFIED)
- **Round 1**: Mentioned COST_SCALE = 15
- **Actual**: Confirmed at line 12 in currency.ts
- **Status**: Correct, no change needed

### 8. Cache Fallback Multipliers (VERIFIED)
- **Round 1**: Documented fallback calculations
- **Actual**: Confirmed exact multipliers:
  - 5m cache creation: input * 1.25
  - 1h cache creation: input * 2
  - Cache read: input * 0.1 or output * 0.1
- **Status**: Correct, no change needed

### 9. UI Component Line Counts (ADDED)
- Added actual line counts for UI components:
  - price-list.tsx: 794 lines
  - model-price-drawer.tsx: 634 lines
  - sync-conflict-dialog.tsx: 392 lines
  - sync-litellm-button.tsx: 154 lines

### 10. Provider Limit Fields (VERIFIED)
- **Round 1**: Documented limit fields
- **Actual**: Confirmed all fields at lines 216-228
- **Addition**: Documented `limitConcurrentSessions` with default 0

### 11. Cloud Price Table Security (ADDED)
- **Round 1**: Did not mention redirect validation
- **Correction**: Added security hardening section showing redirect validation
  (lines 76-89 in cloud-price-table.ts)

### 12. PriceUpdateResult skippedConflicts (ADDED)
- **Round 1**: Did not mention this field
- **Actual**: Present in type definition (line 95)
- **Correction**: Added to PriceUpdateResult documentation
