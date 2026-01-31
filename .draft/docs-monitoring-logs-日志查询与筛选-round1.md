# Logs Implementation Analysis Report

## 1. Intent Analysis

The logs implementation in Claude Code Hub serves multiple critical purposes:

1. **Request Tracking & Auditing**: Every API request passing through the proxy is logged with detailed metadata including timing, costs, tokens, and provider chain information for complete audit trails.

2. **Cost Management & Billing**: Logs track cost per request in USD, token usage (input/output/cache), and provider multipliers to enable accurate billing and cost analysis.

3. **Operational Monitoring**: Real-time visibility into system health, error rates, retry patterns, and provider performance through the dashboard logs interface.

4. **Troubleshooting & Debugging**: Comprehensive error logging with stack traces, blocked request reasons, and provider chain decisions to diagnose issues.

5. **Session Management**: Session ID tracking enables conversation continuity and helps analyze user interaction patterns.

## 2. Behavior Summary

### 2.1 Log Storage Architecture

Logs are stored in the `message_request` table in PostgreSQL with the following key characteristics:

- **Soft Delete Pattern**: Uses `deletedAt` timestamp for soft deletion, allowing data recovery if needed
- **Indexing Strategy**: Multiple optimized indexes for common query patterns:
  - `idx_message_request_user_date_cost`: Composite index for user statistics queries
  - `idx_message_request_session_id`: Session-based queries
  - `idx_message_request_endpoint`: Endpoint filtering
  - `idx_message_request_blocked_by`: Excluding warmup/intercepted requests
  - `idx_message_request_user_query`: User log queries by time

### 2.2 Log Writing Modes

The system supports two log writing modes configured via `MESSAGE_REQUEST_WRITE_MODE`:

**Async Mode (Default)**:
- Buffers updates in memory with configurable batch size (default 200)
- Flush interval: 250ms
- Max pending queue: 5000 entries
- Reduces database write amplification and connection pressure
- Queue overflow protection: drops oldest non-finalized entries

**Sync Mode**:
- Immediate synchronous writes
- Higher consistency but increased latency
- Useful for debugging but not recommended for production

### 2.3 Log Query & Display

The system provides two pagination strategies:

**Offset Pagination** (`findUsageLogsWithDetails`):
- Traditional page-based pagination
- Includes total count and aggregate statistics
- Suitable for bounded result sets

**Cursor Pagination** (`findUsageLogsBatch`):
- Keyset-based pagination using `(createdAt, id)` tuple
- No COUNT query - constant performance regardless of data size
- Optimized for infinite scroll and virtualized tables
- Includes `hasMore` flag and `nextCursor` for continuation

### 2.4 Permission Model

- **Admin Users**: Can view all logs, filter by any user/key/provider
- **Regular Users**: Can only view their own logs (userId filter enforced server-side)
- **Read-Only Keys**: Limited access to own usage data only

## 3. Configuration & Commands

### 3.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Application log level: fatal, error, warn, info, debug, trace |
| `MESSAGE_REQUEST_WRITE_MODE` | `async` | Log writing mode: sync or async |
| `MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS` | `250` | Async flush interval in milliseconds |
| `MESSAGE_REQUEST_ASYNC_BATCH_SIZE` | `200` | Maximum batch size for async writes |
| `MESSAGE_REQUEST_ASYNC_MAX_PENDING` | `5000` | Maximum pending updates in queue |
| `ENDPOINT_PROBE_LOG_RETENTION_DAYS` | `1` | Retention days for endpoint probe logs |
| `ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE` | `10000` | Batch size for probe log cleanup |

### 3.2 System Settings (Database)

| Setting | Default | Description |
|---------|---------|-------------|
| `enableAutoCleanup` | `false` | Enable automatic log cleanup |
| `cleanupRetentionDays` | `30` | Days to retain logs before cleanup |
| `cleanupSchedule` | `"0 2 * * *"` | Cron schedule for cleanup (default: 2 AM daily) |
| `cleanupBatchSize` | `10000` | Records to delete per batch |

### 3.3 API Endpoints

**Log Query APIs**:
```
POST /api/actions/usage-logs/getUsageLogs
POST /api/actions/usage-logs/getUsageLogsBatch      # Cursor pagination
POST /api/actions/usage-logs/getUsageLogsStats      # Aggregate statistics
POST /api/actions/usage-logs/getModelList           # Available models for filter
POST /api/actions/usage-logs/getStatusCodeList      # Available status codes
POST /api/actions/usage-logs/getFilterOptions       # Combined filter options (cached)
POST /api/actions/usage-logs/exportUsageLogs        # CSV export
POST /api/actions/usage-logs/getSessionIdSuggestions # Session ID autocomplete
```

**Log Management APIs**:
```
GET  /api/admin/log-level                           # Get current log level
POST /api/admin/log-level                           # Set log level dynamically
POST /api/admin/log-cleanup/manual                  # Manual log cleanup
```

### 3.4 Filter Options

**Available Filters**:
- `userId`: Filter by specific user (admin only)
- `keyId`: Filter by API key
- `providerId`: Filter by provider (admin only)
- `sessionId`: Filter by session ID (exact match)
- `startTime`/`endTime`: Time range filter (millisecond timestamps)
- `statusCode`: Exact HTTP status code match
- `excludeStatusCode200`: Show only non-200 responses
- `model`: Filter by model name
- `endpoint`: Filter by API endpoint path
- `minRetryCount`: Filter by minimum retry attempts

**Quick Filter Presets**:
- Today: Current day time range
- This Week: Current week (Monday start)
- Errors Only: Exclude status code 200
- Show Retries: Minimum 1 retry

## 4. Edge Cases & Implementation Details

### 4.1 Warmup Request Exclusion

Warmup requests (used for provider health checks) are excluded from all statistics and aggregations:

```typescript
// From src/repository/_shared/message-request-conditions.ts
export const EXCLUDE_WARMUP_CONDITION = 
  sql`(${messageRequest.blockedBy} IS NULL OR ${messageRequest.blockedBy} <> 'warmup')`;
```

This ensures warmup traffic doesn't skew cost calculations or usage statistics.

### 4.2 Session ID Search with LIKE Escaping

Session ID suggestions use prefix matching with proper SQL LIKE escaping:

```typescript
// From src/repository/_shared/like.ts
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
```

This prevents SQL injection through search terms while enabling efficient prefix queries.

### 4.3 Timezone Handling

- Frontend sends local timezone timestamps in milliseconds
- PostgreSQL `timestamptz` type handles automatic conversion
- All storage is in UTC, display converts to local time

### 4.4 Soft Delete Implementation

Logs use soft delete for data safety:
- `deletedAt` column marks deleted records
- All queries filter with `isNull(messageRequest.deletedAt)`
- Cleanup service physically deletes soft-deleted records based on retention policy

### 4.5 Filter Options Caching

To avoid repeated DISTINCT queries:
```typescript
const FILTER_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

Models, status codes, and endpoints are cached in memory with 5-minute TTL.

### 4.6 CSV Export Security

CSV fields are escaped to prevent formula injection attacks:
```typescript
function escapeCsvField(field: string): string {
  const dangerousChars = ["=", "+", "-", "@", "\t", "\r"];
  if (dangerousChars.some((char) => field.startsWith(char))) {
    safeField = `'${field}`; // Prefix with single quote
  }
  // ... additional escaping
}
```

### 4.7 Log Level Dynamic Adjustment

The system supports runtime log level changes without restart:
```typescript
// GET /api/admin/log-level - returns current level
// POST /api/admin/log-level - sets new level
setLogLevel(newLevel: LogLevel): void
```

Valid levels: `fatal`, `error`, `warn`, `info`, `debug`, `trace`

### 4.8 Batch Cleanup Safety

Log cleanup uses CTE (Common Table Expression) with row locking:
```sql
WITH ids_to_delete AS (
  SELECT id FROM message_request
  WHERE {conditions}
  ORDER BY created_at ASC
  LIMIT {batchSize}
  FOR UPDATE SKIP LOCKED
)
DELETE FROM message_request
WHERE id IN (SELECT id FROM ids_to_delete)
```

This prevents lock contention and allows cleanup to run without blocking new inserts.

### 4.9 Message Request Write Buffer Protection

When the pending queue exceeds max capacity:
1. Prioritizes dropping incomplete entries (no durationMs)
2. Falls back to FIFO if all entries have durationMs
3. Logs warning with details of dropped updates

### 4.10 Provider Chain Retry Count

Retry count is calculated from provider chain JSONB:
```typescript
sql`GREATEST(COALESCE(jsonb_array_length(${messageRequest.providerChain}) - 1, 0), 0) >= ${minRetryCount}`
```

This allows filtering by actual retry attempts, not just configured limits.

## 5. References

### Key Source Files

**Core Log Repository**:
- `src/repository/usage-logs.ts` - Main log query functions and types

**Database Schema**:
- `src/drizzle/schema.ts` - `messageRequest` table definition (lines 369-457)

**Log Cleanup**:
- `src/lib/log-cleanup/service.ts` - Cleanup service implementation
- `src/lib/log-cleanup/cleanup-queue.ts` - Bull queue for scheduled cleanup

**Logger Implementation**:
- `src/lib/logger.ts` - Pino-based logger with dynamic level control

**Log Actions**:
- `src/actions/usage-logs.ts` - Server actions for log queries

**UI Components**:
- `src/app/[locale]/dashboard/logs/_components/usage-logs-filters.tsx` - Filter panel
- `src/app/[locale]/dashboard/logs/_components/virtualized-logs-table.tsx` - Virtualized table
- `src/app/[locale]/dashboard/logs/_utils/logs-query.ts` - URL query utilities

**Configuration**:
- `src/lib/config/env.schema.ts` - Environment variable validation
- `src/lib/constants/usage-logs.constants.ts` - Session ID search constants

**API Routes**:
- `src/app/api/admin/log-level/route.ts` - Log level management
- `src/app/api/admin/log-cleanup/manual/route.ts` - Manual cleanup endpoint
- `src/app/api/actions/[...route]/route.ts` - OpenAPI auto-generated actions

**Supporting Utilities**:
- `src/repository/_shared/message-request-conditions.ts` - Warmup exclusion
- `src/repository/_shared/like.ts` - SQL LIKE escaping
- `src/lib/provider-endpoints/probe-log-cleanup.ts` - Endpoint probe log cleanup
- `src/repository/message-write-buffer.ts` - Async write buffer implementation

### Related Documentation

- `docs/dashboard-logs-callchain.md` - Dashboard logs call chain documentation
- `messages/*/settings/logs.json` - i18n translations for log settings

---

*Report generated from codebase analysis of /Users/ding/Github/claude-code-hub*
