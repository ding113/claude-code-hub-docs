# 数据导入导出 - Round 1 Exploration Draft

## Intent Analysis

The data import/export functionality in claude-code-hub serves multiple critical purposes:

1. **Database Backup and Recovery**: Administrators need to create full database backups for disaster recovery, migration to new environments, or creating snapshots before major changes.

2. **Data Portability**: The system supports exporting usage logs to CSV format for external analysis, reporting, and integration with third-party tools.

3. **Session Debugging**: Developers can export session request details as JSON for debugging API interactions and analyzing request/response patterns.

4. **Data Migration**: Webhook configuration migration tools help transition from legacy single-URL configurations to the new multi-target webhook system.

5. **Log Management**: Manual log cleanup functionality allows administrators to purge old logs while retaining statistics, helping manage database size.

## Behavior Summary

### 1. Database Backup Export

The database export functionality provides a complete PostgreSQL database backup using `pg_dump` in custom format.

**Key Features:**
- **Admin-only access**: Only users with `admin` role can initiate exports
- **Concurrent operation protection**: Distributed locking prevents multiple simultaneous backup operations
- **Streaming response**: Large backups are streamed directly to the client without buffering in memory
- **Exclude logs option**: Can exclude `message_request` table data while preserving structure
- **Automatic filename generation**: Files are named with timestamp and optional suffix (e.g., `backup_2025-01-28T10-30-00_no-logs.dump`)

**API Endpoint**: `GET /api/admin/database/export?excludeLogs=true`

**Response Format**: `application/octet-stream` (PostgreSQL custom format dump file)

**Implementation Flow**:
1. Validate admin session via `getSession()`
2. Acquire backup lock via `acquireBackupLock("export")`
3. Check database connection via `checkDatabaseConnection()`
4. Execute `pg_dump` via `executePgDump(excludeLogs)`
5. Stream response with monitored wrapper to ensure lock release
6. Generate filename with timestamp
7. Return file with `Content-Disposition: attachment` header

### 2. Database Import/Restore

The database import functionality allows administrators to restore from a `.dump` file using `pg_restore`.

**Key Features:**
- **Admin-only access**: Strict role-based access control
- **File validation**: Only `.dump` files accepted, max 500MB
- **Progress streaming**: Real-time progress via Server-Sent Events (SSE)
- **Import modes**: 
  - Clean mode (`cleanFirst=true`): Drops existing objects before restore
  - Merge mode (`cleanFirst=false`): Attempts to merge with existing data
- **Skip logs option**: Can exclude `message_request` data during import
- **Automatic migrations**: Runs database migrations after successful restore
- **Smart error handling**: Distinguishes between fatal errors and ignorable errors (e.g., "already exists")

**API Endpoint**: `POST /api/admin/database/import`

**Request Format**: `multipart/form-data`
- `file`: Backup file (.dump format)
- `cleanFirst`: 'true' | 'false' (clear existing data)
- `skipLogs`: 'true' | 'false' (skip message_request data)

**Response Format**: `text/event-stream` (SSE)

**SSE Event Types**:
- `progress`: Ongoing restore progress messages
- `complete`: Restore completed successfully
- `error`: Fatal error occurred

**Implementation Flow**:
1. Validate admin session
2. Parse and validate form data (file type, size)
3. Acquire backup lock
4. Check database connection
5. Save uploaded file to temp directory
6. Execute `pg_restore` with progress streaming
7. Run automatic migrations if restore succeeds
8. Clean up temp file and release lock

### 3. Usage Logs CSV Export

Export filtered usage logs to CSV format for external analysis.

**Key Features:**
- **Role-based filtering**: Admins see all logs; regular users see only their own
- **Filter support**: All filter parameters from the logs UI are supported
- **Large dataset support**: Exports up to 10,000 records per request
- **Security features**: CSV formula injection prevention
- **Excel compatibility**: UTF-8 BOM header for proper character encoding

**CSV Columns**:
1. Time (ISO 8601 format)
2. User
3. Key
4. Provider
5. Model
6. Original Model
7. Endpoint
8. Status Code
9. Input Tokens
10. Output Tokens
11. Cache Write 5m
12. Cache Write 1h
13. Cache Read
14. Total Tokens
15. Cost (USD)
16. Duration (ms)
17. Session ID
18. Retry Count

**Security Measures**:
```typescript
function escapeCsvField(field: string): string {
  // Prevent CSV formula injection by prefixing dangerous characters
  const dangerousChars = ["=", "+", "-", "@", "\t", "\r"];
  let safeField = field;
  if (dangerousChars.some((char) => field.startsWith(char))) {
    safeField = `'${field}`; // Prefix with single quote to prevent formula execution
  }

  if (safeField.includes(",") || safeField.includes('"') || safeField.includes("\n")) {
    return `"${safeField.replace(/"/g, '""')}"`;
  }
  return safeField;
}
```

**Implementation** (`/Users/ding/Github/claude-code-hub/src/actions/usage-logs.ts`):
```typescript
export async function exportUsageLogs(
  filters: Omit<UsageLogFilters, "userId" | "page" | "pageSize">
): Promise<ActionResult<string>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "未登录" };
  }

  // Role-based filtering
  const finalFilters: UsageLogFilters =
    session.user.role === "admin"
      ? { ...filters, page: 1, pageSize: 10000 }
      : { ...filters, userId: session.user.id, page: 1, pageSize: 10000 };

  const result = await findUsageLogsWithDetails(finalFilters);
  const csv = generateCsv(result.logs);
  return { ok: true, data: csv };
}
```

### 4. Session Request JSON Export

Export individual session request details as formatted JSON for debugging.

**Export Data Structure**:
```json
{
  "sessionId": "string",
  "sequence": number,
  "meta": {
    "clientUrl": "string | null",
    "upstreamUrl": "string | null",
    "method": "string | null"
  },
  "headers": { "key": "value" },
  "body": {},
  "specialSettings": {}
}
```

**File Naming**: `session-{sessionId-prefix}[-seq-{sequence}]-request.json`

**Implementation** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/sessions/[sessionId]/messages/_components/session-messages-client.tsx`):
```typescript
const getRequestExportJson = () => {
  return JSON.stringify(
    {
      sessionId,
      sequence: exportSequence,
      meta: requestMeta,
      headers: requestHeaders,
      body: requestBody,
      specialSettings,
    },
    null,
    2
  );
};

const handleDownloadRequest = () => {
  if (!canExportRequest) return;
  const jsonStr = getRequestExportJson();
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const seqPart = exportSequence !== null ? `-seq-${exportSequence}` : "";
  a.download = `session-${sessionId.substring(0, 8)}${seqPart}-request.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
```

### 5. Database Status Monitoring

Real-time database connection and statistics monitoring.

**Status Information**:
- Connection availability
- Container/host name
- Database name
- Database size (human-readable)
- Table count
- PostgreSQL version

**API Endpoint**: `GET /api/admin/database/status`

**Response Type**: `DatabaseStatus`
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
```

### 6. Log Cleanup

Manual cleanup of old log records with preview functionality.

**Features**:
- Time range selection (7, 30, 90, 180 days)
- Dry-run preview showing count of records to be deleted
- Batch deletion for large datasets
- Statistics retention (only message_request records are deleted)

**API Endpoint**: `POST /api/admin/log-cleanup/manual`

**Request Body**:
```json
{
  "beforeDate": "ISO 8601 timestamp",
  "dryRun": true | false
}
```

## Config/Commands

### Environment Variables

**Database Connection** (`/Users/ding/Github/claude-code-hub/src/lib/database-backup/db-config.ts`):
```typescript
export function getDatabaseConfig(): DatabaseConfig {
  const dsn = process.env.DSN;
  if (!dsn) {
    throw new Error("DSN environment variable is not set");
  }
  return parseDatabaseDSN(dsn);
}
```

The DSN format follows PostgreSQL standard:
```
postgresql://user:password@host:port/database
```

**Configuration Interface**:
```typescript
interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}
```

### pg_dump Arguments

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

### pg_restore Arguments

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

### Backup Lock Configuration

```typescript
const LOCK_KEY = "database:backup:lock";
const LOCK_TTL = 5 * 60 * 1000; // 5 minutes
```

### File Size Limits

```typescript
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
```

### Temp File Configuration

```typescript
function generateTempFilePath(purpose: "import" | "export"): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `/tmp/database_${purpose}_${timestamp}_${random}.dump`;
}
```

## Edge Cases

### 1. Concurrent Backup Operations

**Scenario**: Two administrators attempt to export/import simultaneously.

**Handling**: Distributed locking via Redis (with in-memory fallback) prevents concurrent operations. The second request receives HTTP 409 with error message:
```json
{
  "error": "其他管理员正在执行备份操作，请稍后重试",
  "details": "为确保数据一致性，同一时间只能执行一个备份操作"
}
```

**Lock Implementation** (`/Users/ding/Github/claude-code-hub/src/lib/database-backup/backup-lock.ts`):
- Uses Redis with Lua scripts for atomic operations when available
- Falls back to in-memory Map for single-instance deployments
- 5-minute TTL prevents indefinite locks from crashed processes
- Lock ID ensures only the owner can release the lock

### 2. Database Connection Unavailable

**Scenario**: Database is down or unreachable during export/import.

**Handling**:
1. Connection check via `pg_isready` before operation
2. HTTP 503 response if unavailable
3. Automatic lock release to prevent deadlock
4. Detailed logging for troubleshooting

### 3. Large File Uploads

**Scenario**: User attempts to upload a backup file larger than 500MB.

**Handling**:
- File size validation before processing
- HTTP 413 (Payload Too Large) response
- Detailed error message showing actual vs. limit size

### 4. Invalid File Format

**Scenario**: User uploads a non-.dump file.

**Handling**:
- Extension validation (must end with `.dump`)
- HTTP 400 response with clear error message

### 5. Import with Existing Data

**Scenario**: Importing into a database that already has data.

**Options**:
- **Clean mode** (`cleanFirst=true`): Drops existing objects before restore. Uses `--clean --if-exists --no-owner` flags.
- **Merge mode** (`cleanFirst=false`): Attempts to merge. May result in "already exists" errors which are classified as ignorable.

**Error Classification** (`/Users/ding/Github/claude-code-hub/src/lib/database-backup/docker-executor.ts`):
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

### 6. Request Cancellation

**Scenario**: User closes browser or navigates away during import.

**Handling**:
- AbortSignal listener on the request
- Cleanup of temporary files
- Lock release
- Process termination via `pgProcess.kill()`

### 7. Temporary File Leaks

**Scenario**: Process crashes before cleaning up temp files.

**Handling** (`/Users/ding/Github/claude-code-hub/src/lib/database-backup/temp-file-manager.ts`):
- In-memory tracking of all active temp files
- Periodic cleanup task (runs every hour, cleans files older than 6 hours)
- Cleanup on stream completion, error, or abort

### 8. CSV Formula Injection

**Scenario**: Exported data contains malicious formulas (e.g., `=CMD|' /C calc'!A0`).

**Handling**:
- Prefix dangerous characters (`=`, `+`, `-`, `@`, tab, carriage return) with single quote
- Proper CSV escaping for quotes and newlines

### 9. Redis Unavailability

**Scenario**: Redis is down in a multi-instance deployment.

**Handling**:
- "Fail Open" strategy: Falls back to in-memory locking
- Single-instance deployments remain safe
- Multi-instance deployments may have race conditions but operations continue

### 10. Schema Version Mismatch

**Scenario**: Restoring a backup from an older schema version.

**Handling**:
- Automatic migration execution after successful restore
- Uses existing `runMigrations()` function
- Progress reported via SSE stream

### 11. Partial Import Failures

**Scenario**: Import fails partway through (e.g., disk full, network error).

**Handling**:
- pg_restore exit code analysis
- Fatal errors vs. ignorable errors classification
- Detailed error reporting with specific failure reasons
- Database may be in partially restored state (manual intervention required)

### 12. Browser Download Interruption

**Scenario**: Large export download interrupted by network issues.

**Handling**:
- Streaming response allows resuming (depending on browser)
- Lock released on stream cancellation
- No server-side state maintained after stream ends

## References

### Core Files

**Database Backup/Restore**:
- `/Users/ding/Github/claude-code-hub/src/app/api/admin/database/export/route.ts` - Export API endpoint
- `/Users/ding/Github/claude-code-hub/src/app/api/admin/database/import/route.ts` - Import API endpoint
- `/Users/ding/Github/claude-code-hub/src/app/api/admin/database/status/route.ts` - Status API endpoint
- `/Users/ding/Github/claude-code-hub/src/lib/database-backup/docker-executor.ts` - pg_dump/pg_restore execution
- `/Users/ding/Github/claude-code-hub/src/lib/database-backup/backup-lock.ts` - Distributed locking
- `/Users/ding/Github/claude-code-hub/src/lib/database-backup/temp-file-manager.ts` - Temporary file management
- `/Users/ding/Github/claude-code-hub/src/lib/database-backup/db-config.ts` - Database configuration

**UI Components**:
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/data/page.tsx` - Data management page
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/data/_components/database-export.tsx` - Export UI
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/data/_components/database-import.tsx` - Import UI
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/data/_components/database-status.tsx` - Status display
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/data/_components/log-cleanup-panel.tsx` - Log cleanup UI

**CSV Export**:
- `/Users/ding/Github/claude-code-hub/src/actions/usage-logs.ts` - Usage logs actions including export
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/logs/_components/usage-logs-filters.tsx` - Logs filter UI with export button

**JSON Export**:
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/sessions/[sessionId]/messages/_components/session-messages-client.tsx` - Session request export

**Types**:
- `/Users/ding/Github/claude-code-hub/src/types/database-backup.ts` - Database backup types

**Data Generator** (Internal Tool):
- `/Users/ding/Github/claude-code-hub/src/lib/data-generator/generator.ts` - Synthetic log generation
- `/Users/ding/Github/claude-code-hub/src/lib/data-generator/types.ts` - Generator types

**Migration**:
- `/Users/ding/Github/claude-code-hub/src/lib/webhook/migration.ts` - Webhook configuration migration

### PostgreSQL Tools Documentation

- `pg_dump`: https://www.postgresql.org/docs/current/app-pgdump.html
- `pg_restore`: https://www.postgresql.org/docs/current/app-pgrestore.html
- `pg_isready`: https://www.postgresql.org/docs/current/app-pg-isready.html
- Custom Format: Compressed binary format specific to PostgreSQL

### Security Considerations

1. **Authentication**: All import/export endpoints require valid admin session
2. **Authorization**: Role-based access control (`session.user.role !== "admin"`)
3. **Input Validation**: File type, size, and format validation
4. **CSRF Protection**: Cookie-based session authentication
5. **CSV Injection Prevention**: Dangerous character prefixing
6. **Lock Safety**: Lua scripts ensure atomic lock operations in Redis

### Performance Considerations

1. **Streaming**: Large exports use ReadableStream to minimize memory usage
2. **Batch Processing**: Log cleanup uses batch deletion for large datasets
3. **Caching**: Filter options cached for 5 minutes to reduce DISTINCT queries
4. **Pagination**: CSV export limited to 10,000 records per request
5. **Lock TTL**: 5-minute expiration prevents indefinite blocking

---

*This is a Round 1 exploration draft. All file paths and code snippets are from the actual claude-code-hub implementation at `/Users/ding/Github/claude-code-hub/`.*
