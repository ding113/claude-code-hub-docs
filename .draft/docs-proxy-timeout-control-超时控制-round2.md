# Timeout Control Implementation Analysis Report

## Intent Analysis

The timeout control system in claude-code-hub is designed to handle LLM API proxy requests with robust timeout management across multiple layers. The primary intent is to:

1. **Prevent request hanging**: Ensure requests don't wait indefinitely for slow or unresponsive LLM providers
2. **Enable fast failover**: Quickly detect provider issues and switch to alternative providers
3. **Support streaming responses**: Handle long-running stream connections with idle detection
4. **Provide granular control**: Allow per-provider timeout configuration for different use cases

## Behavior Summary

### Dual-Path Timeout Control

The system implements a sophisticated dual-path timeout mechanism in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`:

**For Streaming Requests:**
- Uses `firstByteTimeoutStreamingMs` - controls how long to wait for the first byte of response
- This enables quick failover when a provider is slow to respond

**For Non-Streaming Requests:**
- Uses `requestTimeoutNonStreamingMs` - controls total request timeout
- Prevents long-running requests from hanging indefinitely

### Streaming Idle Timeout (Silent Period Watchdog)

Implemented in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts`:

- Monitors stream for idle periods using `streamingIdleTimeoutMs`
- Resets timer on each data chunk received
- Triggers three actions on timeout:
  1. Closes client stream with error notification
  2. Aborts upstream connection to prevent resource leaks
  3. Terminates background reading task

## Configuration

### Environment Variables

Located in `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` and `.env.example`:

```
# Fetch connection timeout (TCP handshake, DNS, TLS)
FETCH_CONNECT_TIMEOUT=30000        # Default: 30 seconds

# Fetch headers timeout (waiting for response headers/first byte)
FETCH_HEADERS_TIMEOUT=600000       # Default: 600 seconds

# Fetch body timeout (request/response body transfer)
FETCH_BODY_TIMEOUT=600000          # Default: 600 seconds

# API test timeout
API_TEST_TIMEOUT_MS=15000          # Default: 15 seconds, range 5000-120000
```

### Provider-Level Timeout Configuration

Defined in `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts`:

```typescript
export const PROVIDER_TIMEOUT_LIMITS = {
  // First byte timeout for streaming: 1-180 seconds
  FIRST_BYTE_TIMEOUT_STREAMING_MS: { MIN: 1000, MAX: 180000 },
  
  // Streaming idle timeout: 60-600 seconds
  STREAMING_IDLE_TIMEOUT_MS: { MIN: 60000, MAX: 600000 },
  
  // Non-streaming total timeout: 60-1800 seconds
  REQUEST_TIMEOUT_NON_STREAMING_MS: { MIN: 60000, MAX: 1800000 },
} as const;

export const PROVIDER_TIMEOUT_DEFAULTS = {
  FIRST_BYTE_TIMEOUT_STREAMING_MS: 0,    // 0 = no limit
  STREAMING_IDLE_TIMEOUT_MS: 0,          // 0 = no limit
  REQUEST_TIMEOUT_NON_STREAMING_MS: 0,   // 0 = no limit
} as const;
```

### Database Schema

Provider timeout fields in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`:

```typescript
// Timeout configuration (milliseconds)
firstByteTimeoutStreamingMs: integer('first_byte_timeout_streaming_ms').notNull().default(0),
streamingIdleTimeoutMs: integer('streaming_idle_timeout_ms').notNull().default(0),
requestTimeoutNonStreamingMs: integer('request_timeout_non_streaming_ms').notNull().default(0),
```

## API Test Timeout Settings

Located in `/Users/ding/Github/claude-code-hub/src/actions/providers.ts`:

```typescript
const API_TEST_TIMEOUT_LIMITS = {
  DEFAULT: 15000,
  MIN: 5000,
  MAX: 120000,
} as const;

const API_TEST_CONFIG = {
  TIMEOUT_MS: resolveApiTestTimeoutMs(),  // From env or default 15000ms
  GEMINI_TIMEOUT_MS: 60000,               // Gemini 3 has thinking feature, needs longer timeout
  MAX_RESPONSE_PREVIEW_LENGTH: 500,
  TEST_MAX_TOKENS: 100,
  TEST_PROMPT: "Hello",
  MAX_STREAM_CHUNKS: 1000,                // DoS protection
  MAX_STREAM_BUFFER_SIZE: 10 * 1024 * 1024,  // 10MB
  MAX_STREAM_ITERATIONS: 10000,
} as const;
```

The `resolveApiTestTimeoutMs()` function reads from `API_TEST_TIMEOUT_MS` environment variable with validation for range 5000-120000ms.

## Request/Response Timeout Handling

### Global undici Configuration

In `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent.ts`:

```typescript
setGlobalDispatcher(
  new Agent({
    connectTimeout,      // TCP connection timeout (FETCH_CONNECT_TIMEOUT)
    headersTimeout,      // Response headers timeout (FETCH_HEADERS_TIMEOUT)
    bodyTimeout,         // Body transfer timeout (FETCH_BODY_TIMEOUT)
  })
);
```

This overrides undici's default 300-second timeout to support LLM long-running requests.

### Request Forwarding Timeout Logic

In `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` (lines 1500-1538):

1. Creates `AbortController` for timeout management
2. Sets timeout based on request type (streaming vs non-streaming)
3. Combines timeout signal with client abort signal
4. Clears timeout when response handler receives first byte

## Streaming Timeout Handling

### Idle Timer Implementation

In `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts` (lines 802-862):

```typescript
const idleTimeoutMs = provider.streamingIdleTimeoutMs > 0 
  ? provider.streamingIdleTimeoutMs 
  : Infinity;

const startIdleTimer = () => {
  if (idleTimeoutMs === Infinity) return;
  clearIdleTimer();
  idleTimeoutId = setTimeout(() => {
    // 1. Close client stream
    // 2. Abort upstream connection
    // 3. Abort background reading task
  }, idleTimeoutMs);
};
```

The timer resets on every data chunk received (line 1010), ensuring active streams don't timeout.

### Client Disconnect Handling

When client disconnects (lines 1224-1248):
- Idle timer is cleared immediately
- Background task is cancelled
- Upstream connection is left to end naturally

## Timeout Error Responses

### Error Types and Status Codes

In `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`:

**Response Timeout (First Byte):**
- Status Code: 524 (Cloudflare: A Timeout Occurred)
- Error Type: `timeout_error`
- Chinese Message: "供应商首字节响应超时" or "供应商响应超时"
- English Message: "Provider failed to respond within {timeout}ms"

**Streaming Idle Timeout:**
- Status Code: 524
- Error Type: `streaming_idle_timeout`
- Chinese Message: "供应商流式响应静默超时"
- English Message: "Provider stopped sending data for {timeout}ms"

### Error Response Format

```json
{
  "error": {
    "type": "timeout_error",
    "message": "Provider failed to respond within 30000ms",
    "timeout_type": "streaming_first_byte",
    "timeout_ms": 30000
  }
}
```

### Circuit Breaker Integration

Timeout errors are classified as `PROVIDER_ERROR` and:
- Count toward circuit breaker failure threshold
- Trigger automatic provider switching
- Are recorded in failure logs for analysis

## Edge Cases

### 1. Zero Value Means No Timeout
Setting any timeout config to `0` disables that timeout (Infinity behavior).

### 2. Undici Default Timeout Override
The system explicitly configures undici global dispatcher because undici's default 300s timeout would trigger before business-level timeouts.

### 3. Signal Combination
Multiple abort signals are combined using `AbortSignal.any()` (or polyfill) to handle:
- Response timeout
- Client disconnect
- Idle timeout (for streams)

### 4. Gemini Special Handling
Gemini models with thinking capability get 60-second timeout instead of default 15-second for API tests.

### 5. Timeout Override for Endpoint Probing
When an endpoint's last error was timeout, probe interval reduces to 10 seconds for faster recovery detection.

## References

### Key Source Files

1. **Timeout Constants**: `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts`
2. **Environment Schema**: `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts`
3. **Proxy Agent (undici config)**: `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent.ts`
4. **Request Forwarder**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`
5. **Response Handler**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts`
6. **Database Schema**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`
7. **Provider Types**: `/Users/ding/Github/claude-code-hub/src/types/provider.ts`
8. **Validation Schemas**: `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`
9. **API Test Actions**: `/Users/ding/Github/claude-code-hub/src/actions/providers.ts`
10. **Environment Example**: `/Users/ding/Github/claude-code-hub/.env.example`

### External References

- undici timeout issue: https://github.com/nodejs/undici/issues/1373
- Node.js fetch timeout: https://github.com/nodejs/node/issues/46706
- undici discussions on timeout phases: https://github.com/nodejs/undici/discussions/1313

### Test Files

- undici timeout tests: `/Users/ding/Github/claude-code-hub/tests/unit/lib/undici-timeouts.test.ts`
