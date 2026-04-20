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

  // 2. Input tokens (with explicit long-context fields)
  if (inputAbove272k != null) {
    segments.push(calculateTieredCostWithSeparatePrices(
      usage.input_tokens,
      inputCostPerToken,
      inputAbove272k
    ));
  } else if (inputAbove200k != null) {
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

The system no longer relies on a built-in Claude `2.0x / 1.5x` premium multiplier. Long-context pricing is driven by explicit fields from the cloud price table:

```typescript
// 272K tier (GPT / Codex style)
input_cost_per_token_above_272k_tokens
output_cost_per_token_above_272k_tokens

// 200K tier (Claude legacy / Gemini / provider-specific overrides)
input_cost_per_token_above_200k_tokens
output_cost_per_token_above_200k_tokens
```

If a model has no `*_above_200k_tokens` or `*_above_272k_tokens` field, long-context requests continue using the standard per-token price.

For Claude 1M GA models such as `claude-opus-4-7`, `claude-opus-4-6`, and `claude-sonnet-4-6`, the current official Anthropic pricing is standard-rate across the full window, so the cloud price table should not include extra long-context surcharge fields for the official Anthropic alias.

For models that do define long-context tiers, separate price fields are used:

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

## Provider-aware pricing resolution (v0.6.2+)

Starting from v0.6.2, Claude Code Hub uses a **5-level fallback chain** to resolve which pricing data to apply for each request. The system matches the user's configured provider (by name and URL) to the correct pricing entry inside the cloud price table, so the same model routed through different providers can have different per-token costs.

### Resolution chain

The `resolvePricingForModelRecords` function in `pricing-resolution.ts` walks through five levels in order, returning the first successful match:

| Level | Source type | Description |
|-------|-----------|-------------|
| 1 | `local_manual` | A manually-entered price record (source = `"manual"`) in the database. Always wins. |
| 2 | `cloud_exact` | The cloud price record's `pricing` map contains a key that matches the provider (e.g. `"openrouter"`, `"opencode"`, `"anthropic"`). |
| 3 | `official_fallback` | No exact provider match, but the model's official provider key is present (e.g. GPT models fall back to `"openai"`). |
| 4 | `priority_fallback` | No provider match at all. The system picks the pricing entry with the **most detailed price fields**, using a tie-break order: `openrouter > opencode > cloudflare-ai-gateway > github-copilot > chatgpt`. |
| 5 | `single_provider_top_level` | The cloud record has valid top-level price fields but no `pricing` map. Uses these fields directly. |

If all five levels fail (no valid numeric price found anywhere), the resolution returns `null` and cost defaults to zero.

### Provider matching rules

Provider identification uses heuristics based on the provider's `name` and `url` fields:

```typescript
// Matching is case-insensitive and checks both name and URL host
if (name.includes("openrouter") || host.includes("openrouter")) {
  pushUnique(candidates, "openrouter", "exact");
}
if (name.includes("anthropic") || host.includes("anthropic.com")) {
  pushUnique(candidates, "anthropic", "exact");
}
// ... similar rules for openai, vertex, github-copilot, chatgpt, etc.
```

Official provider keys are inferred from the model name or `model_family` field:

- GPT / GPT-Pro family -> `"openai"`
- Claude family -> `"anthropic"`
- Gemini family -> `"vertex_ai"`, `"vertex"`, `"google"`

### Pricing source display

Each resolved price carries a `source` tag (`ResolvedPricingSource`) that is displayed in the usage logs UI. The six possible values are:

- `local_manual` — Price was set manually by admin
- `cloud_exact` — Exact provider match in cloud data
- `cloud_model_fallback` — Matched via a fallback model name
- `official_fallback` — Matched via official provider key
- `priority_fallback` — Best-detail heuristic pick
- `single_provider_top_level` — Top-level fields only, no per-provider breakdown

### Detail scoring

When falling back to `priority_fallback`, the system scores each pricing entry by counting how many of the following fields are present (higher is better):

```typescript
const DETAIL_FIELDS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "input_cost_per_request",
  "cache_creation_input_token_cost",
  "cache_read_input_token_cost",
  "input_cost_per_token_above_200k_tokens",
  "input_cost_per_token_above_272k_tokens",
  // ... 26 fields total including priority and cache variants
] as const;
```

---

## GPT-5.4 272K token threshold (v0.6.2+)

v0.6.2 adds a new long-context pricing threshold at **272,000 tokens** to support OpenAI's GPT-5.4 and GPT-Pro models, alongside the existing 200K threshold used by Gemini.

### Automatic threshold detection

The `resolveLongContextThreshold` function in `cost-calculation.ts` automatically selects the correct threshold:

```typescript
const OPENAI_LONG_CONTEXT_TOKEN_THRESHOLD = 272000;

function resolveLongContextThreshold(priceData: ModelPriceData): number {
  const has272kFields =
    typeof priceData.input_cost_per_token_above_272k_tokens === "number" ||
    typeof priceData.output_cost_per_token_above_272k_tokens === "number" ||
    // ... checks all 272k fields

  const modelFamily = typeof priceData.model_family === "string"
    ? priceData.model_family : "";

  if (has272kFields || modelFamily === "gpt" || modelFamily === "gpt-pro") {
    return OPENAI_LONG_CONTEXT_TOKEN_THRESHOLD; // 272,000
  }

  return CONTEXT_1M_TOKEN_THRESHOLD; // 200,000 (default)
}
```

Detection triggers on:
- Any `*_above_272k_tokens*` field present with a numeric value, **or**
- `model_family` is `"gpt"` or `"gpt-pro"`

### 272K price fields

The full set of 272K-specific price fields in `ModelPriceData`:

| Field | Description |
|-------|-------------|
| `input_cost_per_token_above_272k_tokens` | Input token rate above 272K |
| `output_cost_per_token_above_272k_tokens` | Output token rate above 272K |
| `cache_creation_input_token_cost_above_272k_tokens` | Cache creation (5min TTL) above 272K |
| `cache_read_input_token_cost_above_272k_tokens` | Cache read above 272K |
| `cache_creation_input_token_cost_above_1hr_above_272k_tokens` | Cache creation (1hr TTL) above 272K |
| `input_cost_per_token_above_272k_tokens_priority` | Priority tier input above 272K |
| `output_cost_per_token_above_272k_tokens_priority` | Priority tier output above 272K |
| `cache_read_input_token_cost_above_272k_tokens_priority` | Priority tier cache read above 272K |

### Priority service tier support

For models that support OpenAI's priority service tier, the cost calculation picks the most specific rate via `resolvePriorityAwareLongContextRate`:

```typescript
function resolvePriorityAwareLongContextRate(
  priorityServiceTierApplied: boolean,
  fields: {
    above272k?: number;
    above272kPriority?: number;
    above200k?: number;
    above200kPriority?: number;
  }
): number | undefined {
  if (priorityServiceTierApplied) {
    // Priority: 272k-priority > 200k-priority > 272k > 200k
    return fields.above272kPriority
      ?? fields.above200kPriority
      ?? fields.above272k
      ?? fields.above200k;
  }
  // Non-priority: 272k > 200k
  return fields.above272k ?? fields.above200k;
}
```

---

## Long-context tiered pricing fix (v0.6.2+)

v0.6.2 fixes a critical billing accuracy issue in how long-context pricing is applied.

### Before (incorrect)

Previously, the tiered cost calculation split tokens at the threshold: tokens below the threshold were billed at the base rate, and only tokens above the threshold used the premium rate. This did not match how providers actually bill.

### After (correct)

Once the **total input context** of a request exceeds the long-context threshold (200K or 272K), the provider bills **all tokens in that request** at the long-context rate — not just the portion above the threshold.

```typescript
// Total input context = input_tokens + cache_creation_tokens + cache_read_tokens
const longContextThresholdExceeded =
  getRequestInputContextTokens(usage, cache5mTokens, cache1hTokens)
    > longContextThreshold;

// When exceeded: entire request uses long-context rate
if (longContextThresholdExceeded && inputAboveThreshold != null) {
  inputBucket = inputBucket.add(
    multiplyCost(usage.input_tokens, inputAboveThreshold)
  );
}
```

### Impact

This fix affects cost calculations for:

- **Input tokens**: All input tokens billed at the above-threshold rate
- **Output tokens**: All output tokens billed at the above-threshold rate
- **Cache creation (5min and 1hr)**: Billed at the above-threshold cache creation rate
- **Cache reads**: Billed at the above-threshold cache read rate

The fix only applies when explicit above-threshold price fields exist in the price data. Models without `*_above_200k_tokens` or `*_above_272k_tokens` fields continue using the standard per-token price across the full window.

---

## Multi-source pricing comparison (v0.6.2+)

The **ProviderPricingDialog** component lets administrators compare pricing from different providers for the same model and select which one to use.

### How it works

Cloud-synced price records include a `pricing` map that contains per-provider pricing entries. For example, a model like `gpt-4o` may have pricing entries from `openai`, `openrouter`, `chatgpt`, and others, each with different rates.

The dialog displays:

- **Provider key** as a badge (e.g. `openai`, `openrouter`)
- **Input price** per million tokens
- **Output price** per million tokens
- **Cache read price** per million tokens
- **Priority tier prices** (shown in orange when available)
- A **"Pinned"** badge on the currently selected provider

### Opening the dialog

Click the **Compare Pricing** button (with the swap icon) on any model row in the price list. The button only appears for models that have multiple provider entries in their `pricing` map.

### Pin action

Each provider entry has a **Pin** button. Clicking it converts the selected provider's pricing into a manual price record, making it the active pricing for that model. See the [Price pinning](#price-pinning-v062) section below for details.

---

## Price pinning (v0.6.2+)

Price pinning allows administrators to lock a specific provider's pricing as the active price for a model, overriding the automatic resolution chain.

### How pinning works

When you click **Pin** on a provider entry in the comparison dialog, the system calls `pinModelPricingProviderAsManual`, which:

1. Fetches the latest cloud (`litellm`) price record for the model
2. Extracts the selected provider's pricing node from the `pricing` map
3. Merges the provider-specific fields onto the base price data
4. Saves the result as a new `manual` source record with special metadata:

```typescript
{
  ...basePriceData,
  ...pricingNode,          // Provider-specific rates overwrite base rates
  pricing: undefined,       // Remove the multi-provider map
  litellm_provider: pricingProviderKey,
  selected_pricing_provider: pricingProviderKey,
  selected_pricing_source_model: modelName,
  selected_pricing_resolution: "manual_pin",
}
```

### Effect

- The pinned price becomes a `manual` source record, so it takes **Level 1** priority in the resolution chain
- Future cloud syncs will **not** overwrite it (manual prices are protected by default)
- The `selected_pricing_resolution: "manual_pin"` field distinguishes auto-pinned records from user-edited manual prices
- To unpin, delete the manual record from the price list; the system will fall back to automatic resolution

### Related fields

| Field | Purpose |
|-------|---------|
| `selected_pricing_provider` | The provider key that was pinned (e.g. `"openrouter"`) |
| `selected_pricing_source_model` | The model name the pricing was extracted from |
| `selected_pricing_resolution` | Set to `"manual_pin"` for pinned records |

## Related documentation

- [Provider management](/docs/provider-management) — Configure providers and their settings
- [Rate limiting](/docs/rate-limiting) — Understand spending limits and quotas
- [Session management](/docs/session-management) — Track usage and costs per session
