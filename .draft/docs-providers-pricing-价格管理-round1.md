# Provider Pricing Management

## Intent Analysis

The provider pricing management system in Claude Code Hub serves multiple
critical purposes:

1. **Cost Tracking**: Accurately calculate and track API usage costs for each
   request across different models and providers
2. **Rate Limiting**: Enable spending limits at user, provider, and system
   levels based on calculated costs
3. **Billing Transparency**: Provide clear visibility into pricing for
   administrators and users
4. **Multi-Provider Support**: Handle different pricing models from various
   providers (Anthropic, OpenAI, Gemini, etc.)
5. **Custom Pricing**: Allow administrators to set custom prices or markups
   through cost multipliers

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
(`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`):

```typescript
export const modelPrices = pgTable('model_prices', {
  id: serial('id').primaryKey(),
  modelName: varchar('model_name').notNull(),
  priceData: jsonb('price_data').notNull(),
  // Price source: 'litellm' = synced from LiteLLM, 'manual' = manually added
  source: varchar('source', { length: 20 }).notNull().default('litellm')
    .$type<'litellm' | 'manual'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // Composite index for fetching latest prices
  modelPricesLatestIdx: index('idx_model_prices_latest')
    .on(table.modelName, table.createdAt.desc()),
  modelPricesModelNameIdx: index('idx_model_prices_model_name')
    .on(table.modelName),
  modelPricesCreatedAtIdx: index('idx_model_prices_created_at')
    .on(table.createdAt.desc()),
  modelPricesSourceIdx: index('idx_model_prices_source').on(table.source),
}));
```

Key design decisions:
- **JSONB price_data**: Flexible schema to accommodate different pricing models
- **Source tracking**: Distinguishes between LiteLLM-synced and manually-added
  prices
- **Time-based versioning**: Multiple records per model allow price history
- **Manual priority**: When fetching latest prices, manual entries take
  precedence

#### 2. Price Data Structure

The `ModelPriceData` interface
(`/Users/ding/Github/claude-code-hub/src/types/model-price.ts`) defines all
supported pricing fields:

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

  // Model metadata
  display_name?: string;
  litellm_provider?: string;
  mode?: "chat" | "image_generation" | "completion";
  supports_prompt_caching?: boolean;
  // ... other capability flags
}
```

#### 3. Price Retrieval Logic

The system uses PostgreSQL's `DISTINCT ON` to get the latest price for each
model, with manual prices taking precedence:

```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts
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

#### 4. Cost Calculation

The `calculateRequestCost` function
(`/Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts`)
computes the total cost for a request:

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
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
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

#### Automatic Sync from LiteLLM CDN

The system can sync prices from the LiteLLM CDN:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/price-sync/cloud-price-table.ts
export const CLOUD_PRICE_TABLE_URL =
  "https://claude-code-hub.app/config/prices-base.toml";

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
    if (expectedUrl && typeof response.url === "string") {
      const finalUrl = new URL(response.url);
      if (finalUrl.host !== expectedUrl.host) {
        return { ok: false, error: "Redirect to unexpected address" };
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

The `processPriceTableInternal` function handles bulk price updates:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/model-prices.ts
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

### Conflict Detection

Before syncing from LiteLLM, the system checks for conflicts with manual
prices:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/model-prices.ts
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
    if (litellmPrice && "mode" in litellmPrice) {
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

Providers can have spending limits configured:

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
export const providers = pgTable('providers', {
  // ...
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode')
    .default('fixed')
    .notNull(), // fixed: reset at fixed time, rolling: 24h window
  dailyResetTime: varchar('daily_reset_time', { length: 5 })
    .default('00:00')
    .notNull(), // HH:mm format
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  totalCostResetAt: timestamp('total_cost_reset_at', { withTimezone: true }),
  // ...
});
```

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

For Claude 1M context models, tiered pricing uses multipliers:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/special-attributes/index.ts
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
  const active = AsyncTaskManager.getActiveTasks();
  if (active.some((t) => t.taskId === taskId)) {
    return;
  }
  // ...
}
```

### 7. Manual Price Priority

Manual prices always take precedence over LiteLLM-synced prices:

```sql
-- From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts
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
export const COST_SCALE = 15;
export const COST_DISPLAY_SCALE = 6;
```

### 9. Provider Cost Multiplier Application

The multiplier is applied after all cost segments are summed:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts
const total = segments.reduce((acc, segment) => acc.plus(segment),
  new Decimal(0));
const multiplierDecimal = new Decimal(multiplier);
return total.mul(multiplierDecimal).toDecimalPlaces(COST_SCALE);
```

This ensures consistent scaling across all cost components.

### 10. Pagination and Search

The price list supports server-side pagination and filtering:

```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts
export interface PaginationParams {
  page: number;
  pageSize: number;
  search?: string;  // Model name search
  source?: ModelPriceSource;  // 'litellm' or 'manual'
  litellmProvider?: string;  // Filter by provider
}
```

## References

### Core Files

1. **Database Schema**
   - `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 459-476)
   - Defines `model_prices` table structure and indexes

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
   - Price list with pagination
   - `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/prices/_components/sync-litellm-button.tsx`
   - Sync button with conflict detection
   - `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/prices/_components/model-price-drawer.tsx`
   - Manual price creation/editing
   - `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/prices/_components/sync-conflict-dialog.tsx`
   - Conflict resolution UI

8. **Constants**
   - `/Users/ding/Github/claude-code-hub/src/lib/special-attributes/index.ts`
   - `CONTEXT_1M_TOKEN_THRESHOLD`, premium multipliers
   - `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts`
   - Provider limit constants

9. **API Routes**
   - `/Users/ding/Github/claude-code-hub/src/app/api/prices/route.ts`
   - Price list API endpoint
   - `/Users/ding/Github/claude-code-hub/src/app/api/prices/cloud-model-count/route.ts`
   - Cloud price table model count

### Key Code Snippets

**Price Data Priority Query:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/model-price.ts
.orderBy(
  sql`(${modelPrices.source} = 'manual') DESC`,
  sql`${modelPrices.createdAt} DESC NULLS LAST`,
  desc(modelPrices.id)
)
```

**Tiered Cost Calculation:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts
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
