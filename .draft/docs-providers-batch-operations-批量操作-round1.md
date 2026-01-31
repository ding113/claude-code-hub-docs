# Provider Batch Operations (供应商批量操作) - Round 1 Exploration Draft

## Intent Analysis (设计意图)

The provider batch operations feature in claude-code-hub is designed to enable administrators to efficiently manage multiple AI service providers simultaneously. The primary intent is to reduce operational overhead when performing common administrative tasks across large numbers of providers.

### Core Design Goals

1. **Operational Efficiency**: Administrators often need to perform the same operation on multiple providers (e.g., disabling all providers from a specific vendor during maintenance, updating priority for a group of providers). Batch operations eliminate the need to edit providers one by one.

2. **Consistency**: Batch updates ensure that the same configuration values are applied uniformly across selected providers, reducing human error.

3. **Safety**: The two-step confirmation flow (selection → confirmation) prevents accidental bulk operations. Additionally, soft-delete is used instead of hard-delete to allow data recovery.

4. **Performance**: With a maximum batch size of 500 providers per operation, the system balances efficiency with database performance. Repository-level optimizations use efficient SQL batch updates rather than N+1 individual queries.

5. **Cross-Instance Consistency**: Redis Pub/Sub is used to broadcast cache invalidation across all application instances, ensuring that batch changes are immediately visible regardless of which instance serves the request.

### Target Users

- **System Administrators**: Primary users who manage the provider pool
- **Operations Teams**: Users who need to quickly respond to provider outages or maintenance windows

---

## Behavior Summary (行为概述)

### Available Batch Operations

The system supports three primary batch operations for providers:

1. **Batch Update** (`batchUpdateProviders`): Update common fields (is_enabled, priority, weight, cost_multiplier, group_tag) for multiple providers
2. **Batch Delete** (`batchDeleteProviders`): Soft-delete multiple providers
3. **Batch Circuit Reset** (`batchResetProviderCircuits`): Reset circuit breaker state for multiple providers

### Batch Size Limits

All batch operations enforce a maximum limit:
- **Maximum**: 500 providers per batch operation
- **Minimum**: 1 provider (empty arrays are rejected)

This limit is defined as a constant in `/Users/ding/Github/claude-code-hub/src/actions/providers.ts`:

```typescript
const BATCH_OPERATION_MAX_SIZE = 500;
```

### Permission Requirements

All batch operations require the user to have **admin role**. Non-admin users receive a permission error:

```typescript
if (!session || session.user.role !== "admin") {
  return { ok: false, error: "无权限执行此操作" };
}
```

### UI Workflow

The batch operations follow a consistent UI pattern:

1. **Enter Selection Mode**: User clicks "Batch Edit" button to enter multi-select mode
2. **Select Providers**: User selects providers via checkboxes (with select-all and invert options)
3. **Choose Action**: User selects an action from the floating action bar (Edit, Delete, Reset Circuit)
4. **Configure Operation**: For edits, user toggles which fields to update and sets values
5. **Confirm**: Two-step confirmation (dialog → alert) prevents accidents
6. **Execute**: Server action processes the batch operation
7. **Feedback**: Toast notifications show success/failure with affected count

---

## Implementation Details (实现细节)

### 1. Batch Update Operation

**File**: `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` (lines 1006-1071)

#### Interface Definition

```typescript
export interface BatchUpdateProvidersParams {
  providerIds: number[];
  updates: {
    is_enabled?: boolean;
    priority?: number;
    weight?: number;
    cost_multiplier?: number;
    group_tag?: string | null;
  };
}
```

#### Action Implementation

```typescript
export async function batchUpdateProviders(
  params: BatchUpdateProvidersParams
): Promise<ActionResult<{ updatedCount: number }>> {
  try {
    // 1. Permission check
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const { providerIds, updates } = params;

    // 2. Validation: non-empty providerIds
    if (!providerIds || providerIds.length === 0) {
      return { ok: false, error: "请选择要更新的供应商" };
    }

    // 3. Validation: max batch size
    if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
      return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
    }

    // 4. Validation: at least one update field
    const hasUpdates = Object.values(updates).some((v) => v !== undefined);
    if (!hasUpdates) {
      return { ok: false, error: "请指定要更新的字段" };
    }

    // 5. Map snake_case to camelCase for repository
    const { updateProvidersBatch } = await import("@/repository/provider");
    const repositoryUpdates: BatchProviderUpdates = {};
    
    if (updates.is_enabled !== undefined) repositoryUpdates.isEnabled = updates.is_enabled;
    if (updates.priority !== undefined) repositoryUpdates.priority = updates.priority;
    if (updates.weight !== undefined) repositoryUpdates.weight = updates.weight;
    if (updates.cost_multiplier !== undefined) {
      repositoryUpdates.costMultiplier = updates.cost_multiplier.toString();
    }
    if (updates.group_tag !== undefined) repositoryUpdates.groupTag = updates.group_tag;

    // 6. Execute batch update
    const updatedCount = await updateProvidersBatch(providerIds, repositoryUpdates);

    // 7. Invalidate cache across instances
    await broadcastProviderCacheInvalidation({
      operation: "edit",
      providerId: providerIds[0],
    });

    logger.info("batchUpdateProviders:completed", {
      requestedCount: providerIds.length,
      updatedCount,
      fields: Object.keys(updates).filter((k) => updates[k as keyof typeof updates] !== undefined),
    });

    return { ok: true, data: { updatedCount } };
  } catch (error) {
    logger.error("批量更新供应商失败:", error);
    const message = error instanceof Error ? error.message : "批量更新供应商失败";
    return { ok: false, error: message };
  }
}
```

#### Repository Implementation

**File**: `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` (lines 642-699)

```typescript
export interface BatchProviderUpdates {
  isEnabled?: boolean;
  priority?: number;
  weight?: number;
  costMultiplier?: string;
  groupTag?: string | null;
}

export async function updateProvidersBatch(
  ids: number[],
  updates: BatchProviderUpdates
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const setClauses: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.isEnabled !== undefined) {
    setClauses.isEnabled = updates.isEnabled;
  }
  if (updates.priority !== undefined) {
    setClauses.priority = updates.priority;
  }
  if (updates.weight !== undefined) {
    setClauses.weight = updates.weight;
  }
  if (updates.costMultiplier !== undefined) {
    setClauses.costMultiplier = updates.costMultiplier;
  }
  if (updates.groupTag !== undefined) {
    setClauses.groupTag = updates.groupTag;
  }

  // If only updatedAt is set, no actual updates
  if (Object.keys(setClauses).length === 1) {
    return 0;
  }

  const idList = sql.join(
    uniqueIds.map((id) => sql`${id}`),
    sql`, `
  );

  const result = await db
    .update(providers)
    .set(setClauses)
    .where(sql`id IN (${idList}) AND deleted_at IS NULL`)
    .returning({ id: providers.id });

  logger.debug("updateProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    updatedCount: result.length,
    fields: Object.keys(setClauses).filter((k) => k !== "updatedAt"),
  });

  return result.length;
}
```

**Key Implementation Notes**:
- Uses Drizzle ORM's query builder for type safety
- Constructs dynamic SQL IN clause using `sql.join()`
- Deduplicates IDs using `new Set()`
- Only updates non-deleted providers (`deleted_at IS NULL`)
- Returns the count of actually updated rows
- `costMultiplier` is stored as string in database for precision

---

### 2. Batch Delete Operation

**File**: `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` (lines 1073-1121)

#### Interface Definition

```typescript
export interface BatchDeleteProvidersParams {
  providerIds: number[];
}
```

#### Action Implementation

```typescript
export async function batchDeleteProviders(
  params: BatchDeleteProvidersParams
): Promise<ActionResult<{ deletedCount: number }>> {
  try {
    // 1. Permission check
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const { providerIds } = params;

    // 2. Validation: non-empty providerIds
    if (!providerIds || providerIds.length === 0) {
      return { ok: false, error: "请选择要删除的供应商" };
    }

    // 3. Validation: max batch size
    if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
      return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
    }

    const { deleteProvidersBatch } = await import("@/repository/provider");

    // 4. Execute soft delete
    const deletedCount = await deleteProvidersBatch(providerIds);

    // 5. Clear circuit breaker state for each deleted provider
    for (const id of providerIds) {
      clearProviderState(id);
      clearConfigCache(id);
    }

    // 6. Invalidate cache
    await broadcastProviderCacheInvalidation({
      operation: "remove",
      providerId: providerIds[0],
    });

    logger.info("batchDeleteProviders:completed", {
      requestedCount: providerIds.length,
      deletedCount,
    });

    return { ok: true, data: { deletedCount } };
  } catch (error) {
    logger.error("批量删除供应商失败:", error);
    const message = error instanceof Error ? error.message : "批量删除供应商失败";
    return { ok: false, error: message };
  }
}
```

#### Repository Implementation

**File**: `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` (lines 701-724)

```typescript
export async function deleteProvidersBatch(ids: number[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const idList = sql.join(
    uniqueIds.map((id) => sql`${id}`),
    sql`, `
  );

  const result = await db
    .update(providers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(sql`id IN (${idList}) AND deleted_at IS NULL`)
    .returning({ id: providers.id });

  logger.debug("deleteProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    deletedCount: result.length,
  });

  return result.length;
}
```

**Key Implementation Notes**:
- Uses **soft delete** (sets `deleted_at` timestamp) rather than hard delete
- Clears both circuit breaker state and config cache for each deleted provider
- This prevents memory leaks and ensures clean state removal

---

### 3. Batch Circuit Reset Operation

**File**: `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` (lines 1127-1164)

#### Interface Definition

```typescript
export interface BatchResetCircuitParams {
  providerIds: number[];
}
```

#### Action Implementation

```typescript
export async function batchResetProviderCircuits(
  params: BatchResetCircuitParams
): Promise<ActionResult<{ resetCount: number }>> {
  try {
    // 1. Permission check
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const { providerIds } = params;

    // 2. Validation: non-empty providerIds
    if (!providerIds || providerIds.length === 0) {
      return { ok: false, error: "请选择要重置的供应商" };
    }

    // 3. Validation: max batch size
    if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
      return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
    }

    let resetCount = 0;
    
    // 4. Reset each provider's circuit
    for (const id of providerIds) {
      resetCircuit(id);
      clearConfigCache(id);
      resetCount++;
    }

    logger.info("batchResetProviderCircuits:completed", {
      requestedCount: providerIds.length,
      resetCount,
    });

    return { ok: true, data: { resetCount } };
  } catch (error) {
    logger.error("批量重置熔断器失败:", error);
    const message = error instanceof Error ? error.message : "批量重置熔断器失败";
    return { ok: false, error: message };
  }
}
```

#### Circuit Reset Implementation

**File**: `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` (lines 538-561)

```typescript
export function resetCircuit(providerId: number): void {
  const health = getOrCreateHealthSync(providerId);
  const oldState = health.circuitState;

  // Reset all state fields
  health.circuitState = "closed";
  health.failureCount = 0;
  health.lastFailureTime = null;
  health.circuitOpenUntil = null;
  health.halfOpenSuccessCount = 0;

  logger.info(
    `[CircuitBreaker] Provider ${providerId} circuit manually reset from ${oldState} to closed`,
    { providerId, previousState: oldState, newState: "closed" }
  );

  // Persist state change to Redis asynchronously
  persistStateToRedis(providerId, health);
}
```

**Key Implementation Notes**:
- Resets circuit breaker from any state (open, half-open) back to `closed`
- Clears all failure counters and timestamps
- Persists the reset to Redis for multi-instance consistency
- Does NOT broadcast cache invalidation (circuit state is runtime-only, not cached)

---

## UI Components (UI组件)

### Component Architecture

The batch operations UI follows a hierarchical component structure:

```
ProviderManager (container)
├── ProviderBatchToolbar (enter/exit mode, select all, invert)
├── ProviderList
│   └── ProviderRichListItem (checkbox when in multi-select mode)
├── ProviderBatchActions (floating action bar - edit/delete/reset)
└── ProviderBatchDialog (edit form / delete confirm / reset confirm)
```

### ProviderBatchToolbar

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-toolbar.tsx`

Two display modes:
- **Normal mode**: Shows "Batch Edit" button to enter selection mode
- **Selection mode**: Shows checkbox (select all), selected count, invert button, edit button, exit button

```typescript
export interface ProviderBatchToolbarProps {
  isMultiSelectMode: boolean;
  allSelected: boolean;
  selectedCount: number;
  totalCount: number;
  onEnterMode: () => void;
  onExitMode: () => void;
  onSelectAll: (checked: boolean) => void;
  onInvertSelection: () => void;
  onOpenBatchEdit: () => void;
}
```

### ProviderBatchActions

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-actions.tsx`

A floating action bar that appears at the bottom when in multi-select mode with selections:

```typescript
export type BatchActionMode = "edit" | "delete" | "resetCircuit" | null;

export interface ProviderBatchActionsProps {
  selectedCount: number;
  isVisible: boolean;
  onAction: (mode: BatchActionMode) => void;
  onClose: () => void;
}
```

**UI Features**:
- Shows selected count
- Three action buttons: Edit, Reset Circuit, Delete (destructive)
- Exit button to close the bar

### ProviderBatchDialog

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-dialog.tsx`

Handles three modes with a two-step flow (dialog → confirmation):

```typescript
export interface ProviderBatchDialogProps {
  open: boolean;
  mode: BatchActionMode;
  onOpenChange: (open: boolean) => void;
  selectedProviderIds: Set<number>;
  onSuccess?: () => void;
}
```

**Edit Mode Fields** (each with an enable toggle):
- `isEnabled` (Switch): Enable/disable providers
- `priority` (number input): Provider priority (0+)
- `weight` (number input): Load balancing weight (1-100)
- `costMultiplier` (number input): Cost calculation multiplier
- `groupTag` (text input): Grouping label (max 50 chars)

**Field Toggle Pattern**:
```typescript
function FieldToggle({ label, enabled, onEnabledChange, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        <Label className={enabled ? "" : "text-muted-foreground"}>{label}</Label>
      </div>
      <div className={enabled ? "" : "opacity-50 pointer-events-none"}>{children}</div>
    </div>
  );
}
```

### ProviderManager Integration

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-manager.tsx`

The main container component orchestrates batch operations:

```typescript
const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
const [selectedProviderIds, setSelectedProviderIds] = useState<Set<number>>(new Set());
const [batchDialogOpen, setBatchDialogOpen] = useState(false);
const [batchActionMode, setBatchActionMode] = useState<BatchActionMode>(null);
```

**Selection Handlers**:
```typescript
const handleSelectAll = useCallback((checked: boolean) => {
  if (checked) {
    setSelectedProviderIds(new Set(filteredProviders.map((p) => p.id)));
  } else {
    setSelectedProviderIds(new Set());
  }
}, [filteredProviders]);

const handleInvertSelection = useCallback(() => {
  const currentIds = filteredProviders.map((p) => p.id);
  const inverted = new Set(currentIds.filter((id) => !selectedProviderIds.has(id)));
  setSelectedProviderIds(inverted);
}, [filteredProviders, selectedProviderIds]);

const handleSelectProvider = useCallback((providerId: number, checked: boolean) => {
  setSelectedProviderIds((prev) => {
    const next = new Set(prev);
    if (checked) next.add(providerId);
    else next.delete(providerId);
    return next;
  });
}, []);
```

---

## Cache Invalidation (缓存失效)

### broadcastProviderCacheInvalidation

**File**: `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` (lines 146-161)

```typescript
async function broadcastProviderCacheInvalidation(context: {
  operation: "add" | "edit" | "remove";
  providerId: number;
}): Promise<void> {
  try {
    await publishProviderCacheInvalidation();
    logger.debug(`${context.operation} Provider:cache_invalidation_success`, {
      providerId: context.providerId,
    });
  } catch (error) {
    logger.warn(`${context.operation} Provider:cache_invalidation_failed`, {
      providerId: context.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

### Redis Pub/Sub Mechanism

**File**: `/Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts`

```typescript
export const CHANNEL_PROVIDERS_UPDATED = "cch:cache:providers:updated";

export async function publishProviderCacheInvalidation(): Promise<void> {
  invalidateCache();  // Clear local cache first
  await publishCacheInvalidation(CHANNEL_PROVIDERS_UPDATED);
  logger.debug("[ProviderCache] Published cache invalidation");
}

async function ensureSubscription(): Promise<void> {
  await subscribeCacheInvalidation(CHANNEL_PROVIDERS_UPDATED, () => {
    invalidateCache();
    logger.debug("[ProviderCache] Cache invalidated via pub/sub");
  });
}
```

**Key Design Points**:
1. **Separate subscriber connection**: Pub/Sub requires a dedicated Redis connection
2. **Channel-based messaging**: Uses `cch:cache:providers:updated` channel
3. **Graceful degradation**: If Redis is unavailable, cache invalidation fails silently and relies on TTL expiration (30 seconds)
4. **Version tracking**: Cache uses version numbers to prevent race conditions

### Cache Invalidation Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Admin Action   │────▶│  Batch Operation │────▶│  Database Update │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Publish Redis   │
                    │  Pub/Sub Message │
                    └──────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Instance 1  │  │  Instance 2  │  │  Instance N  │
    └──────────────┘  └──────────────┘  └──────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Invalidate  │  │  Invalidate  │  │  Invalidate  │
    │  Local Cache │  │  Local Cache │  │  Local Cache │
    └──────────────┘  └──────────────┘  └──────────────┘
```

---

## Edge Cases (边界情况)

### 1. Empty Selection

**Behavior**: All batch operations reject empty providerIds array with specific error messages:
- Update: "请选择要更新的供应商"
- Delete: "请选择要删除的供应商"
- Reset Circuit: "请选择要重置的供应商"

### 2. Batch Size Exceeds Limit

**Behavior**: Operations with more than 500 providers are rejected:
```typescript
if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
  return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
}
```

### 3. No Updates Specified

**Behavior**: Batch update rejects when no fields are enabled:
```typescript
const hasUpdates = Object.values(updates).some((v) => v !== undefined);
if (!hasUpdates) {
  return { ok: false, error: "请指定要更新的字段" };
}
```

### 4. Duplicate IDs

**Behavior**: Repository layer deduplicates IDs:
```typescript
const uniqueIds = [...new Set(ids)];
```

### 5. Already Deleted Providers

**Behavior**: Batch operations only affect non-deleted providers:
```typescript
.where(sql`id IN (${idList}) AND deleted_at IS NULL`)
```

### 6. Partial Success

**Behavior**: The system returns the count of actually affected rows, which may be less than requested if some providers were already deleted or didn't exist.

### 7. Cache Invalidation Failure

**Behavior**: Cache invalidation failures are logged but don't fail the operation:
```typescript
try {
  await broadcastProviderCacheInvalidation({...});
} catch (error) {
  logger.warn("...cache_invalidation_failed", {...});
}
```

### 8. Circuit Reset During Active Requests

**Behavior**: Circuit reset is synchronous and immediate. Active requests to the provider will start fresh circuit breaker evaluation after the reset.

---

## Test Coverage (测试覆盖)

### Main Test File

**File**: `/Users/ding/Github/claude-code-hub/tests/unit/actions/providers-batch.test.ts`

**Test Coverage Summary** (44 test cases):

#### batchUpdateProviders (13 tests)
- Admin role requirement
- Empty providerIds rejection
- Max batch size enforcement (500)
- Multi-field updates
- Cache invalidation
- Cache error handling
- Partial updates with null group_tag
- Single field updates
- cost_multiplier type conversion
- Repository error handling
- Empty updates rejection

#### batchDeleteProviders (8 tests)
- Admin role requirement
- Empty providerIds rejection
- Max batch size enforcement
- Soft delete operation
- Circuit breaker state clearing
- Cache invalidation
- Cache error handling
- Repository error handling

#### batchResetProviderCircuits (9 tests)
- Admin role requirement
- Empty providerIds rejection
- Max batch size enforcement
- Circuit state reset
- Config cache clearing
- Single provider handling
- Large batch handling (500)
- Error handling during reset

#### Integration Tests (3 tests)
- Multiple operations in sequence
- Overlapping provider sets
- Operation isolation on errors

---

## References (参考文件)

### Core Implementation Files

| File | Description |
|------|-------------|
| `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` | Main batch operations (batchUpdateProviders, batchDeleteProviders, batchResetProviderCircuits) |
| `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` | Repository layer with SQL batch operations |
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` | Circuit breaker state management and reset |

### UI Component Files

| File | Description |
|------|-------------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-toolbar.tsx` | Batch mode toolbar |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-actions.tsx` | Floating action bar |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-dialog.tsx` | Batch operation dialog |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-manager.tsx` | Main container component |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-rich-list-item.tsx` | Provider item with checkbox |

### Cache and State Files

| File | Description |
|------|-------------|
| `/Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts` | Provider cache with Redis Pub/Sub |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/pubsub.ts` | Redis Pub/Sub implementation |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts` | Circuit breaker Redis persistence |

### Test Files

| File | Description |
|------|-------------|
| `/Users/ding/Github/claude-code-hub/tests/unit/actions/providers-batch.test.ts` | Main batch operations test suite |
| `/Users/ding/Github/claude-code-hub/tests/unit/repository/provider.test.ts` | Repository layer tests |

### Schema and Types

| File | Description |
|------|-------------|
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema with providers table |
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | Provider TypeScript types |

---

## Additional Batch Operation: Priority Sorting

### autoSortProviderPriority

**File**: `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` (lines 800-907)

In addition to the three main batch operations, the system provides an automatic priority sorting feature that batch-updates provider priorities based on their cost multipliers.

#### Interface Definition

```typescript
export async function autoSortProviderPriority(args: {
  strategy: "costMultiplier";
  confirm: boolean;
}): Promise<
  ActionResult<{
    groups: Array<{
      tag: string | null;
      providers: Array<{
        id: number;
        name: string;
        currentPriority: number;
        costMultiplier: number;
      }>;
    }>;
    changes: Array<{
      providerId: number;
      name: string;
      oldPriority: number;
      newPriority: number;
    }>;
    summary: {
      totalProviders: number;
      changedCount: number;
      unchangedCount: number;
    };
    applied: boolean;
  }>
>;
```

#### Behavior

1. **Groups providers by `group_tag`**: Providers are sorted within their groups
2. **Sorts by costMultiplier ascending**: Lower cost = higher priority (lower number)
3. **Preview mode** (`confirm: false`): Shows what changes would be made without applying
4. **Apply mode** (`confirm: true`): Executes the priority updates

#### Example

Given providers:
| Name | Group | Cost Multiplier | Current Priority |
|------|-------|-----------------|------------------|
| A | prod | 1.0 | 5 |
| B | prod | 1.5 | 3 |
| C | dev | 0.8 | 10 |

After auto-sort:
| Name | Group | New Priority |
|------|-------|--------------|
| A | prod | 1 |
| B | prod | 2 |
| C | dev | 1 |

#### Repository Implementation

**File**: `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` (lines 595-630)

```typescript
export async function updateProviderPrioritiesBatch(
  updates: Array<{ id: number; priority: number }>
): Promise<number> {
  if (updates.length === 0) {
    return 0;
  }

  // Deduplicate ids: last one wins
  const updateMap = new Map<number, number>();
  for (const update of updates) {
    updateMap.set(update.id, update.priority);
  }

  const ids = Array.from(updateMap.keys());
  const priorityCol = sql.identifier("priority");
  const updatedAtCol = sql.identifier("updated_at");
  const cases = ids.map((id) => sql`WHEN ${id} THEN ${updateMap.get(id)!}`);

  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );

  // Uses CASE statement for efficient single-query update
  const query = sql`
    UPDATE providers
    SET
      ${priorityCol} = CASE id ${sql.join(cases, sql` `)} ELSE ${priorityCol} END,
      ${updatedAtCol} = NOW()
    WHERE id IN (${idList}) AND deleted_at IS NULL
  `;

  const result = await db.execute(query);
  return (result as any).rowCount || 0;
}
```

**Key Implementation Notes**:
- Uses SQL CASE statement for efficient batch updates with different values per row
- Deduplicates IDs (last priority value wins if duplicates exist)
- Updates `updated_at` timestamp for all affected rows
- Only affects non-deleted providers

---

## Request/Response Examples

### Batch Update Request

```typescript
// Client-side call
const result = await batchUpdateProviders({
  providerIds: [1, 2, 3, 4, 5],
  updates: {
    is_enabled: false,
    priority: 10,
    group_tag: "maintenance"
  }
});
```

### Batch Update Response

```typescript
// Success response
{
  ok: true,
  data: {
    updatedCount: 5
  }
}

// Error response - permission denied
{
  ok: false,
  error: "无权限执行此操作"
}

// Error response - batch too large
{
  ok: false,
  error: "单次批量操作最多支持 500 个供应商"
}

// Error response - no fields specified
{
  ok: false,
  error: "请指定要更新的字段"
}
```

### Batch Delete Request

```typescript
const result = await batchDeleteProviders({
  providerIds: [10, 11, 12]
});
```

### Batch Delete Response

```typescript
// Success response
{
  ok: true,
  data: {
    deletedCount: 3
  }
}
```

### Batch Circuit Reset Request

```typescript
const result = await batchResetProviderCircuits({
  providerIds: [1, 2, 3]
});
```

### Batch Circuit Reset Response

```typescript
// Success response
{
  ok: true,
  data: {
    resetCount: 3
  }
}
```

---

## Security Considerations

### Permission Validation

All batch operations strictly enforce admin role requirements:

```typescript
const session = await getSession();
if (!session || session.user.role !== "admin") {
  return { ok: false, error: "无权限执行此操作" };
}
```

This check happens at the very beginning of each action, before any database operations.

### Input Validation

Multiple layers of validation protect against malicious input:

1. **Empty array check**: Prevents accidental "update all" scenarios
2. **Batch size limit**: Prevents resource exhaustion (500 max)
3. **Field validation**: Ensures at least one update field is specified
4. **Type safety**: TypeScript interfaces and Zod schemas validate data types

### Soft Delete vs Hard Delete

The batch delete operation uses soft delete (setting `deleted_at` timestamp) rather than hard delete. This provides:

- **Data recovery**: Deleted providers can be restored if needed
- **Audit trail**: Historical data is preserved
- **Referential integrity**: Foreign key relationships remain intact

---

## Performance Characteristics

### Time Complexity

| Operation | Time Complexity | Notes |
|-----------|-----------------|-------|
| Batch Update | O(n) | Single SQL UPDATE with IN clause |
| Batch Delete | O(n) | Single SQL UPDATE (soft delete) |
| Circuit Reset | O(n) | Iterates through providers synchronously |
| Priority Sort | O(n log n) | Sorting by cost multiplier |

### Database Query Patterns

**Batch Update** (1 query):
```sql
UPDATE providers
SET is_enabled = $1, priority = $2, updated_at = $3
WHERE id IN ($4, $5, $6, ...) AND deleted_at IS NULL
RETURNING id
```

**Batch Delete** (1 query):
```sql
UPDATE providers
SET deleted_at = NOW(), updated_at = NOW()
WHERE id IN ($1, $2, $3, ...) AND deleted_at IS NULL
RETURNING id
```

**Priority Sort with CASE** (1 query):
```sql
UPDATE providers
SET
  priority = CASE id
    WHEN 1 THEN 10
    WHEN 2 THEN 20
    WHEN 3 THEN 30
    ELSE priority
  END,
  updated_at = NOW()
WHERE id IN (1, 2, 3) AND deleted_at IS NULL
```

### Memory Usage

- **Batch Update**: Minimal - only stores ID list and update values
- **Batch Delete**: Minimal - only stores ID list
- **Circuit Reset**: O(n) for iterating through provider IDs
- **Cache Invalidation**: O(1) - single Pub/Sub message

---

## Error Handling Patterns

### Action Layer Error Handling

All batch actions follow a consistent error handling pattern:

```typescript
try {
  // Validation and execution
  const result = await repositoryFunction(params);
  
  // Cache invalidation (non-blocking)
  await broadcastProviderCacheInvalidation({...});
  
  return { ok: true, data: result };
} catch (error) {
  // Log full error details
  logger.error("Operation failed:", error);
  
  // Return user-friendly error message
  const message = error instanceof Error ? error.message : "Operation failed";
  return { ok: false, error: message };
}
```

### Repository Layer Error Handling

Repository functions let errors bubble up to the action layer:

```typescript
export async function updateProvidersBatch(ids: number[], updates: BatchProviderUpdates): Promise<number> {
  if (ids.length === 0) {
    return 0; // Early return for empty input
  }
  
  // Let database errors bubble up
  const result = await db.update(providers)...;
  
  return result.length;
}
```

### UI Error Handling

The UI handles errors by displaying toast notifications:

```typescript
const result = await batchUpdateProviders({ providerIds, updates });
if (result.ok) {
  toast.success(t("toast.updated", { count: result.data?.updatedCount ?? 0 }));
} else {
  toast.error(t("toast.failed", { error: result.error }));
}
```

---

## Summary

The provider batch operations feature provides a comprehensive solution for managing multiple AI service providers efficiently. Key characteristics include:

1. **Three Core Operations**: Update, Delete (soft), and Circuit Reset
2. **Additional Feature**: Auto-sort providers by cost multiplier within groups
3. **Safety First**: Two-step confirmation, admin-only access, 500-provider limit
4. **Performance**: Efficient SQL batch updates using CASE statements and IN clauses
5. **Cross-Instance Sync**: Redis Pub/Sub for cache invalidation across all instances
6. **Clean State Management**: Circuit breaker cleanup on delete, cache invalidation on update
7. **Comprehensive Testing**: 44+ test cases covering edge cases and error scenarios
8. **Soft Delete Pattern**: Data preservation with `deleted_at` timestamp
9. **Graceful Degradation**: Cache invalidation failures don't break operations
10. **Type Safety**: Full TypeScript coverage with Zod validation schemas
