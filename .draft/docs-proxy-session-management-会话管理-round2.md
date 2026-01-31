# Session Management Implementation Report

## Intent Analysis

The session management system in claude-code-hub is designed to solve several critical problems in AI proxy services:

1. **Session Stickiness**: Ensuring consecutive requests from the same conversation are routed to the same AI provider, maximizing cache hit rates and reducing costs
2. **Concurrent Request Handling**: Managing multiple simultaneous requests from the same session to prevent race conditions and ensure consistent behavior
3. **Request Tracking**: Recording the complete lifecycle of a session for debugging, monitoring, and cost analysis
4. **Provider Failover**: Maintaining session continuity when providers fail, with intelligent rebinding strategies

The system implements a 5-minute sliding window TTL (Time To Live) caching mechanism that balances between:
- **Cache efficiency**: Long enough to benefit from prompt caching across multiple turns
- **Resource cleanup**: Short enough to prevent memory leaks in Redis
- **Failover responsiveness**: Quick enough to allow session migration when providers fail

## Behavior Summary

### Session Identification

The system identifies sessions through a multi-layered approach defined in `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts`:

1. **Client-provided Session ID** (Primary): Extracted from `metadata.user_id` (Claude Code format: `{user}_session_{sessionId}`) or `metadata.session_id`
2. **Codex Session Extraction**: For OpenAI/Codex requests, extracts session identifiers from headers/body
3. **Content Hash Fallback**: Computes SHA-256 hash of messages as fallback (with warnings about reliability)
4. **Deterministic Session ID**: Generated from request fingerprint (API Key prefix + User-Agent + Client IP) when no client session is provided
5. **Generated Session ID**: Format: `sess_{timestamp}_{random}` as last resort

### Session Lifecycle

```
Request Arrives
    ↓
SessionGuard.ensure() [src/app/v1/_lib/proxy/session-guard.ts:43]
    ↓
Extract/Generate Session ID
    ↓
Get/Create Session ID with concurrency check
    ↓
Track Session (Redis ZSET)
    ↓
Store Session Info
    ↓
Bind to Provider (after successful request)
    ↓
TTL Refresh (sliding window on each request)
```

### Short Context Detection (Concurrent Session Handling)

A sophisticated mechanism to handle concurrent short-context requests:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:349-366
if (messagesLength <= SHORT_CONTEXT_THRESHOLD) {
  const concurrentCount = await SessionTracker.getConcurrentCount(clientSessionId);
  if (concurrentCount > 0) {
    // Force new session for concurrent short tasks
    return generateSessionId();
  }
}
```

**Logic**:
- **Scenario A**: Short context + no concurrent requests → Allow reuse (likely start of long conversation)
- **Scenario B**: Short context + concurrent requests → Force new session (concurrent short tasks)

## Configuration

### Environment Variables

| Variable | Default | Description | Location |
|----------|---------|-------------|----------|
| `SESSION_TTL` | `300` (5 minutes) | Session expiration time in seconds | `/Users/ding/Github/claude-code-hub/.env.example:62` |
| `STORE_SESSION_MESSAGES` | `false` | Store message content (true) or redacted ([REDACTED]) | `/Users/ding/Github/claude-code-hub/.env.example:63` |
| `SHORT_CONTEXT_THRESHOLD` | `2` | Message count threshold for short context detection | `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:89` |
| `ENABLE_SHORT_CONTEXT_DETECTION` | `true` | Enable concurrent short task detection | `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:92` |

### Configuration Schema

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts:96,100
SESSION_TTL: z.coerce.number().default(300),
STORE_SESSION_MESSAGES: z.string().default("false").transform(booleanTransform),
```

## Core Components

### 1. SessionManager Class

**File**: `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts`

Core responsibilities:
- Session ID generation and extraction
- Session-to-provider binding management
- Session data persistence to Redis
- Request sequence tracking

Key methods:

```typescript
// Session ID extraction (lines 111-165)
static extractClientSessionId(requestMessage, headers, userAgent): string | null

// Get or create session with concurrency awareness (lines 331-440)
static async getOrCreateSessionId(keyId, messages, clientSessionId): Promise<string>

// Bind session to provider (lines 509-536)
static async bindSessionToProvider(sessionId, providerId): Promise<void>

// Smart binding with failover support (lines 608-782)
static async updateSessionBindingSmart(sessionId, newProviderId, ...): Promise<BindingResult>

// Get next request sequence (lines 186-223)
static async getNextRequestSequence(sessionId): Promise<number>
```

### 2. SessionTracker Class

**File**: `/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts`

Manages active session collections using Redis Sorted Sets (ZSET):

```typescript
// Track session in global and scoped collections (lines 66-97)
static async trackSession(sessionId, keyId, userId): Promise<void>

// Track provider binding (lines 107-147)
static async trackProviderBinding(sessionId, providerId): Promise<void>

// Concurrent request counting (lines 561-684)
static async incrementConcurrentCount(sessionId): Promise<void>
static async decrementConcurrentCount(sessionId): Promise<void>
static async getConcurrentCount(sessionId): Promise<number>
```

**Redis Key Patterns**:
- `global:active_sessions` - All active sessions (ZSET)
- `key:${keyId}:active_sessions` - Sessions per API key
- `provider:${providerId}:active_sessions` - Sessions per provider
- `user:${userId}:active_sessions` - Sessions per user
- `session:${sessionId}:concurrent_count` - Concurrent request counter

### 3. ProxySessionGuard

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session-guard.ts`

Orchestrates session assignment during request processing:

```typescript
// Main entry point (lines 43-179)
static async ensure(session: ProxySession): Promise<void> {
  // 1. Extract client session ID
  // 2. Get messages array
  // 3. Get or create session ID
  // 4. Set session ID and request sequence
  // 5. Track session
  // 6. Store session info to Redis
}
```

### 4. ProxySession Class

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts`

Encapsulates all request-scoped state:

```typescript
class ProxySession {
  sessionId: string | null;
  requestSequence: number;
  providerChain: ProviderChainItem[];
  
  // Decision chain tracking (lines 447-516)
  addProviderToChain(provider, metadata): void
  getProviderChain(): ProviderChainItem[]
  
  // Deterministic session ID generation (lines 365-384)
  generateDeterministicSessionId(): string | null
}
```

## Session Binding to Providers

### Binding Strategy

The system uses a sophisticated binding strategy defined in `updateSessionBindingSmart()`:

**First Success** (lines 622-651):
```typescript
// Use SET NX to ensure only first binding wins
const result = await redis.set(key, providerId, "EX", SESSION_TTL, "NX");
```

**Failover Success** (lines 705-736):
- If current provider not found (deleted), update to new provider
- If new provider has higher priority, update binding
- If current provider is unhealthy (circuit open), allow update

**Codex Session Binding** (lines 1852-1882):
```typescript
// Use prompt_cache_key from Codex response as session ID
const codexSessionId = `codex_${promptCacheKey}`;
```

### Redis Binding Keys

```
session:{sessionId}:provider → providerId (TTL: SESSION_TTL)
session:{sessionId}:key → keyId
session:{sessionId}:last_seen → timestamp
session:{sessionId}:info → Hash with metadata
```

## Redis Session Storage

### Data Structures

**Session Info Hash** (`session:{sessionId}:info`):
```typescript
{
  userName: string;
  userId: string;
  keyId: string;
  keyName: string;
  model: string;
  apiType: "chat" | "codex";
  startTime: string;
  status: "in_progress" | "completed" | "error";
}
```

**Session Messages** (lines 951-973):
```typescript
// New format: per-request storage
session:{sessionId}:req:{sequence}:messages

// Legacy format
session:{sessionId}:messages
```

**Session Response** (lines 1343-1390):
```typescript
session:{sessionId}:req:{sequence}:response
```

**Session Usage Stats** (lines 875-930):
```typescript
session:{sessionId}:usage → Hash with token counts, costs, timing
```

### Request Sequence Tracking

Each request within a session gets a unique sequence number:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:186-223
static async getNextRequestSequence(sessionId): Promise<number> {
  const key = `session:${sessionId}:seq`;
  const sequence = await redis.incr(key);
  if (sequence === 1) {
    await redis.expire(key, SESSION_TTL);
  }
  return sequence;
}
```

## Concurrent Session Control

### Implementation

**Increment** (at request start in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy-handler.ts:64`):
```typescript
await SessionTracker.incrementConcurrentCount(sessionId);
```

**Decrement** (at request end in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy-handler.ts:98`):
```typescript
await SessionTracker.decrementConcurrentCount(sessionId);
```

**Redis Key**:
```
session:{sessionId}:concurrent_count → integer (TTL: 10 minutes)
```

Note: The concurrent count TTL is 10 minutes (600 seconds), which is longer than the session TTL (5 minutes) to prevent counter leaks.

### Provider-Level Concurrent Limits

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts:286-290
const checkResult = await RateLimitService.checkAndTrackProviderSession(
  provider.id,
  session.sessionId,
  limit
);
```

## Decision Chain Recording

### ProviderChainItem Structure

**File**: `/Users/ding/Github/claude-code-hub/src/types/message.ts:10-182`

```typescript
interface ProviderChainItem {
  id: number;
  name: string;
  vendorId?: number;
  providerType?: ProviderType;
  endpointId?: number | null;
  endpointUrl?: string;
  
  // Decision metadata
  reason?: "session_reuse" | "initial_selection" | "concurrent_limit_failed" |
           "request_success" | "retry_success" | "retry_failed" | ...;
  selectionMethod?: "session_reuse" | "weighted_random" | "group_filtered";
  priority?: number;
  weight?: number;
  circuitState?: "closed" | "open" | "half-open";
  circuitFailureCount?: number;
  circuitFailureThreshold?: number;
  
  // Error tracking
  errorMessage?: string;
  statusCode?: number;
  errorDetails?: {
    provider?: { id, name, statusCode, statusText, upstreamBody, upstreamParsed };
    system?: { errorType, errorName, errorMessage, errorCode, errorSyscall, errorStack };
    clientError?: string;
    matchedRule?: { ruleId, pattern, matchType, category, description };
    request?: { url, method, headers, body, bodyTruncated };
  };
  
  // Decision context
  decisionContext?: {
    totalProviders: number;
    enabledProviders: number;
    targetType: "claude" | "codex" | "openai-compatible" | "gemini" | "gemini-cli";
    requestedModel?: string;
    groupFilterApplied: boolean;
    beforeHealthCheck: number;
    afterHealthCheck: number;
    priorityLevels: number[];
    selectedPriority: number;
    candidatesAtPriority: Array<{ id, name, weight, costMultiplier, probability }>;
    filteredProviders?: Array<{ id, name, reason, details }>;
    concurrentLimit?: number;
    currentConcurrent?: number;
  };
  
  timestamp?: number;
  attemptNumber?: number;
}
```

### Recording Points

1. **Session Reuse** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts:228-230`):
```typescript
session.addProviderToChain(reusedProvider, {
  reason: "session_reuse",
  selectionMethod: "session_reuse"
});
```

2. **Initial Selection** (lines 369-391):
```typescript
session.addProviderToChain(session.provider, {
  reason: "initial_selection",
  selectionMethod: successContext?.groupFilterApplied ? "group_filtered" : "weighted_random"
});
```

3. **Retry/Failover** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:476-486`):
```typescript
session.addProviderToChain(currentProvider, {
  ...endpointAudit,
  reason: totalProvidersAttempted === 1 && attemptCount === 1 ? "request_success" : "retry_success",
  attemptNumber: attemptCount,
  statusCode: response.status,
  circuitState: getCircuitState(currentProvider.id),
});
```

### Database Storage

Decision chain is stored in `message_request.provider_chain` (JSONB column):

**File**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts:388`
```typescript
providerChain: jsonb('provider_chain').$type<Array<{ id: number; name: string }>>()
```

## Edge Cases

### 1. Redis Unavailable (Fail-Open)

All Redis operations gracefully degrade:
```typescript
const redis = getRedisClient();
if (!redis || redis.status !== "ready") {
  return; // Fail open - don't block requests
}
```

### 2. Concurrent Session Binding Race Condition

Using Redis SET NX (Not Exists) ensures atomic first-binding-wins:
```typescript
const result = await redis.set(key, providerId, "EX", SESSION_TTL, "NX");
if (result !== "OK") {
  // Another request already bound, skip
}
```

### 3. Short Context Concurrency Detection

Prevents cache pollution from concurrent short tasks:
```typescript
if (messagesLength <= 2 && concurrentCount > 0) {
  return generateSessionId(); // Force new session
}
```

### 4. Codex Session Completion

Special handling for Codex's prompt_cache_key:
```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:1854
const codexSessionId = `codex_${promptCacheKey}`;
```

### 5. Session TTL Refresh

Sliding window TTL on every request:
```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:489-493
pipeline.expire(`session:${sessionId}:key`, SessionManager.SESSION_TTL);
pipeline.expire(`session:${sessionId}:provider`, SessionManager.SESSION_TTL);
pipeline.setex(`session:${sessionId}:last_seen`, SessionManager.SESSION_TTL, Date.now().toString());
```

### 6. Request Sequence Fallback

When Redis is unavailable, a fallback sequence is generated:
```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:189-196
const fallbackSeq = (Date.now() % 1000000) + Math.floor(Math.random() * 1000);
return fallbackSeq;
```

## Key Source Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts` | Core session management logic |
| `/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts` | Active session tracking with ZSET |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session-guard.ts` | Session assignment during request processing |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` | ProxySession class with provider chain |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts` | Provider selection with session reuse |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` | Request forwarding with binding updates |
| `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` | Environment variable schema |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/client.ts` | Redis client initialization |
| `/Users/ding/Github/claude-code-hub/src/types/message.ts` | ProviderChainItem type definition |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema with session fields |

## References

- **Session TTL**: 5 minutes (300 seconds) default, configurable via `SESSION_TTL`
- **Concurrent Count TTL**: 10 minutes (prevents counter leaks)
- **Active Sessions ZSET TTL**: 1 hour (cleanup safety margin)
- **Short Context Threshold**: 2 messages (`SHORT_CONTEXT_THRESHOLD`)
- **Redis Key Prefixes**: `session:`, `hash:`, `key:`, `provider:`, `user:`, `global:`
