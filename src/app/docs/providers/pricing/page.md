---
title: Provider pricing management
description: Learn how Claude Code Hub tracks API costs, manages model pricing, and handles multi-provider rate limiting.
---

# Provider pricing management

Claude Code Hub includes a comprehensive pricing system that tracks API usage costs across different models and providers. This system enables accurate cost calculation, spending limits, and billing transparency for administrators.

## Overview

The pricing system serves several key purposes:

- **Cost tracking**: Calculate and track API usage costs for each request across different models and providers
- **Rate limiting**: Enable spending limits at provider and system levels based on calculated costs
- **Billing transparency**: Provide clear visibility into pricing for administrators
- **Multi-provider support**: Handle different pricing models from various providers (Anthropic, OpenAI, Gemini, and others)
- **Custom pricing**: Allow administrators to set custom prices through manual price entries that override cloud-synced prices

## Pricing models supported

The system handles multiple pricing structures:

| Pricing model | Description | Example use case |
|--------------|-------------|------------------|
| Per-token pricing | Input and output tokens billed separately | Standard LLM API pricing |
| Per-request fixed fee | Flat fee per request regardless of tokens | Embedding models |
| Tiered pricing | Different rates above token thresholds | Gemini 200K+ context |
| Cache pricing | Separate rates for cache creation and reads | Anthropic prompt caching |
| Image generation | Per-image or per-token pricing | DALL-E, image models |
| Provider multipliers | Scale costs up or down per provider | Markup or discount pricing |

## Core architecture

### Model price storage

Model prices are stored in the `model_prices` database table with the following structure:

```typescript
export const modelPrices = pgTable('model_prices', {
  id: serial('id').primaryKey(),
  modelName: varchar('model_name').notNull(),
  priceData: jsonb('price_data').notNull(),
  // Price source: 'litellm' = synced from cloud, 'manual' = manually added
  source: varchar('source', { length: 20 }).notNull().default('litellm'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

Key design decisions:

- **JSONB price_data**: Flexible schema accommodates different pricing models without schema migrations
- **Source tracking**: Distinguishes between cloud-synced (`litellm`) and manually-added (`manual`) prices
- **Time-based versioning**: Multiple records per model allow price history tracking
- **Manual priority**: When fetching latest prices, manual entries take precedence over cloud-synced prices

### Price data structure

The `ModelPriceData` interface defines all supported pricing fields:

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

### Price retrieval logic

The system uses PostgreSQL's `DISTINCT ON` to get the latest price for each model, with manual prices taking precedence:

```typescript
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

The `(source = 'manual') DESC` clause ensures that manual prices always take precedence over cloud-synced prices, even if the cloud price is newer.

## Cost calculation

### Request cost calculation

The `calculateRequestCost` function computes the total cost for a request by summing multiple cost segments:

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

### Usage metrics

The cost calculation accepts a `UsageMetrics` type that tracks all token usage categories:

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

### Tiered pricing

For Claude 1M context models, tiered pricing uses multipliers:

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

### Cache price fallbacks

When cache prices are not explicitly set, the system uses fallback calculations:

```typescript
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

### Provider cost multiplier

Each provider can have a `costMultiplier` that scales the final cost:

```typescript
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

## Price synchronization

### Cloud price table

The system syncs prices from a cloud-hosted TOML file:

```typescript
export const CLOUD_PRICE_TABLE_URL =
  "https://claude-code-hub.app/config/prices-base.toml";
```

The sync process includes security hardening to verify no unexpected redirects:

```typescript
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
      const finalUrl = new URL(response.url);
      if (
        finalUrl.protocol !== expectedUrl.protocol ||
        finalUrl.host !== expectedUrl.host ||
        finalUrl.pathname !== expectedUrl.pathname
      ) {
        return { ok: false, error: "Cloud price table fetch failed: unexpected redirect" };
      }
    }

    const tomlText = await response.text();
    return { ok: true, data: tomlText };
  } catch (error) {
    return { ok: false, error: `Fetch failed: ${message}` };
  }
}
```

### Processing price updates

The `processPriceTableInternal` function handles bulk price updates:

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

### Sync throttling

To prevent excessive sync requests, the system implements throttling:

```typescript
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
  // ...
}
```

## Manual price management

### Creating and updating manual prices

Administrators can manually add or update prices via the UI. The system uses a delete-then-insert pattern:

```typescript
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

**Important**: This removes ALL historical prices for the model and creates a single new manual record.

### Conflict detection

Before syncing from the cloud, the system checks for conflicts with manual prices:

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

### Price comparison logic

When checking if a price has changed during sync, the system uses deep equality comparison with numeric precision handling:

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

This ensures that minor floating-point differences don't trigger unnecessary updates while still detecting actual price changes.

## Provider rate limits

Providers can have spending limits configured:

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

### Daily reset modes

- **Fixed**: Resets at a specific time every day (configured by `dailyResetTime`)
- **Rolling**: Uses a 24-hour sliding window

## Edge cases and handling

### Missing price data

When a model has no price data:

- Cost calculation returns 0
- Request is still processed
- Admin can trigger async price sync via `requestCloudPriceTableSync({ reason: "missing-model" })`

### Cache token derivation

When cache tokens are reported without TTL separation:

```typescript
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

### Image token pricing

Image tokens have fallback logic:

```typescript
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

### Cost precision

Costs are stored with high precision (15 decimal places) for accurate billing:

```typescript
export const COST_SCALE = 15;
export const COST_DISPLAY_SCALE = 6;
```

## UI capabilities

### Price list

The price list component provides extensive functionality:

**Column display**:

- Model name with capability icons
- Input/output prices (displayed per million tokens)
- Cache read and creation prices
- Last updated timestamp
- Source badge (Local/Cloud)

**Capability icons** (9 types):

- Function calling
- Tool choice
- Response schema
- Prompt caching
- Vision
- PDF input
- Reasoning
- Computer use
- Assistant prefill

**Quick filters**:

- All prices
- Local (manual) only
- Anthropic models
- OpenAI models
- Vertex AI models

**Pagination options**: 20, 50, 100, or 200 items per page

### Conflict resolution

The sync conflict dialog allows administrators to:

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

## API endpoints

The pricing system exposes the following API endpoints (admin-only, GET only):

| Endpoint | Description |
|----------|-------------|
| `/api/prices` | Price list endpoint |
| `/api/prices/cloud-model-count` | Cloud price table model count |

## Best practices

1. **Regular syncs**: Schedule periodic price syncs to stay current with provider pricing changes
2. **Manual overrides**: Use manual prices sparingly and document why they are needed
3. **Conflict review**: Always review conflicts before overwriting manual prices
4. **Provider multipliers**: Use multipliers for consistent markup/discount across all models from a provider
5. **Monitoring**: Monitor cost calculations for anomalies that might indicate pricing errors

## Related documentation

- [Provider management](/docs/provider-management) — Configure providers and their settings
- [Rate limiting](/docs/rate-limiting) — Understand spending limits and quotas
- [Session management](/docs/session-management) — Track usage and costs per session
