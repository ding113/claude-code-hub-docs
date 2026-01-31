# Round 2 Review Draft: Data Import/Export (数据导入导出)

## Review Summary

This document has been verified against the actual codebase at `/Users/ding/Github/claude-code-hub/`. Several corrections have been made from the round1 draft.

### Key Corrections Made:
1. **Provider batch max size**: Corrected from 100 to 500 (actual: `BATCH_OPERATION_MAX_SIZE = 500`)
2. **User batch update fields**: Corrected to match actual interface (removed non-existent fields)
3. **Key batch update fields**: Corrected to match actual interface
4. **Removed inaccurate line number references**
5. **Verified all file paths exist**

---

## Intent Analysis

The data import/export system in claude-code-hub serves multiple critical purposes:

1. **Database Backup and Recovery**: Full database backup export and import functionality for disaster recovery and data migration
2. **Configuration Management**: Import/export of model prices and system configurations
3. **Bulk Data Operations**: Batch updates for users, keys, and providers to enable efficient administrative workflows
4. **Data Synchronization**: Cloud price table synchronization and automated data seeding

The system is designed with enterprise-grade safety features including distributed locking, transaction support, and comprehensive validation to prevent data corruption during import/export operations.

---

## Behavior Summary

### 1. Database Backup Export

**Endpoint**: `GET /api/admin/database/export?excludeLogs=true`

The database export functionality creates a complete PostgreSQL backup using `pg_dump` in custom format (compressed). Key behaviors:

- **Admin-only access**: Only users with `admin` role can execute exports
- **Distributed locking**: Uses Redis-backed distributed lock to prevent concurrent backup operations
- **Streaming response**: Returns data as a stream for large database support
- **Optional log exclusion**: Supports `--exclude-table-data=message_request` to exclude request logs while preserving schema

**File Naming Convention** (verified from `export/route.ts` lines 143-145):
```typescript
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
const suffix = excludeLogs ? "_no-logs" : "";
const filename = `backup_${timestamp}${suffix}.dump`;
```

### 2. Database Backup Import

**Endpoint**: `POST /api/admin/database/import`

The import functionality restores database from a `.dump` file using `pg_restore`. Key behaviors:

- **File validation**: Only accepts `.dump` files, max 500MB
- **Two import modes**:
  - **Merge mode** (`cleanFirst=false`): Imports data without clearing existing data
  - **Overwrite mode** (`cleanFirst=true`): Uses `--clean --if-exists --no-owner` flags
- **Log skipping option** (`skipLogs`): Can skip `message_request` table data import
- **SSE progress streaming**: Returns Server-Sent Events for real-time progress updates
- **Automatic migration**: Runs `runMigrations()` after successful restore to sync schema

**Error Analysis** (verified from `docker-executor.ts` lines 111-171):
The system categorizes restore errors into:
- **Ignorable errors**: Object already exists, multiple primary keys, duplicate key values, missing roles
- **Fatal errors**: Connection failures, authentication errors, permission denied, database not found, out of memory, disk full

### 3. Model Price Import/Sync

**Supported Formats**:
- **JSON**: Internal price table format (`PriceTableJson`)
- **TOML**: Cloud price table format from `https://claude-code-hub.app/config/prices-base.toml`

**Import Actions** (verified from `model-prices.ts` and `cloud-price-updater.ts`):
- `uploadPriceTable(content, overwriteManual?)`: Manual upload via Web UI
- `syncLiteLLMPrices(overwriteManual?)`: Manual sync from cloud triggered by admin
- `syncCloudPriceTableToDatabase(overwriteManual?)`: Background sync service

**Conflict Resolution**:
- Manual prices are preserved by default
- Optional `overwriteManual` array allows specifying which manual prices to overwrite
- Tracks price sources (`"litellm"` vs `"manual"`)

### 4. Bulk Operations

**Provider Batch Operations** (`src/actions/providers.ts`):
- `batchUpdateProviders`: Update isEnabled, priority, weight, costMultiplier, groupTag
- `batchDeleteProviders`: Soft delete multiple providers
- `batchResetProviderCircuits`: Reset circuit breaker state
- **Max batch size**: 500 providers per operation (`BATCH_OPERATION_MAX_SIZE`)

**User Batch Operations** (`src/actions/users.ts`):
- `batchUpdateUsers`: Update user fields with transaction guarantee
- **Max batch size**: 500 users per operation (`MAX_BATCH_SIZE`)
- **Atomic updates**: All-or-nothing transaction with row count validation

**Key Batch Operations** (`src/actions/keys.ts`):
- `batchUpdateKeys`: Update key properties
- **Max batch size**: 500 keys per operation (`MAX_BATCH_SIZE`)
- **Safety validation**: Prevents disabling all keys for any user

---

## Config/Commands

### Environment Variables

**Database Configuration** (`src/lib/database-backup/db-config.ts`):
```typescript
// Required: PostgreSQL connection string
DSN=postgresql://user:password@host:port/database
```

**Parsed Database Config** (verified):
```typescript
interface DatabaseConfig {
  host: string;      // Default: "localhost"
  port: number;      // Default: 5432
  user: string;      // Default: "postgres"
  password: string;
  database: string;  // Default: "postgres"
}
```

### API Routes

**Database Export** (`src/app/api/admin/database/export/route.ts`):
```typescript
// GET /api/admin/database/export?excludeLogs=true
// Response: application/octet-stream
// Headers:
//   Content-Disposition: attachment; filename="backup_2025-01-29T10-30-00.dump"
```

**Database Import** (`src/app/api/admin/database/import/route.ts`):
```typescript
// POST /api/admin/database/import
// Content-Type: multipart/form-data
// Body:
//   - file: File (.dump format)
//   - cleanFirst: 'true' | 'false'
//   - skipLogs: 'true' | 'false'
// Response: text/event-stream (SSE)
```

### pg_dump Arguments (verified from `docker-executor.ts` lines 14-30)

```typescript
const args = [
  "-h", dbConfig.host,
  "-p", dbConfig.port.toString(),
  "-U", dbConfig.user,
  "-d", dbConfig.database,
  "-Fc",  // Custom format (compressed)
  "-v",   // Verbose
];

if (excludeLogs) {
  args.push("--exclude-table-data=message_request");
}
```

### pg_restore Arguments (verified from `docker-executor.ts` lines 180-203)

```typescript
const args = [
  "-h", dbConfig.host,
  "-p", dbConfig.port.toString(),
  "-U", dbConfig.user,
  "-d", dbConfig.database,
  "-v",   // Verbose
];

if (cleanFirst) {
  args.push("--clean", "--if-exists", "--no-owner");
}

if (skipLogs) {
  args.push("--exclude-table-data=message_request");
}

args.push(filePath);
```

### Distributed Lock Configuration (verified from `backup-lock.ts` lines 16-17)

```typescript
const LOCK_KEY = "database:backup:lock";
const LOCK_TTL = 5 * 60 * 1000; // 5 minutes (milliseconds)
```

**Lock Strategy**:
1. Try Redis distributed lock first (supports multi-instance deployments)
2. Fall back to in-memory lock if Redis unavailable (single-instance safety)
3. Lua scripts ensure atomic SET NX PX operations

### Temp File Management (verified from `temp-file-manager.ts`)

```typescript
// Default cleanup interval: 1 hour
const interval = 60 * 60 * 1000;

// Default max age: 6 hours
const maxAge = 6 * 60 * 60 * 1000;

// Temp file path pattern
/tmp/database_${purpose}_${timestamp}_${random}.dump
```

---

## Edge Cases

### 1. Concurrent Backup Operations

**Scenario**: Two admins attempt to export/import simultaneously

**Behavior**:
- First request acquires the distributed lock
- Second request receives HTTP 409 with error message:
  ```json
  {
    "error": "其他管理员正在执行备份操作，请稍后重试",
    "details": "为确保数据一致性，同一时间只能执行一个备份操作"
  }
  ```

**Implementation** (verified from `backup-lock.ts`):
```typescript
export async function acquireBackupLock(operation: "export" | "import"): Promise<string | null> {
  // Try Redis lock first
  if (redis && redis.status === "ready") {
    const luaScript = `
      return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])
    `;
    const result = await redis.eval(luaScript, 1, LOCK_KEY, lockId, LOCK_TTL.toString());
    if (result === "OK") return lockId;
  }
  // Fall back to memory lock
  // ...
}
```

### 2. Request Cancellation During Import

**Scenario**: User closes browser during import operation

**Behavior**:
- Abort signal triggers cleanup handler
- Temporary file is deleted
- Distributed lock is released
- pg_restore process continues but output is discarded

**Implementation** (verified from `import/route.ts` lines 136-160):
```typescript
const abortHandler = () => {
  if (currentTempFilePath) {
    cleanupTempFile(currentTempFilePath, "aborted").catch(/* ... */);
  }
  if (currentLockId) {
    releaseBackupLock(currentLockId, "import").catch(/* ... */);
  }
};
request.signal.addEventListener("abort", abortHandler);
```

### 3. Ignorable Errors During Restore

**Scenario**: Importing to a database that already has some objects

**Behavior**:
- Exit code 1 with only ignorable errors is treated as success
- Fatal errors cause import failure
- Automatic migration runs after successful restore

**Error Classification** (verified from `docker-executor.ts`):
```typescript
const ignorablePatterns = [
  /already exists/i,
  /multiple primary keys/i,
  /duplicate key value/i,
  /role .* does not exist/i,
];

const fatalPatterns = [
  /could not connect/i,
  /authentication failed/i,
  /permission denied/i,
  /database .* does not exist/i,
  /out of memory/i,
  /disk full/i,
];
```

### 4. Batch Update Validation Failures

**Scenario**: Batch updating keys would disable all keys for a user

**Behavior**:
- Transaction rolls back
- Returns error: "该用户至少需要保留一个可用的密钥" (CANNOT_DISABLE_LAST_KEY)
- No partial updates applied

**Implementation** (verified from `keys.ts`):
```typescript
// Check each user would still have at least one enabled key
for (const [userId, disableCount] of userDisableCounts) {
  const currentEnabledCount = userEnabledCounts.get(userId) ?? 0;
  if (currentEnabledCount - disableCount < 1) {
    throw new BatchUpdateError(
      tError("CANNOT_DISABLE_LAST_KEY"),
      ERROR_CODES.OPERATION_FAILED
    );
  }
}
```

### 5. Redis Unavailability

**Scenario**: Redis is down during backup operation

**Behavior**:
- Falls back to in-memory lock
- Logs warning: "backup_lock_fallback_to_memory"
- Single-instance deployment remains safe
- Multi-instance deployment may have race conditions

### 6. Large File Uploads

**Scenario**: Uploading a backup file larger than 500MB

**Behavior**:
- Returns HTTP 413 (Payload Too Large)
- Error message includes file size details
- File is rejected before processing begins

**Implementation** (verified from `import/route.ts` lines 16, 57-72):
```typescript
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

if (file.size > MAX_FILE_SIZE) {
  return Response.json(
    {
      error: "文件过大，最大支持 500MB",
      details: `当前文件: ${(file.size / 1024 / 1024).toFixed(2)}MB，限制: 500MB`,
    },
    { status: 413 }
  );
}
```

### 7. Price Table Format Auto-Detection

**Scenario**: Uploading price table without specifying format

**Behavior**:
- First attempts JSON parsing
- If JSON fails, attempts TOML parsing
- If both fail, returns format error

**Implementation** (verified from `model-prices.ts` lines 215-227):
```typescript
let jsonContent = content;
try {
  JSON.parse(content);
} catch {
  const parseResult = parseCloudPriceTableToml(content);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }
  jsonContent = JSON.stringify(parseResult.data.models);
}
```

---

## References

### Core Files (all verified to exist)

**Database Backup/Restore**:
- `src/app/api/admin/database/export/route.ts` - Export API endpoint
- `src/app/api/admin/database/import/route.ts` - Import API endpoint
- `src/lib/database-backup/backup-lock.ts` - Distributed locking service
- `src/lib/database-backup/docker-executor.ts` - pg_dump/pg_restore execution
- `src/lib/database-backup/temp-file-manager.ts` - Temporary file lifecycle management
- `src/lib/database-backup/db-config.ts` - Database configuration parser
- `src/types/database-backup.ts` - TypeScript type definitions

**Price Table Import/Sync**:
- `src/actions/model-prices.ts` - Price table actions
- `src/lib/price-sync/cloud-price-table.ts` - TOML parsing and cloud fetch
- `src/lib/price-sync/cloud-price-updater.ts` - Cloud sync orchestration
- `src/types/model-price.ts` - Price data type definitions

**Batch Operations**:
- `src/actions/providers.ts` - Provider batch operations
- `src/actions/users.ts` - User batch operations
- `src/actions/keys.ts` - Key batch operations

**UI Components**:
- `src/app/[locale]/settings/data/page.tsx` - Data management settings page
- `src/app/[locale]/settings/data/_components/database-import.tsx` - Import UI component
- `src/app/[locale]/settings/data/_components/database-export.tsx` - Export UI component
- `src/app/[locale]/settings/data/_components/database-status.tsx` - Database status display
- `src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-dialog.tsx` - User/key batch edit dialog
- `src/app/[locale]/settings/providers/_components/batch-edit/provider-batch-dialog.tsx` - Provider batch dialog

### Key Type Definitions

**Database Backup Types** (verified from `src/types/database-backup.ts`):
```typescript
interface DatabaseStatus {
  isAvailable: boolean;
  containerName: string;
  databaseName: string;
  databaseSize: string;
  tableCount: number;
  postgresVersion: string;
  error?: string;
}

interface ImportProgressEvent {
  type: "progress" | "complete" | "error";
  message: string;
  exitCode?: number;
}
```

**Price Table Types** (verified from `src/types/model-price.ts`):
```typescript
interface ModelPriceData {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  input_cost_per_request?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
  // ... additional fields
}

interface PriceUpdateResult {
  added: string[];
  updated: string[];
  unchanged: string[];
  failed: string[];
  total: number;
  skippedConflicts?: string[];
}
```

### Batch Operation Interfaces (CORRECTED)

**Provider Batch Update** (verified from `src/actions/providers.ts`):
```typescript
interface BatchUpdateProvidersParams {
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

**User Batch Update** (verified from `src/actions/users.ts` lines 73-84):
```typescript
interface BatchUpdateUsersParams {
  userIds: number[];
  updates: {
    note?: string;
    tags?: string[];
    rpm?: number | null;
    dailyQuota?: number | null;
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
  };
}
```

**Key Batch Update** (verified from `src/actions/keys.ts` lines 61-72):
```typescript
interface BatchUpdateKeysParams {
  keyIds: number[];
  updates: {
    providerGroup?: string | null;
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    canLoginWebUi?: boolean;
    isEnabled?: boolean;
  };
}
```

### Constants and Limits (CORRECTED)

**Batch Operation Limits**:
- Provider batch: 500 items max (`BATCH_OPERATION_MAX_SIZE` in providers.ts line 1004)
- User batch: 500 items max (`MAX_BATCH_SIZE` in users.ts line 614)
- Key batch: 500 items max (`MAX_BATCH_SIZE` in keys.ts line 868)

**File Limits**:
- Import file max size: 500MB (`MAX_FILE_SIZE`)
- Supported format: `.dump` (PostgreSQL custom format)

**Lock Configuration**:
- Lock TTL: 5 minutes (`LOCK_TTL`)
- Lock key: `"database:backup:lock"`

**Temp File Configuration**:
- Cleanup interval: 1 hour (default)
- Max age before cleanup: 6 hours (default)
- Path pattern: `/tmp/database_${purpose}_${timestamp}_${random}.dump`

---

## Summary

The claude-code-hub data import/export system provides comprehensive functionality for:

1. **Full Database Backup/Restore**: Using PostgreSQL's native pg_dump/pg_restore tools with streaming support
2. **Price Table Management**: JSON/TOML format support with cloud synchronization
3. **Bulk Administrative Operations**: Batch updates for users, keys, and providers with transaction safety
4. **Safety Mechanisms**: Distributed locking, request cancellation handling, error classification, and validation

The system prioritizes data integrity through:
- Atomic transactions for batch operations
- Distributed locks preventing concurrent modifications
- Comprehensive validation before destructive operations
- Automatic cleanup of temporary resources
- Graceful degradation when Redis is unavailable

All import/export operations are restricted to admin users and include detailed logging for audit purposes.
