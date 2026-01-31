# Round 1 Exploration Draft: Auto-Cleanup Functionality

## Intent Analysis

The auto-cleanup functionality in Claude Code Hub serves a critical purpose: managing data retention and preventing unbounded database growth. As an AI API proxy platform handling high volumes of requests, the system generates substantial log data (message_request records), probe logs (provider_endpoint_probe_logs), and temporary files. Without proper cleanup mechanisms, this data would accumulate indefinitely, leading to:

1. **Storage exhaustion**: Unbounded growth of PostgreSQL database storage
2. **Performance degradation**: Large tables slow down queries and increase backup times
3. **Cost inflation**: Cloud storage costs increase linearly with data volume
4. **Compliance risks**: Retaining logs beyond necessary periods may violate data privacy regulations

The auto-cleanup system addresses these concerns through multiple complementary mechanisms:
- **Scheduled log cleanup**: Automated deletion of old message_request records based on configurable retention policies
- **Endpoint probe log cleanup**: Automatic purging of provider endpoint health check logs
- **Temporary file cleanup**: Removal of stale database backup/restore temporary files
- **Cache cleanup**: Memory optimization for in-memory caches

## Behavior Summary

### 1. Message Request Log Cleanup (Primary Cleanup Mechanism)

The primary cleanup mechanism targets the `message_request` table, which stores detailed records of every API request processed by the system. This is implemented through a Bull queue-based scheduled job system.

**Key Components:**

#### 1.1 Cleanup Queue (`/Users/ding/Github/claude-code-hub/src/lib/log-cleanup/cleanup-queue.ts`)

The cleanup queue uses Bull (a Redis-backed queue system) for reliable job scheduling and execution:

```typescript
// Lines 68-88: Queue initialization with Redis configuration
function getCleanupQueue(): Queue.Queue {
  if (_cleanupQueue) {
    return _cleanupQueue;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.error({
      action: "cleanup_queue_init_error",
      error: "REDIS_URL environment variable is not set",
    });
    throw new Error("REDIS_URL environment variable is required for cleanup queue");
  }

  // TLS/SNI support for cloud Redis providers
  const useTls = redisUrl.startsWith("rediss://");
  const redisQueueOptions: Queue.QueueOptions["redis"] = {};
  
  // URL parsing with TLS configuration...
  
  _cleanupQueue = new Queue("log-cleanup", {
    redis: redisQueueOptions,
    defaultJobOptions: {
      attempts: 3,                    // Retry 3 times on failure
      backoff: {
        type: "exponential",
        delay: 60000,                 // First retry after 1 minute
      },
      removeOnComplete: 100,          // Keep last 100 completed jobs
      removeOnFail: 50,               // Keep last 50 failed jobs
    },
  });

  setupQueueProcessor(_cleanupQueue);
  return _cleanupQueue;
}
```

The queue is configured with:
- **Exponential backoff**: Retries with increasing delays to handle transient failures
- **Job retention**: Maintains history for monitoring and debugging
- **TLS support**: Compatible with cloud Redis providers requiring TLS/SNI

#### 1.2 Scheduled Cleanup Job (`/Users/ding/Github/claude-code-hub/src/lib/log-cleanup/cleanup-queue.ts`, lines 140-196)

```typescript
export async function scheduleAutoCleanup() {
  try {
    const settings = await getSystemSettings();
    const queue = getCleanupQueue();

    if (!settings.enableAutoCleanup) {
      logger.info({ action: "auto_cleanup_disabled" });

      // Remove all existing scheduled jobs when disabled
      const repeatableJobs = await queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await queue.removeRepeatableByKey(job.key);
      }
      return;
    }

    // Remove old scheduled jobs before creating new ones
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await queue.removeRepeatableByKey(job.key);
    }

    // Build cleanup conditions with defaults
    const retentionDays = settings.cleanupRetentionDays ?? 30;
    const beforeDate = new Date();
    beforeDate.setDate(beforeDate.getDate() - retentionDays);

    // Add new scheduled job with cron expression
    await queue.add(
      "auto-cleanup",
      {
        conditions: { beforeDate },
        batchSize: settings.cleanupBatchSize ?? 10000,
      },
      {
        repeat: {
          cron: settings.cleanupSchedule ?? "0 2 * * *", // Default: 2 AM daily
        },
      }
    );

    logger.info({
      action: "auto_cleanup_scheduled",
      schedule: settings.cleanupSchedule ?? "0 2 * * *",
      retentionDays,
      batchSize: settings.cleanupBatchSize ?? 10000,
    });
  } catch (error) {
    logger.error({
      action: "schedule_auto_cleanup_error",
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail Open: Scheduling failure doesn't block app startup
  }
}
```

Key behaviors:
- **Dynamic scheduling**: Jobs are rescheduled whenever settings change
- **Fail-open design**: Errors during scheduling don't prevent application startup
- **Cron-based timing**: Uses standard cron expressions for flexible scheduling

#### 1.3 Cleanup Service (`/Users/ding/Github/claude-code-hub/src/lib/log-cleanup/service.ts`)

The cleanup service implements the actual deletion logic with sophisticated batching:

```typescript
// Lines 64-163: Main cleanup function
export async function cleanupLogs(
  conditions: CleanupConditions,
  options: CleanupOptions = {},
  triggerInfo: TriggerInfo
): Promise<CleanupResult> {
  const startTime = Date.now();
  const batchSize = options.batchSize || 10000;
  let totalDeleted = 0;
  let batchCount = 0;

  try {
    // 1. Build WHERE conditions
    const whereConditions = buildWhereConditions(conditions);

    if (whereConditions.length === 0) {
      return {
        totalDeleted: 0,
        batchCount: 0,
        durationMs: Date.now() - startTime,
        error: "未指定任何清理条件",
      };
    }

    if (options.dryRun) {
      // Count-only mode for preview
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messageRequest)
        .where(and(...whereConditions));

      return {
        totalDeleted: result[0]?.count || 0,
        batchCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Batch deletion loop
    while (true) {
      const deleted = await deleteBatch(whereConditions, batchSize);

      if (deleted === 0) break;

      totalDeleted += deleted;
      batchCount++;

      logger.info({
        action: "log_cleanup_batch",
        batchNumber: batchCount,
        deletedInBatch: deleted,
        totalDeleted,
      });

      // Brief pause to avoid long table locks
      if (deleted === batchSize) {
        await sleep(100);
      }
    }

    return { totalDeleted, batchCount, durationMs };
  } catch (error) {
    // Error handling with partial results...
  }
}
```

**Batch Deletion Strategy** (`/Users/ding/Github/claude-code-hub/src/lib/log-cleanup/service.ts`, lines 218-235):

```typescript
async function deleteBatch(whereConditions: SQL[], batchSize: number): Promise<number> {
  // Use CTE (Common Table Expression) for atomic batch deletion
  const result = await db.execute(sql`
    WITH ids_to_delete AS (
      SELECT id FROM message_request
      WHERE ${and(...whereConditions)}
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM message_request
    WHERE id IN (SELECT id FROM ids_to_delete)
  `);

  return (result as any).rowCount || 0;
}
```

The batch deletion uses advanced PostgreSQL features:
- **CTE (Common Table Expression)**: Atomic selection and deletion in one query
- **FOR UPDATE SKIP LOCKED**: Prevents lock contention with concurrent operations
- **ORDER BY created_at ASC**: Deletes oldest records first (FIFO)
- **Configurable batch size**: Balances deletion speed vs. lock duration

### 2. Endpoint Probe Log Cleanup

Provider endpoint health checks generate probe logs stored in `provider_endpoint_probe_logs`. A separate cleanup mechanism handles these logs.

**Implementation** (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-log-cleanup.ts`):

```typescript
// Lines 16-25: Configuration from environment variables
const RETENTION_DAYS = Math.max(
  0,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_LOG_RETENTION_DAYS, 1)
);
const CLEANUP_BATCH_SIZE = Math.max(
  1,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE, 10_000)
);
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 24 hours
const LOCK_TTL_MS = 5 * 60 * 1000;                // 5 minutes

// Lines 34-91: Cleanup execution with leader lock
async function runCleanupOnce(): Promise<void> {
  if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__) {
    return;
  }

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__ = true;
  let lock: LeaderLock | null = null;

  try {
    lock = await acquireLeaderLock(LOCK_KEY, LOCK_TTL_MS);
    if (!lock) {
      return;  // Another instance is handling cleanup
    }

    const now = Date.now();
    const retentionMs = Math.max(0, RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    const beforeDate = new Date(now - retentionMs);

    let totalDeleted = 0;
    while (true) {
      const deleted = await deleteProviderEndpointProbeLogsBeforeDateBatch({
        beforeDate,
        batchSize: CLEANUP_BATCH_SIZE,
      });

      if (deleted <= 0) break;
      totalDeleted += deleted;
      if (deleted < CLEANUP_BATCH_SIZE) break;
    }

    if (totalDeleted > 0) {
      logger.info("[EndpointProbeLogCleanup] Completed", {
        retentionDays: RETENTION_DAYS,
        totalDeleted,
      });
    }
  } catch (error) {
    logger.warn("[EndpointProbeLogCleanup] Failed", { error });
  } finally {
    cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__ = false;
    if (lock) {
      await releaseLeaderLock(lock);
    }
  }
}
```

Key characteristics:
- **Leader lock pattern**: Uses Redis-based distributed locking to ensure only one instance runs cleanup in multi-instance deployments
- **24-hour interval**: Runs once daily (configurable via interval)
- **Environment-based configuration**: Retention and batch size via env vars
- **CI environment skip**: Automatically disabled in CI environments (`process.env.CI === "true"`)

### 3. Temporary File Cleanup

Database backup and restore operations generate temporary files that need cleanup.

**Implementation** (`/Users/ding/Github/claude-code-hub/src/lib/database-backup/temp-file-manager.ts`):

```typescript
// Lines 26-58: In-memory tracking of temp files
const activeTempFiles = new Map<string, TempFileInfo>();

export function registerTempFile(filePath: string, purpose: "import" | "export"): void {
  activeTempFiles.set(filePath, {
    path: filePath,
    createdAt: Date.now(),
    purpose,
  });

  logger.info({
    action: "temp_file_registered",
    filePath,
    purpose,
    activeCount: activeTempFiles.size,
  });
}

// Lines 119-153: Stale file cleanup (兜底机制)
export async function cleanupStaleTempFiles(maxAge: number = 6 * 60 * 60 * 1000): Promise<number> {
  const now = Date.now();
  let cleanedCount = 0;

  logger.info({
    action: "temp_file_stale_cleanup_start",
    activeCount: activeTempFiles.size,
    maxAge,
  });

  for (const [filePath, fileInfo] of activeTempFiles.entries()) {
    const age = now - fileInfo.createdAt;

    if (age > maxAge) {
      logger.warn({
        action: "temp_file_stale_detected",
        filePath,
        age,
        maxAge,
        purpose: fileInfo.purpose,
      });

      await cleanupTempFile(filePath, "timeout");
      cleanedCount++;
    }
  }

  return cleanedCount;
}

// Lines 218-246: Periodic cleanup scheduler
export function startPeriodicCleanup(
  interval: number = 60 * 60 * 1000,      // Default: 1 hour
  maxAge: number = 6 * 60 * 60 * 1000     // Default: 6 hours
): NodeJS.Timeout {
  logger.info({
    action: "temp_file_periodic_cleanup_start",
    interval,
    maxAge,
  });

  const intervalId = setInterval(() => {
    cleanupStaleTempFiles(maxAge).catch((err) => {
      logger.error({
        action: "temp_file_periodic_cleanup_error",
        error: err instanceof Error ? err.message : String(error),
      });
    });
  }, interval);

  // Immediate execution on startup
  cleanupStaleTempFiles(maxAge).catch((err) => {
    logger.error({
      action: "temp_file_initial_cleanup_error",
      error: err instanceof Error ? err.message : String(error),
    });
  });

  return intervalId;
}
```

Design principles:
- **Triple protection**: Normal cleanup (immediate), exception cleanup (on error), periodic cleanup (兜底)
- **In-memory tracking**: Uses Map for O(1) lookups without filesystem scanning
- **Defensive programming**: Cleanup failures don't affect main operations
- **Immediate + periodic**: Runs immediately on startup and periodically thereafter

### 4. Cache Cleanup

In-memory caches for sessions and providers have TTL-based expiration with optional periodic cleanup.

**Session Cache** (`/Users/ding/Github/claude-code-hub/src/lib/cache/session-cache.ts`, lines 208-229):

```typescript
export function startCacheCleanup(intervalSeconds: number = 60) {
  if (cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__) {
    return;
  }

  cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__ = setInterval(() => {
    activeSessionsCache.cleanup();
    sessionDetailsCache.cleanup();
  }, intervalSeconds * 1000);
}

export function stopCacheCleanup() {
  if (!cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__) {
    return;
  }

  clearInterval(cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__);
  cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__ = null;
}
```

## Configuration

### System Settings (Database-Configured)

The primary cleanup mechanism is configured through system settings stored in the database:

**SystemSettings Interface** (`/Users/ding/Github/claude-code-hub/src/types/system-config.ts`, lines 30-34):

```typescript
export interface SystemSettings {
  // ... other fields ...
  
  // 日志清理配置
  enableAutoCleanup?: boolean;        // Master switch (default: false)
  cleanupRetentionDays?: number;      // Retention period (default: 30 days)
  cleanupSchedule?: string;           // Cron expression (default: "0 2 * * *")
  cleanupBatchSize?: number;          // Deletion batch size (default: 10000)
  
  // ... other fields ...
}
```

**Database Schema** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`, lines 571-575):

```typescript
export const systemSettings = pgTable('system_settings', {
  // ... other columns ...
  
  // 日志清理配置
  enableAutoCleanup: boolean('enable_auto_cleanup').default(false),
  cleanupRetentionDays: integer('cleanup_retention_days').default(30),
  cleanupSchedule: varchar('cleanup_schedule', { length: 50 }).default('0 2 * * *'),
  cleanupBatchSize: integer('cleanup_batch_size').default(10000),
  
  // ... other columns ...
});
```

**Default Values** (`/Users/ding/Github/claude-code-hub/src/repository/system-config.ts`, lines 135-170):

```typescript
function createFallbackSettings(): SystemSettings {
  const now = new Date();
  return {
    // ... other defaults ...
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    // ... other defaults ...
  };
}
```

### Environment Variables

**Endpoint Probe Log Cleanup** (from `/Users/ding/Github/claude-code-hub/.env.example`, lines 140-144):

```bash
# 探测日志保留与清理
# - 所有探测结果（成功/失败）均记录到历史表
# - 自动清理任务每 24 小时运行，删除过期记录
ENDPOINT_PROBE_LOG_RETENTION_DAYS=1
ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE=10000
```

**Session TTL** (from `/Users/ding/Github/claude-code-hub/.env.example`, lines 61-66):

```bash
# Session 配置
SESSION_TTL=300                         # Session 过期时间（秒，默认 300 = 5 分钟）
```

### Frontend Configuration UI

The auto-cleanup settings can be configured through the admin dashboard:

**Form Component** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/config/_components/auto-cleanup-form.tsx`):

```typescript
const autoCleanupSchema = z.object({
  enableAutoCleanup: z.boolean(),
  cleanupRetentionDays: z.number().int().min(1).max(365),
  cleanupSchedule: z.string().min(1),
  cleanupBatchSize: z.number().int().min(1000).max(100000),
});
```

Validation rules:
- **Retention days**: 1-365 days (prevents accidental data loss)
- **Batch size**: 1,000-100,000 records (balances speed vs. lock duration)
- **Schedule**: Valid cron expression required

## Commands / API

### Manual Cleanup API

Administrators can trigger manual cleanup via the REST API:

**Endpoint**: `POST /api/admin/log-cleanup/manual`

**Request Schema** (`/Users/ding/Github/claude-code-hub/src/app/api/admin/log-cleanup/manual/route.ts`, lines 13-27):

```typescript
const cleanupRequestSchema = z.object({
  beforeDate: z.string().optional(),           // ISO 8601 date string
  afterDate: z.string().optional(),            // ISO 8601 date string
  userIds: z.array(z.number()).optional(),     // Filter by users
  providerIds: z.array(z.number()).optional(), // Filter by providers
  statusCodes: z.array(z.number()).optional(), // Filter by HTTP status codes
  statusCodeRange: z.object({                  // Status code range (e.g., 400-499)
    min: z.number(),
    max: z.number(),
  }).optional(),
  onlyBlocked: z.boolean().optional(),         // Only blocked requests
  dryRun: z.boolean().optional(),              // Preview mode (no actual deletion)
});
```

**Example Request**:
```json
{
  "beforeDate": "2024-01-01T00:00:00Z",
  "userIds": [1, 2, 3],
  "statusCodeRange": { "min": 400, "max": 499 },
  "dryRun": true
}
```

**Response**:
```json
{
  "success": true,
  "totalDeleted": 15000,
  "batchCount": 2,
  "durationMs": 1250
}
```

**Authorization**: Requires admin role (`session.user.role !== "admin"` returns 401)

### System Configuration API

Update cleanup settings via `POST /api/admin/system-config` with body:

```json
{
  "enableAutoCleanup": true,
  "cleanupRetentionDays": 30,
  "cleanupSchedule": "0 2 * * *",
  "cleanupBatchSize": 10000
}
```

## Edge Cases

### 1. No Cleanup Conditions Specified

If no conditions are provided (manual cleanup without filters), the system returns an error:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/log-cleanup/service.ts, lines 78-89
if (whereConditions.length === 0) {
  logger.warn({
    action: "log_cleanup_no_conditions",
    triggerType: triggerInfo.type,
  });
  return {
    totalDeleted: 0,
    batchCount: 0,
    durationMs: Date.now() - startTime,
    error: "未指定任何清理条件",
  };
}
```

This prevents accidental deletion of all records.

### 2. Redis Unavailable

If Redis is unavailable during queue initialization, the application throws an error:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/log-cleanup/cleanup-queue.ts, lines 24-32
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  logger.error({
    action: "cleanup_queue_init_error",
    error: "REDIS_URL environment variable is not set",
  });
  throw new Error("REDIS_URL environment variable is required for cleanup queue");
}
```

However, scheduling failures during app startup use fail-open strategy (line 194):

```typescript
} catch (error) {
  logger.error({
    action: "schedule_auto_cleanup_error",
    error: error instanceof Error ? error.message : String(error),
  });
  // Fail Open: 调度失败不影响应用启动
}
```

### 3. CI Environment

In CI environments, endpoint probe log cleanup is automatically disabled:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-log-cleanup.ts, lines 93-96
export function startEndpointProbeLogCleanup(): void {
  if (process.env.CI === "true") {
    return;
  }
  // ...
}
```

### 4. Concurrent Cleanup Prevention

Multiple mechanisms prevent concurrent cleanup execution:

**Within single instance** (globalThis state):
```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-log-cleanup.ts, lines 35-39
if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__) {
  return;
}
cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__ = true;
```

**Across multiple instances** (Redis leader lock):
```typescript
// Lines 44-47
lock = await acquireLeaderLock(LOCK_KEY, LOCK_TTL_MS);
if (!lock) {
  return;  // Another instance has the lock
}
```

### 5. Database Table Missing

If the system_settings table doesn't exist (e.g., during initial setup), the system returns fallback defaults:

```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/system-config.ts, lines 258-264
try {
  // ... fetch settings ...
} catch (error) {
  if (isTableMissingError(error)) {
    logger.warn("system_settings 表不存在，返回默认配置。请运行数据库迁移。", { error });
    return createFallbackSettings();
  }
  throw error;
}
```

### 6. Partial Database Migration

If columns are missing (partial migration), the system gracefully degrades:

```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/system-config.ts, lines 207-232
try {
  const [row] = await db.select(fullSelection).from(systemSettings).limit(1);
  return row ?? null;
} catch (error) {
  // 兼容旧版本数据库：system_settings 表存在但列未迁移齐全
  if (isUndefinedColumnError(error)) {
    logger.warn("system_settings 表列缺失，使用降级字段集读取（建议运行数据库迁移）。", {
      error,
    });

    const minimalSelection = { /* core fields only */ };
    const [row] = await db.select(minimalSelection).from(systemSettings).limit(1);
    return row ?? null;
  }
  throw error;
}
```

### 7. Large Batch Deletion Performance

For very large deletions, the system:
1. Uses `FOR UPDATE SKIP LOCKED` to avoid blocking concurrent inserts
2. Deletes in configurable batches (default 10,000)
3. Sleeps 100ms between batches to reduce lock contention
4. Orders by `created_at ASC` to delete oldest first (more efficient for B-trees)

### 8. Cleanup During High Traffic

The batch deletion with `SKIP LOCKED` allows the cleanup to proceed without blocking new inserts:

```sql
WITH ids_to_delete AS (
  SELECT id FROM message_request
  WHERE ...
  ORDER BY created_at ASC
  LIMIT ${batchSize}
  FOR UPDATE SKIP LOCKED  -- Skip rows locked by other transactions
)
DELETE FROM message_request
WHERE id IN (SELECT id FROM ids_to_delete)
```

## Implementation Details

### Database Indexes for Cleanup Performance

The database schema includes several indexes specifically optimized for cleanup operations (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`, lines 436-457):

```typescript
export const messageRequest = pgTable('message_request', {
  // ... column definitions ...
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // Optimized composite index for user+time+cost queries
  messageRequestUserDateCostIdx: index('idx_message_request_user_date_cost')
    .on(table.userId, table.createdAt, table.costUsd)
    .where(sql`${table.deletedAt} IS NULL`),
  
  // Optimized for user queries ordered by time
  messageRequestUserQueryIdx: index('idx_message_request_user_query')
    .on(table.userId, table.createdAt)
    .where(sql`${table.deletedAt} IS NULL`),
  
  // Session-based queries
  messageRequestSessionIdIdx: index('idx_message_request_session_id')
    .on(table.sessionId)
    .where(sql`${table.deletedAt} IS NULL`),
  
  // Basic indexes
  messageRequestCreatedAtIdx: index('idx_message_request_created_at').on(table.createdAt),
  messageRequestDeletedAtIdx: index('idx_message_request_deleted_at').on(table.deletedAt),
}));
```

These indexes serve dual purposes:
1. **Query optimization**: Speed up dashboard queries, user logs, session views
2. **Cleanup optimization**: The `createdAt` index is crucial for efficient batch deletion ordered by time

### Soft Deletion vs Hard Deletion

The system implements **soft deletion** for most entities (including `message_request`), but the cleanup process performs **hard deletion**:

**Soft deletion pattern** (used for data integrity):
```typescript
// Records have a deletedAt timestamp
deletedAt: timestamp('deleted_at', { withTimezone: true }),

// Queries filter out soft-deleted records
.where(sql`${table.deletedAt} IS NULL`)
```

**Hard deletion by cleanup** (used for data retention):
```typescript
// The cleanup service permanently deletes records
DELETE FROM message_request WHERE id IN (...)
```

This two-phase approach:
- Allows users to "delete" logs in the UI (soft delete) for immediate privacy
- Allows administrators to configure retention policies (hard delete) for storage management
- Prevents accidental data loss while enabling automatic cleanup

### Queue Processor Implementation

The Bull queue processor handles job execution with comprehensive logging (`/Users/ding/Github/claude-code-hub/src/lib/log-cleanup/cleanup-queue.ts`, lines 93-135):

```typescript
function setupQueueProcessor(queue: Queue.Queue): void {
  queue.process(async (job: Job) => {
    logger.info({
      action: "cleanup_job_start",
      jobId: job.id,
      conditions: job.data.conditions,
    });

    const result = await cleanupLogs(
      job.data.conditions,
      { batchSize: job.data.batchSize },
      { type: "scheduled" }
    );

    if (result.error) {
      throw new Error(result.error);
    }

    logger.info({
      action: "cleanup_job_complete",
      jobId: job.id,
      totalDeleted: result.totalDeleted,
      durationMs: result.durationMs,
    });

    return result;
  });

  queue.on("failed", (job: Job, err: Error) => {
    logger.error({
      action: "cleanup_job_failed",
      jobId: job.id,
      error: err.message,
      attempts: job.attemptsMade,
    });
  });
}
```

Key aspects:
- **Structured logging**: All events logged with action identifiers for monitoring
- **Error propagation**: Job failures trigger Bull's retry mechanism
- **Result tracking**: Deleted counts and duration tracked for each job

### Leader Lock Implementation

For distributed deployments, the endpoint probe log cleanup uses a Redis-based leader election pattern:

**Lock Acquisition** (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/leader-lock.ts`):
```typescript
export async function acquireLeaderLock(
  lockKey: string,
  ttlMs: number
): Promise<LeaderLock | null> {
  const redis = getRedisClient();
  const token = `${Date.now()}-${Math.random()}`;
  
  const acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
  
  if (acquired === "OK") {
    return { key: lockKey, token };
  }
  return null;
}

export async function releaseLeaderLock(lock: LeaderLock): Promise<void> {
  const redis = getRedisClient();
  
  // Lua script for atomic check-and-delete
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  
  await redis.eval(script, 1, lock.key, lock.token);
}
```

This ensures:
- Only one instance runs cleanup at a time
- Lock automatically expires if the holder crashes (TTL)
- Safe lock release using token comparison (prevents releasing another instance's lock)

### Bull Board Monitoring

The cleanup queue includes Bull Board integration for monitoring (`/Users/ding/Github/claude-code-hub/src/lib/log-cleanup/cleanup-queue.ts`, lines 201-212):

```typescript
export function createCleanupMonitor() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  const queue = getCleanupQueue();
  createBullBoard({
    queues: [new BullAdapter(queue)],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}
```

This provides a web UI at `/admin/queues` for:
- Viewing queued, active, completed, and failed jobs
- Manually triggering jobs
- Inspecting job details and error traces

### Graceful Shutdown

The instrumentation handles graceful shutdown of cleanup processes (`/Users/ding/Github/claude-code-hub/src/instrumentation.ts`, lines 135-144):

```typescript
const shutdownHandler = async (signal: string) => {
  // ... other cleanup ...
  
  try {
    const { stopEndpointProbeLogCleanup } = await import(
      "@/lib/provider-endpoints/probe-log-cleanup"
    );
    stopEndpointProbeLogCleanup();
  } catch (error) {
    logger.warn("[Instrumentation] Failed to stop endpoint probe log cleanup", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  
  // ... other cleanup ...
};

process.once("SIGTERM", () => void shutdownHandler("SIGTERM"));
process.once("SIGINT", () => void shutdownHandler("SIGINT"));
```

This ensures:
- Cleanup intervals are cleared on shutdown
- Leader locks are released promptly
- No orphaned locks preventing future cleanups

## Monitoring and Observability

### Log Actions Reference

The cleanup system uses structured logging with the following action identifiers:

| Action | Source | Description |
|--------|--------|-------------|
| `cleanup_queue_initializing` | cleanup-queue.ts | Queue initialization started |
| `cleanup_queue_initialized` | cleanup-queue.ts | Queue initialization completed |
| `auto_cleanup_disabled` | cleanup-queue.ts | Auto-cleanup is disabled |
| `auto_cleanup_scheduled` | cleanup-queue.ts | New cleanup job scheduled |
| `schedule_auto_cleanup_error` | cleanup-queue.ts | Failed to schedule cleanup |
| `cleanup_job_start` | cleanup-queue.ts | Job execution started |
| `cleanup_job_complete` | cleanup-queue.ts | Job execution completed |
| `cleanup_job_failed` | cleanup-queue.ts | Job execution failed |
| `log_cleanup_no_conditions` | service.ts | No conditions specified |
| `log_cleanup_dry_run` | service.ts | Dry run completed |
| `log_cleanup_batch` | service.ts | Batch deletion completed |
| `log_cleanup_complete` | service.ts | Cleanup completed |
| `log_cleanup_error` | service.ts | Cleanup error occurred |
| `temp_file_registered` | temp-file-manager.ts | Temp file tracking started |
| `temp_file_deleted` | temp-file-manager.ts | Temp file deleted |
| `temp_file_stale_cleanup_start` | temp-file-manager.ts | Stale cleanup started |
| `temp_file_stale_detected` | temp-file-manager.ts | Stale file found |
| `manual_log_cleanup_initiated` | manual/route.ts | Manual cleanup started |

### Metrics to Monitor

For production deployments, monitor these metrics:

1. **Cleanup job duration**: Sudden increases may indicate table bloat or lock contention
2. **Records deleted per job**: Tracks data retention patterns
3. **Failed job count**: Indicates configuration or database issues
4. **Temp file cleanup count**: Unexpected increases may indicate file leaks
5. **Leader lock acquisition time**: High times indicate Redis latency issues

## Best Practices

### Recommended Configuration

For production deployments:

```bash
# .env configuration
ENDPOINT_PROBE_LOG_RETENTION_DAYS=7        # Keep probe logs for 1 week
ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE=5000 # Smaller batches for lower lock time
```

**Database settings** (via admin UI):
- **Retention days**: 30-90 days depending on compliance requirements
- **Schedule**: "0 2 * * *" (2 AM daily) - low traffic period
- **Batch size**: 10000 for most deployments, reduce to 5000 for high-traffic systems

### Cron Schedule Examples

Common cron expressions for the `cleanupSchedule` setting:

| Schedule | Cron Expression | Use Case |
|----------|----------------|----------|
| Daily 2 AM | `0 2 * * *` | Default, low-traffic period |
| Daily midnight | `0 0 * * *` | Alternative low-traffic period |
| Weekly Sunday 3 AM | `0 3 * * 0` | Weekly cleanup for smaller deployments |
| Every 6 hours | `0 */6 * * *` | Aggressive cleanup for high-volume systems |
| Every hour | `0 * * * *` | Emergency cleanup mode |

### Troubleshooting

**Issue**: Cleanup jobs failing with timeout errors
- **Solution**: Reduce `cleanupBatchSize` to decrease lock duration

**Issue**: Cleanup not running
- **Check**: Verify `enableAutoCleanup` is true in system settings
- **Check**: Verify Redis connection (`REDIS_URL` env var)
- **Check**: Review logs for `schedule_auto_cleanup_error`

**Issue**: Disk space still growing despite cleanup
- **Check**: Verify PostgreSQL `VACUUM` is running (autovacuum or manual)
- **Check**: Check for table bloat: `SELECT * FROM pg_stat_user_tables WHERE relname = 'message_request'`
- **Solution**: Run `VACUUM FULL` during maintenance window (requires table lock)

**Issue**: Multiple instances running cleanup simultaneously
- **Check**: Verify Redis is shared across all instances
- **Check**: Review logs for leader lock acquisition failures

## References

### Core Files

1. **Cleanup Queue**: `/Users/ding/Github/claude-code-hub/src/lib/log-cleanup/cleanup-queue.ts`
   - Bull queue initialization and configuration
   - Scheduled job management
   - Job processor and error handling

2. **Cleanup Service**: `/Users/ding/Github/claude-code-hub/src/lib/log-cleanup/service.ts`
   - Core deletion logic
   - Batch deletion with CTE
   - Condition building for flexible filtering

3. **Endpoint Probe Log Cleanup**: `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-log-cleanup.ts`
   - Distributed cleanup with leader locks
   - Environment-based configuration
   - 24-hour interval scheduling

4. **Leader Lock**: `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/leader-lock.ts`
   - Redis-based distributed locking
   - Atomic lock acquisition and release

5. **Temporary File Manager**: `/Users/ding/Github/claude-code-hub/src/lib/database-backup/temp-file-manager.ts`
   - In-memory file tracking
   - Periodic stale file cleanup
   - Triple-protection cleanup strategy

6. **Session Cache**: `/Users/ding/Github/claude-code-hub/src/lib/cache/session-cache.ts`
   - In-memory cache cleanup
   - TTL-based expiration

### API Routes

7. **Manual Cleanup API**: `/Users/ding/Github/claude-code-hub/src/app/api/admin/log-cleanup/manual/route.ts`
   - REST endpoint for manual cleanup
   - Admin authorization
   - Dry-run support

### Configuration

8. **System Settings Type**: `/Users/ding/Github/claude-code-hub/src/types/system-config.ts`
   - TypeScript interfaces for cleanup settings

9. **System Settings Repository**: `/Users/ding/Github/claude-code-hub/src/repository/system-config.ts`
   - Database access for settings
   - Fallback defaults
   - Migration compatibility

10. **Database Schema**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`
    - Table definitions with cleanup-related columns
    - Indexes for efficient cleanup queries

11. **Environment Configuration**: `/Users/ding/Github/claude-code-hub/.env.example`
    - Environment variable documentation

### Frontend

12. **Auto-Cleanup Form**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/config/_components/auto-cleanup-form.tsx`
    - React component for cleanup configuration
    - Form validation with Zod

### Initialization

13. **Instrumentation**: `/Users/ding/Github/claude-code-hub/src/instrumentation.ts`
    - App startup initialization
    - Cleanup scheduler registration
    - Graceful shutdown handling

### Repository

14. **Provider Endpoints Repository**: `/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts`
    - `deleteProviderEndpointProbeLogsBeforeDateBatch` function
    - Batch deletion SQL for probe logs

## Summary

The auto-cleanup system in Claude Code Hub is a comprehensive, production-ready solution with the following characteristics:

1. **Multi-layered approach**: Covers database logs, probe logs, temp files, and caches
2. **Configurable**: Database settings for primary cleanup, environment variables for probe logs
3. **Resilient**: Fail-open design, error handling, graceful degradation
4. **Distributed-safe**: Leader locks prevent conflicts in multi-instance deployments
5. **Performance-conscious**: Batch deletion with SKIP LOCKED, configurable batch sizes
6. **Observable**: Comprehensive logging for monitoring and debugging
7. **Safe**: Dry-run mode, validation, protection against accidental full deletion
8. **Maintainable**: Bull Board UI for monitoring, structured logging for troubleshooting
