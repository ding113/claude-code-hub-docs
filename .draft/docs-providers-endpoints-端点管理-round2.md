# Provider Endpoints - Round 2 Verified Draft

## Intent Analysis

Provider endpoints in Claude Code Hub represent the actual upstream API URLs that the system uses to route requests. Unlike providers (which contain API keys and configuration), endpoints are shared URL resources that multiple providers can reference. The endpoint management system provides:

1. **Centralized URL Management**: Define API endpoints once and reuse them across multiple provider configurations
2. **Health Monitoring**: Automatic probing and circuit breaker patterns to detect and isolate unhealthy endpoints
3. **Load Distribution**: Priority-based endpoint selection with latency-aware routing
4. **Failover Support**: Multiple endpoints per vendor/type with automatic fallback

The endpoint system is particularly valuable when you have multiple API keys from the same vendor - you define the endpoint URL once, then reference it from multiple provider configurations.

---

## Behavior Summary

### Core Concepts

**Endpoint Hierarchy**:
- **Vendor** (`provider_vendors` table): Aggregated by website domain (e.g., "anthropic.com")
- **Endpoint** (`provider_endpoints` table): A specific URL for a provider type under a vendor
- **Provider** (`providers` table): An API key configuration that references a vendor

**Provider Types**:
Endpoints are categorized by provider type, supporting:
- `claude`: Standard Anthropic API
- `claude-auth`: Claude authentication service
- `codex`: OpenAI Codex/Responses API
- `gemini`: Google Gemini API
- `gemini-cli`: Gemini CLI format
- `openai-compatible`: Generic OpenAI-compatible endpoints

**Key Behaviors**:
1. **Soft Delete**: Endpoints use soft deletion (`deleted_at` timestamp) for audit trails
2. **Unique Constraints**: Each vendor+type+URL combination must be unique
3. **Automatic Vendor Creation**: When creating providers, vendors are auto-created based on URL domain
4. **Cascade Delete**: Deleting a vendor cascades to its endpoints

### Endpoint Selection Flow

When routing a request, the system:

1. Identifies the target vendor and provider type
2. Queries all enabled, non-deleted endpoints for that vendor+type
3. Filters out endpoints with open circuit breakers
4. Ranks remaining endpoints by:
   - Probe health status (healthy > unknown > unhealthy)
   - Sort order (lower values first)
   - Latency (faster endpoints preferred)
   - ID (stable tiebreaker)
5. Selects the best endpoint for the request

---

## Configuration

### Database Schema

**provider_endpoints table** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` lines 299-342):

```typescript
// Provider Endpoints table - 供应商(官网域名) + 类型 维度的端点池
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

  // Last probe snapshot
  lastProbedAt: timestamp('last_probed_at', { withTimezone: true }),
  lastProbeOk: boolean('last_probe_ok'),
  lastProbeStatusCode: integer('last_probe_status_code'),
  lastProbeLatencyMs: integer('last_probe_latency_ms'),
  lastProbeErrorType: varchar('last_probe_error_type', { length: 64 }),
  lastProbeErrorMessage: text('last_probe_error_message'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // Unique constraint: one URL per vendor+type
  providerEndpointsUnique: uniqueIndex('uniq_provider_endpoints_vendor_type_url').on(
    table.vendorId,
    table.providerType,
    table.url
  ),
  // Query optimization indexes
  providerEndpointsVendorTypeIdx: index('idx_provider_endpoints_vendor_type').on(
    table.vendorId,
    table.providerType
  ).where(sql`${table.deletedAt} IS NULL`),
  providerEndpointsEnabledIdx: index('idx_provider_endpoints_enabled').on(
    table.isEnabled,
    table.vendorId,
    table.providerType
  ).where(sql`${table.deletedAt} IS NULL`),
  providerEndpointsCreatedAtIdx: index('idx_provider_endpoints_created_at').on(table.createdAt),
  providerEndpointsDeletedAtIdx: index('idx_provider_endpoints_deleted_at').on(table.deletedAt),
}));
```

**providerEndpointProbeLogs table** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` lines 344-366):

```typescript
// Provider Endpoint Probe Logs table - 端点测活历史
export const providerEndpointProbeLogs = pgTable('provider_endpoint_probe_logs', {
  id: serial('id').primaryKey(),
  endpointId: integer('endpoint_id')
    .notNull()
    .references(() => providerEndpoints.id, { onDelete: 'cascade' }),
  source: varchar('source', { length: 20 })
    .notNull()
    .default('scheduled')
    .$type<'scheduled' | 'manual' | 'runtime'>(),
  ok: boolean('ok').notNull(),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms'),
  errorType: varchar('error_type', { length: 64 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  providerEndpointProbeLogsEndpointCreatedAtIdx: index('idx_provider_endpoint_probe_logs_endpoint_created_at').on(
    table.endpointId,
    table.createdAt.desc()
  ),
  providerEndpointProbeLogsCreatedAtIdx: index('idx_provider_endpoint_probe_logs_created_at').on(table.createdAt),
}));
```

**ProviderEndpoint TypeScript Interface** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts` lines 387-404):

```typescript
export interface ProviderEndpoint {
  id: number;
  vendorId: number;
  providerType: ProviderType;
  url: string;
  label: string | null;
  sortOrder: number;
  isEnabled: boolean;
  lastProbedAt: Date | null;
  lastProbeOk: boolean | null;
  lastProbeStatusCode: number | null;
  lastProbeLatencyMs: number | null;
  lastProbeErrorType: string | null;
  lastProbeErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
```

**ProviderEndpointProbeLog TypeScript Interface** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts` lines 406-416):

```typescript
export interface ProviderEndpointProbeLog {
  id: number;
  endpointId: number;
  source: ProviderEndpointProbeSource;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  createdAt: Date;
}
```

**ProviderEndpointProbeSource Type** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts` line 385):

```typescript
export type ProviderEndpointProbeSource = "scheduled" | "manual" | "runtime";
```

**ProviderType Type** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts` lines 6-12):

```typescript
export type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini"
  | "gemini-cli"
  | "openai-compatible";
```

**ProviderVendor Interface** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts` lines 375-383):

```typescript
export interface ProviderVendor {
  id: number;
  websiteDomain: string;
  displayName: string | null;
  websiteUrl: string | null;
  faviconUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key, auto-incrementing |
| `vendorId` | integer | Foreign key to `provider_vendors.id`, cascades on delete |
| `providerType` | varchar | One of: claude, claude-auth, codex, gemini, gemini-cli, openai-compatible |
| `url` | text | The actual endpoint URL (e.g., "https://api.anthropic.com/v1") |
| `label` | varchar | Optional display label for the endpoint |
| `sortOrder` | integer | Priority for endpoint selection (lower = higher priority) |
| `isEnabled` | boolean | Whether the endpoint is active and selectable |
| `lastProbedAt` | timestamp | When the endpoint was last health-checked |
| `lastProbeOk` | boolean | Result of last probe (true=healthy, false=unhealthy, null=never probed) |
| `lastProbeStatusCode` | integer | HTTP status code from last probe |
| `lastProbeLatencyMs` | integer | Response time in milliseconds from last probe |
| `lastProbeErrorType` | varchar | Categorized error type (timeout, network_error, etc.) |
| `lastProbeErrorMessage` | text | Detailed error message from last probe |

---

## CRUD Operations

### Create Endpoint

**Action**: `addProviderEndpoint` (`/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` lines 213-250)

```typescript
export async function addProviderEndpoint(
  input: unknown
): Promise<ActionResult<{ endpoint: ProviderEndpoint }>>
```

**Validation Schema** (`/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` lines 60-67):
```typescript
const CreateProviderEndpointSchema = z.object({
  vendorId: VendorIdSchema,
  providerType: ProviderTypeSchema,
  url: z.string().trim().url(ERROR_CODES.INVALID_URL),
  label: z.string().trim().max(200).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isEnabled: z.boolean().optional(),
});
```

**Repository Function**: `createProviderEndpoint` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 675-715)

```typescript
export async function createProviderEndpoint(payload: {
  vendorId: number;
  providerType: ProviderType;
  url: string;
  label?: string | null;
  sortOrder?: number;
  isEnabled?: boolean;
}): Promise<ProviderEndpoint>
```

**Behavior**:
- Requires admin session
- URL must be valid format
- Vendor+Type+URL combination must be unique (enforced at DB level)
- Defaults: `sortOrder=0`, `isEnabled=true`, `label=null`

### Read Endpoints

**List by Vendor and Type**: `getProviderEndpoints` (`/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` lines 161-187)

```typescript
export async function getProviderEndpoints(input: {
  vendorId: number;
  providerType: ProviderType;
}): Promise<ProviderEndpoint[]>
```

**List by Vendor Only**: `getProviderEndpointsByVendor` (`/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` lines 189-211)

```typescript
export async function getProviderEndpointsByVendor(input: {
  vendorId: number;
}): Promise<ProviderEndpoint[]>
```

**Repository Query by Vendor and Type**: `findProviderEndpointsByVendorAndType` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 612-646)

```typescript
export async function findProviderEndpointsByVendorAndType(
  vendorId: number,
  providerType: ProviderType
): Promise<ProviderEndpoint[]>
```

**Repository Query by Vendor Only**: `findProviderEndpointsByVendor` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 648-673)

```typescript
export async function findProviderEndpointsByVendor(
  vendorId: number
): Promise<ProviderEndpoint[]>
```

**Find by ID**: `findProviderEndpointById` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 477-510)

```typescript
export async function findProviderEndpointById(
  endpointId: number
): Promise<ProviderEndpoint | null>
```

Results are ordered by `sortOrder ASC, id ASC`.

### Update Endpoint

**Action**: `editProviderEndpoint` (`/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` lines 252-295)

```typescript
export async function editProviderEndpoint(
  input: unknown
): Promise<ActionResult<{ endpoint: ProviderEndpoint }>>
```

**Validation Schema** (`/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` lines 69-87):
```typescript
const UpdateProviderEndpointSchema = z
  .object({
    endpointId: EndpointIdSchema,
    url: z.string().trim().url(ERROR_CODES.INVALID_URL).optional(),
    label: z.string().trim().max(200).optional().nullable(),
    sortOrder: z.number().int().min(0).optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.url !== undefined ||
      value.label !== undefined ||
      value.sortOrder !== undefined ||
      value.isEnabled !== undefined,
    { message: ERROR_CODES.EMPTY_UPDATE, path: ["endpointId"] }
  );
```

**Repository Function**: `updateProviderEndpoint` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 837-899)

```typescript
export async function updateProviderEndpoint(
  endpointId: number,
  payload: {
    url?: string;
    label?: string | null;
    sortOrder?: number;
    isEnabled?: boolean;
  }
): Promise<ProviderEndpoint | null>
```

**Behavior**:
- At least one field must be provided for update
- Returns null if endpoint not found or already soft-deleted
- Updates `updatedAt` timestamp automatically

### Delete Endpoint

**Action**: `removeProviderEndpoint` (`/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` lines 297-344)

```typescript
export async function removeProviderEndpoint(input: unknown): Promise<ActionResult>
```

**Repository Function**: `softDeleteProviderEndpoint` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 901-914)

```typescript
export async function softDeleteProviderEndpoint(endpointId: number): Promise<boolean>
```

**Behavior**:
- Soft delete only (sets `deletedAt` and `isEnabled=false`)
- Auto-cleanup: attempts to delete vendor if it has no active providers or endpoints
- Returns true if endpoint was found and deleted

---

## Health Checks and Probing

### Probe Mechanism

**Probe Function**: `probeEndpointUrl` (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts` lines 121-130)

```typescript
export async function probeEndpointUrl(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<EndpointProbeResult>
```

**Probe Method**:
1. First attempts a `HEAD` request to the endpoint URL
2. If HEAD fails with no status code (network error), falls back to `GET`
3. Returns success if status code < 500

**Default Timeout**: 5 seconds (configurable via `ENDPOINT_PROBE_TIMEOUT_MS` env var)

**Probe Result Structure** (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts` lines 10-17):
```typescript
export interface EndpointProbeResult {
  ok: boolean;
  method: EndpointProbeMethod;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
}
```

### Recording Probe Results

**Function**: `probeProviderEndpointAndRecord` (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts` lines 166-181)

```typescript
export async function probeProviderEndpointAndRecord(input: {
  endpointId: number;
  source: ProviderEndpointProbeSource;
  timeoutMs?: number;
}): Promise<EndpointProbeResult | null>
```

**Behavior**:
1. Executes probe against endpoint URL
2. Records failure to circuit breaker if probe fails
3. Saves result to `provider_endpoint_probe_logs` table
4. Updates endpoint's `lastProbe*` snapshot fields

**Probe Sources**:
- `scheduled`: Automated periodic health checks
- `manual`: User-initiated probe from UI
- `runtime`: Probe triggered during request routing

**Additional Probe Functions**:

**Find Endpoints for Probing**: `findEnabledProviderEndpointsForProbing` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 182-206)

```typescript
export async function findEnabledProviderEndpointsForProbing(): Promise<ProviderEndpointProbeTarget[]>
```

**Update Probe Snapshot**: `updateProviderEndpointProbeSnapshot` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 208-231)

```typescript
export async function updateProviderEndpointProbeSnapshot(input: {
  endpointId: number;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
}): Promise<void>
```

**Record Probe Result**: `recordProviderEndpointProbeResult` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 916-953)

```typescript
export async function recordProviderEndpointProbeResult(input: {
  endpointId: number;
  source: ProviderEndpointProbeSource;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
}): Promise<void>
```

### Probe Logs

**Query Logs**: `findProviderEndpointProbeLogs` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 955-979)

```typescript
export async function findProviderEndpointProbeLogs(
  endpointId: number,
  limit: number = 200,
  offset: number = 0
): Promise<ProviderEndpointProbeLog[]>
```

Returns logs ordered by `createdAt DESC` with pagination support.

**Cleanup Old Logs**: `deleteProviderEndpointProbeLogsBeforeDateBatch` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 233-253)

```typescript
export async function deleteProviderEndpointProbeLogsBeforeDateBatch(input: {
  beforeDate: Date;
  batchSize: number;
}): Promise<number>
```

---

## Circuit Breaker

### Endpoint-Level Circuit Breaker

**Purpose**: Protects individual endpoints from repeated failed requests.

**Configuration** (`/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts` lines 18-22):

```typescript
export const DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG: EndpointCircuitBreakerConfig = {
  failureThreshold: 3,        // Open after 3 failures
  openDuration: 300000,       // Stay open for 5 minutes (ms)
  halfOpenSuccessThreshold: 1, // Close after 1 success in half-open state
};
```

**States**:
- `closed`: Normal operation, requests allowed
- `open`: Circuit tripped, requests blocked
- `half-open`: Testing if endpoint recovered

**State Transitions**:
1. **Closed → Open**: When `failureCount >= failureThreshold`
2. **Open → Half-Open**: When `currentTime > circuitOpenUntil`
3. **Half-Open → Closed**: When `halfOpenSuccessCount >= halfOpenSuccessThreshold`
4. **Any → Closed**: Manual reset via `resetEndpointCircuit`

**Key Functions** (`/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts`):

```typescript
// Check if circuit is open (blocks requests)
isEndpointCircuitOpen(endpointId: number): Promise<boolean>           // Line 116

// Record a failure (may trip circuit)
recordEndpointFailure(endpointId: number, error: Error): Promise<void> // Line 137

// Record a success (may close circuit)
recordEndpointSuccess(endpointId: number): Promise<void>              // Line 160

// Get health info for display
getEndpointHealthInfo(endpointId: number): Promise<{ health: EndpointHealth; config: EndpointCircuitBreakerConfig }>  // Line 109

// Manual reset
resetEndpointCircuit(endpointId: number): Promise<void>                // Line 187
```

**Redis Persistence**: Circuit state is stored in Redis with 24-hour TTL (`/Users/ding/Github/claude-code-hub/src/lib/redis/endpoint-circuit-breaker-state.ts` lines 26-28):
- Key format: `endpoint_circuit_breaker:state:${endpointId}`
- Ensures circuit state survives app restarts
- Falls back to in-memory map if Redis unavailable

### Vendor-Type-Level Circuit Breaker

**Purpose**: Temporarily disables ALL endpoints for a vendor+type combination when all endpoints are failing.

**Configuration** (`/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts` line 21):

```typescript
const AUTO_OPEN_DURATION_MS = 60000; // 1 minute
```

**Behavior**:
- Automatically opens when all endpoints for a vendor+type timeout
- Can be manually opened/closed by administrators
- Prevents wasted requests to completely unavailable vendor+type combinations

**Key Functions** (`/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts`):

```typescript
// Check if vendor+type circuit is open
isVendorTypeCircuitOpen(vendorId: number, providerType: ProviderType): Promise<boolean>                    // Line 115

// Record that all endpoints timed out
recordVendorTypeAllEndpointsTimeout(vendorId: number, providerType: ProviderType, openDurationMs?: number): Promise<void>  // Line 139

// Manual control
setVendorTypeCircuitManualOpen(vendorId: number, providerType: ProviderType, manualOpen: boolean): Promise<void>  // Line 157

// Reset circuit
resetVendorTypeCircuit(vendorId: number, providerType: ProviderType): Promise<void>                        // Line 179
```

**Redis Persistence** (`/Users/ding/Github/claude-code-hub/src/lib/redis/vendor-type-circuit-breaker-state.ts` lines 25-27):
- Key format: `vendor_type_circuit_breaker:state:${vendorId}:${providerType}`

---

## Endpoint Selection and Priority

### Ranking Algorithm

**Function**: `rankProviderEndpoints` (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts` lines 7-28)

```typescript
export function rankProviderEndpoints(endpoints: ProviderEndpoint[]): ProviderEndpoint[]
```

**Priority Ranking** (lower number = higher priority):
1. `0`: `lastProbeOk === true` (healthy)
2. `1`: `lastProbeOk === null` (never probed)
3. `2`: `lastProbeOk === false` (unhealthy)

**Secondary Sort Criteria** (applied within each priority group):
1. `sortOrder` ascending (explicit priority)
2. `lastProbeLatencyMs` ascending (fastest first, nulls treated as infinity)
3. `id` ascending (stable tiebreaker)

### Selection with Circuit Breaker Filtering

**Function**: `getPreferredProviderEndpoints` (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts` lines 30-54)

```typescript
export async function getPreferredProviderEndpoints(input: {
  vendorId: number;
  providerType: ProviderType;
  excludeEndpointIds?: number[];
}): Promise<ProviderEndpoint[]>
```

**Behavior**:
1. Queries all enabled, non-deleted endpoints for vendor+type
2. Excludes any endpoint IDs in `excludeEndpointIds` (used for retry scenarios)
3. Checks circuit breaker state for each endpoint
4. Filters out endpoints with open circuits
5. Ranks remaining endpoints using `rankProviderEndpoints`

**Function**: `pickBestProviderEndpoint` (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts` lines 56-63)

```typescript
export async function pickBestProviderEndpoint(input: {
  vendorId: number;
  providerType: ProviderType;
  excludeEndpointIds?: number[];
}): Promise<ProviderEndpoint | null>
```

Returns the highest-ranked endpoint or null if none available.

---

## Vendor Management

### Vendor Creation and Lookup

**Get or Create Vendor from URLs**: `getOrCreateProviderVendorIdFromUrls` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 255-309)

```typescript
export async function getOrCreateProviderVendorIdFromUrls(input: {
  providerUrl: string;
  websiteUrl?: string | null;
}): Promise<number>
```

Computes vendor key from URLs and returns existing vendor ID or creates new vendor.

**Compute Vendor Key**: `computeVendorKey` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 112-125)

```typescript
export async function computeVendorKey(input: {
  providerUrl: string;
  websiteUrl?: string | null;
}): Promise<string | null>
```

Normalizes URL to extract vendor key (hostname-based).

### Vendor CRUD Operations

**List Vendors**: `findProviderVendors` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 437-457)

```typescript
export async function findProviderVendors(
  limit?: number,
  offset?: number
): Promise<ProviderVendor[]>
```

**Find by ID**: `findProviderVendorById` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 459-475)

```typescript
export async function findProviderVendorById(
  vendorId: number
): Promise<ProviderVendor | null>
```

**Update Vendor**: `updateProviderVendor` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 506-539)

```typescript
export async function updateProviderVendor(
  vendorId: number,
  payload: {
    displayName?: string;
    websiteUrl?: string | null;
    faviconUrl?: string | null;
  }
): Promise<ProviderVendor | null>
```

**Delete Vendor**: `deleteProviderVendor` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 541-557)

```typescript
export async function deleteProviderVendor(vendorId: number): Promise<boolean>
```

**Conditional Delete**: `tryDeleteProviderVendorIfEmpty` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 559-610)

```typescript
export async function tryDeleteProviderVendorIfEmpty(vendorId: number): Promise<boolean>
```

Deletes vendor only if it has no active providers or endpoints.

### Backfill Operations

**Backfill Vendors from Providers**: `backfillProviderVendorsFromProviders` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 337-435)

```typescript
export async function backfillProviderVendorsFromProviders(): Promise<{
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
}>
```

**Backfill Endpoints from Providers**: `backfillProviderEndpointsFromProviders` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 753-835)

```typescript
export async function backfillProviderEndpointsFromProviders(): Promise<{
  inserted: number;
  uniqueCandidates: number;
  skippedInvalid: number;
}>
```

---

## UI Components

### Endpoint Management UI

**Main Component**: `ProviderVendorView` (`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-vendor-view.tsx`)

Displays endpoints grouped by vendor with:
- Endpoint list table with type icons
- Enable/disable toggle
- Latency sparkline (recent probe history)
- Manual probe button
- Edit/delete actions

**Add Endpoint Button** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-vendor-view.tsx` lines 532-656):

Component name: `AddEndpointButton`

Form fields:
- Provider Type selector (excludes internal types: claude-auth, gemini-cli)
- URL input with live preview
- Submit creates endpoint with `sortOrder=0`, `isEnabled=true`

**Edit Endpoint Dialog** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-vendor-view.tsx` lines 658-726):

Component name: `EditEndpointDialog`

Form fields:
- URL (editable)
- Enabled toggle

### Dashboard Probe Terminal

**Component**: `EndpointTab` (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/endpoint-tab.tsx`)

Features:
- Vendor selector dropdown (lines 199-217)
- Provider type selector (lines 220-238)
- Probe grid showing all endpoints with status (lines 255-278)
- Latency curve chart (lines 281-296)
- Terminal-style probe log viewer
- Auto-refresh every 10 seconds

**Probe Grid** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/probe-grid.tsx`):

Displays endpoints as cards with:
- Status icon (healthy/unhealthy/unknown) - lines 17-43, 107
- Hostname or label - line 109
- Full URL - line 112
- Last latency (color-coded: <200ms green, <500ms amber, >500ms red) - lines 114-127
- Last probe time - lines 131-136
- HTTP status code badge - lines 139-152

**Probe Terminal** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/probe-terminal.tsx`):

Terminal-style log viewer with:
- Live indicator (red pulsing dot) - lines 159-162
- Timestamp, status, status code, latency columns - lines 206-207
- Source badge (manual/auto) - lines 242-251
- Error message display
- Download logs button - lines 165-173
- Filter input
- Auto-scroll to newest entries

---

## Edge Cases

### Duplicate Endpoint URLs

**Constraint**: Database enforces unique `(vendorId, providerType, url)` combination.

**Behavior**: Attempting to create a duplicate returns an error. Use `ensureProviderEndpointExistsForUrl` (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 717-751) for idempotent creation:

```typescript
export async function ensureProviderEndpointExistsForUrl(input: {
  vendorId: number;
  providerType: ProviderType;
  url: string;
  label?: string | null;
}): Promise<boolean>
```

Returns `true` if a new endpoint was created, `false` if it already exists or URL is invalid.

### Invalid URLs

**Validation**: URL format validated using Zod `.url()` schema.

**Normalization**: The `computeVendorKey` function (`/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` lines 112-125) handles various URL formats:
- Strips `www.` prefix
- Handles IPv6 addresses with port notation
- Defaults to HTTPS if no scheme provided
- Extracts hostname for vendor grouping

**Helper Functions** in repository:
- `normalizeWebsiteDomainFromUrl` (lines 31-61): Normalizes URL to hostname
- `normalizeHostWithPort` (lines 63-110): Normalizes URL to host:port format

### Orphaned Endpoints

**Scenario**: When a provider's vendor is deleted, endpoints are cascade-deleted.

**Soft Delete Handling**: Soft-deleted endpoints are excluded from all queries via `deletedAt IS NULL` conditions.

### Circuit Breaker Edge Cases

**Redis Unavailable**: Circuit breaker falls back to in-memory Map. State won't persist across restarts but functionality continues.

**Clock Skew**: Circuit open/close decisions use `Date.now()` comparisons. Significant clock skew between instances could cause inconsistent behavior.

**Rapid Failures**: If failures occur faster than the async state persistence, some failure counts may be lost. The in-memory map is the source of truth until persisted.

### Probe Edge Cases

**Timeout Handling**: Probe uses `AbortController` with configurable timeout. Timeout errors are categorized as `errorType: "timeout"`.

**Redirect Handling**: Probe uses `redirect: "manual"` - it does not follow redirects. A 3xx response is considered successful (status < 500).

**Credential Leak Prevention**: `safeUrlForLog` function strips credentials and query strings from URLs in logs (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts` lines 29-36):

```typescript
function safeUrlForLog(rawUrl: string): string {
  try {
    // Avoid leaking credentials/querystring in logs.
    return new URL(rawUrl).origin; // Only log origin
  } catch {
    return "<invalid-url>";
  }
}
```

### All Endpoints Unhealthy

**Behavior**: When all endpoints for a vendor+type are unhealthy or have open circuits:
1. `getPreferredProviderEndpoints` returns empty array
2. Caller must handle "no available endpoints" scenario
3. Vendor-type circuit breaker may activate if all endpoints timeout

### Endpoint Sort Order Conflicts

**Resolution**: When multiple endpoints have the same `sortOrder`, latency is used as tiebreaker, then ID. This ensures stable, deterministic selection.

---

## References

### Key Files

**Repository Layer**:
- `/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` - Database operations for endpoints and vendors

**Action Layer**:
- `/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` - Server actions for endpoint CRUD and probing

**Business Logic**:
- `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts` - Endpoint probing implementation
- `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts` - Endpoint ranking and selection
- `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts` - Per-endpoint circuit breaker
- `/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts` - Per-vendor-type circuit breaker

**Redis State**:
- `/Users/ding/Github/claude-code-hub/src/lib/redis/endpoint-circuit-breaker-state.ts` - Circuit breaker Redis persistence
- `/Users/ding/Github/claude-code-hub/src/lib/redis/vendor-type-circuit-breaker-state.ts` - Vendor-type circuit Redis persistence

**UI Components**:
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-vendor-view.tsx` - Endpoint management UI
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/endpoint-tab.tsx` - Dashboard probe terminal
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/probe-grid.tsx` - Endpoint status grid
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/probe-terminal.tsx` - Log terminal view

**Database Schema**:
- `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` - Table definitions for provider_endpoints, providerEndpointProbeLogs

**Types**:
- `/Users/ding/Github/claude-code-hub/src/types/provider.ts` - TypeScript interfaces for ProviderEndpoint, ProviderEndpointProbeLog, ProviderVendor, ProviderType

### Related Documentation

- Provider configuration documentation (for understanding the relationship between providers and endpoints)
- Circuit breaker pattern documentation
- Database migration files for endpoint-related schema changes
