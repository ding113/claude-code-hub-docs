# 代理配置 - Code Exploration Report (Round 2)

## Intent Analysis

The proxy configuration system in claude-code-hub provides comprehensive HTTP/HTTPS/SOCKS proxy support for connecting to upstream AI providers. This feature is essential for:

1. **Network Security**: Routing traffic through corporate proxies or VPNs
2. **Geographic Distribution**: Accessing providers from different regions
3. **Privacy Protection**: Masking origin IP addresses
4. **Compliance**: Meeting organizational network policies
5. **Reliability**: Fallback mechanisms when proxies fail

The system supports per-provider proxy configuration with authentication, allowing fine-grained control over how each AI provider connection is routed.

## Behavior Summary

### 1. Proxy Configuration Architecture

**Configuration Location**: Provider settings in database (`proxyUrl`, `proxyFallbackToDirect` fields)

**Supported Proxy Types**:
- HTTP proxy (`http://host:port`)
- HTTPS proxy (`https://host:port`)
- SOCKS5 proxy (`socks5://host:port`)
- SOCKS4 proxy (`socks4://host:port`)
- Authenticated proxies (`http://user:pass@host:port`)

**Configuration Flow**:
```
Provider Settings
    ↓
proxyUrl: string | null
proxyFallbackToDirect: boolean (default: false)
    ↓
ProxyAgent Creation (undici/fetch-socks)
    ↓
Request Forwarding with Proxy
    ↓
Fallback to Direct (if enabled and proxy fails)
```

### 2. Proxy Implementation Details

**Core File**: `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent.ts`

The proxy system uses Node.js's `undici` library with `ProxyAgent` for HTTP/HTTPS proxies and `fetch-socks` for SOCKS proxies:

```typescript
import { ProxyAgent } from 'undici';
import { socksDispatcher } from 'fetch-socks';

// HTTP/HTTPS Proxy
function createHttpProxyAgent(proxyUrl: string, enableHttp2: boolean): ProxyAgent {
  return new ProxyAgent({
    uri: proxyUrl,
    allowH2: enableHttp2,
    connectTimeout,
    headersTimeout,
    bodyTimeout,
  });
}

// SOCKS Proxy
function createSocksDispatcher(proxyUrl: string): Dispatcher {
  return socksDispatcher(
    {
      type: parsedProxy.protocol === 'socks5:' ? 5 : 4,
      host: parsedProxy.hostname,
      port: parseInt(parsedProxy.port, 10) || 1080,
      userId: parsedProxy.username || undefined,
      password: parsedProxy.password || undefined,
    },
    {
      connect: { timeout: connectTimeout },
    }
  );
}
```

**Agent Pool for Connection Caching** (`/Users/ding/Github/claude-code-hub/src/lib/proxy-agent/agent-pool.ts`):

The system implements an Agent Pool to:
1. Reuse connections across requests to the same endpoint
2. Isolate connections between different endpoints (prevents SSL certificate issues)
3. Support health management (mark unhealthy on SSL errors)
4. Implement TTL-based expiration and LRU eviction

```typescript
const pool = getGlobalAgentPool();
const { agent, cacheKey } = await pool.getAgent({
  endpointUrl: targetUrl,
  proxyUrl,
  enableHttp2,
});
```

**Request Forwarding with Proxy** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`):

```typescript
const proxyConfig = await getProxyAgentForProvider(provider, proxyUrl, enableHttp2);

if (proxyConfig) {
  init.dispatcher = proxyConfig.agent;
  logger.info('ProxyForwarder: Using proxy', {
    providerId: provider.id,
    proxyUrl: proxyConfig.proxyUrl,
    fallbackToDirect: proxyConfig.fallbackToDirect,
    http2Enabled: proxyConfig.http2Enabled,
  });
}
```

### 3. Proxy Authentication

**URL-based Authentication**:
- Format: `http://username:password@proxy.example.com:8080`
- Credentials embedded in URL
- Automatically parsed by URL constructor and passed to proxy agents

For SOCKS proxies, credentials are extracted and passed to `socksDispatcher`:
```typescript
agent = socksDispatcher(
  {
    type: parsedProxy.protocol === 'socks5:' ? 5 : 4,
    host: parsedProxy.hostname,
    port: parseInt(parsedProxy.port, 10) || 1080,
    userId: parsedProxy.username || undefined,
    password: parsedProxy.password || undefined,
  },
  { connect: { timeout: connectTimeout } }
);
```

### 4. Fallback Mechanism

**Direct Connection Fallback** (`proxyFallbackToDirect`):

When enabled (default: `false`), if proxy connection fails, the system automatically retries with direct connection:

```typescript
const isProxyError =
  err.message.includes('proxy') ||
  err.message.includes('ECONNREFUSED') ||
  err.message.includes('ENOTFOUND') ||
  err.message.includes('ETIMEDOUT');

if (isProxyError && proxyConfig.fallbackToDirect) {
  logger.warn('ProxyForwarder: Falling back to direct connection');
  
  // Create new config without dispatcher
  const fallbackInit = { ...init };
  delete fallbackInit.dispatcher;
  
  try {
    response = await fetch(proxyUrl, fallbackInit);
    logger.info('ProxyForwarder: Direct connection succeeded after proxy failure');
  } catch (directError) {
    // Direct connection also failed, throw original proxy error
    throw fetchError;
  }
}
```

**Important**: The fallback mechanism is triggered only for specific proxy-related errors:
- Error message contains "proxy"
- `ECONNREFUSED` - Connection refused
- `ENOTFOUND` - DNS resolution failure
- `ETIMEDOUT` - Connection timeout

### 5. HTTP/2 Support

HTTP/2 can be enabled globally via system settings (`enableHttp2`). However:
- HTTP/HTTPS proxies support HTTP/2 (via undici's `allowH2` option)
- **SOCKS proxies do NOT support HTTP/2** (undici limitation)
- When HTTP/2 is enabled but SOCKS proxy is used, the system automatically falls back to HTTP/1.1

```typescript
if (parsedProxy.protocol === 'socks5:' || parsedProxy.protocol === 'socks4:') {
  actualHttp2Enabled = false; // SOCKS doesn't support HTTP/2
  
  if (enableHttp2) {
    logger.warn('SOCKS proxy does not support HTTP/2, falling back to HTTP/1.1');
  }
}
```

### 6. URL Masking for Security

Proxy URLs are masked in logs to protect credentials:

```typescript
export function maskProxyUrl(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    // If URL parsing fails, use regex replacement
    return proxyUrl.replace(/:([^:@]+)@/, ':***@');
  }
}
```

Example: `http://user:pass@proxy.com:8080` → `http://user:***@proxy.com:8080`

## Config/Commands

### 1. Provider Proxy Configuration

**Database Schema** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`):

```typescript
// Providers table
proxyUrl: varchar('proxy_url', { length: 512 }),
proxyFallbackToDirect: boolean('proxy_fallback_to_direct').default(false),
```

**TypeScript Interface** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts`):

```typescript
interface Provider {
  // ... other fields ...
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
}
```

**ProviderProxyConfig Interface** (`/Users/ding/Github/claude-code-hub/src/lib/proxy-agent.ts`):

```typescript
export interface ProviderProxyConfig {
  id: number;
  name?: string;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
}
```

### 2. Configuration Examples

**Basic HTTP Proxy**:
```typescript
{
  proxyUrl: 'http://proxy.example.com:8080',
  proxyFallbackToDirect: false,
}
```

**Authenticated Proxy**:
```typescript
{
  proxyUrl: 'http://user:password@proxy.example.com:8080',
  proxyFallbackToDirect: true,
}
```

**SOCKS5 Proxy**:
```typescript
{
  proxyUrl: 'socks5://localhost:1080',
  proxyFallbackToDirect: false,
}
```

**HTTPS Proxy with Fallback**:
```typescript
{
  proxyUrl: 'https://secure-proxy.example.com:8443',
  proxyFallbackToDirect: true,
}
```

### 3. Environment Variables for Timeouts

The proxy system respects global timeout configurations:

```bash
# Fetch timeout configuration (milliseconds)
FETCH_CONNECT_TIMEOUT=30000      # TCP connection timeout (default: 30s)
FETCH_HEADERS_TIMEOUT=600000     # Response headers timeout (default: 600s)
FETCH_BODY_TIMEOUT=600000        # Response body timeout (default: 600s)
```

These timeouts apply to both proxied and direct connections.

### 4. API Configuration

**Update Provider Proxy** (via Dashboard or API):
```typescript
// PATCH /api/providers/{id}
{
  "proxyUrl": "http://proxy.example.com:8080",
  "proxyFallbackToDirect": true
}
```

**Test Proxy Connection** (`/Users/ding/Github/claude-code-hub/src/actions/providers.ts`):

```typescript
export async function testProxyConnection(data: {
  providerUrl: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
}) {
  const proxyConfig = createProxyAgentForProvider(tempProvider, data.providerUrl);
  
  const init: UndiciFetchOptions = {
    method: 'HEAD',
    signal: AbortSignal.timeout(API_TEST_CONFIG.TIMEOUT_MS),
  };
  
  if (proxyConfig) {
    init.dispatcher = proxyConfig.agent;
  }
  
  const response = await fetch(data.providerUrl, init);
  // Returns: success, statusCode, responseTime, usedProxy, proxyUrl
}
```

## Edge Cases

### 1. Proxy Connection Failures

**Issue**: Proxy server unavailable or misconfigured

**Behavior**:
- Connection timeout (respects `FETCH_CONNECT_TIMEOUT`)
- Error logged with provider name and masked proxy URL
- If `proxyFallbackToDirect: true`, retries without proxy
- If `proxyFallbackToDirect: false`, returns 503 error

**Error Detection**:
```typescript
const isProxyError =
  err.message.includes('proxy') ||
  err.message.includes('ECONNREFUSED') ||
  err.message.includes('ENOTFOUND') ||
  err.message.includes('ETIMEDOUT');
```

### 2. Authentication Failures

**Issue**: Invalid proxy credentials

**Behavior**:
- HTTP 407 Proxy Authentication Required (for HTTP/HTTPS proxies)
- Connection refused (for SOCKS proxies)
- Error propagated to client
- No automatic retry (prevents lockout)

### 3. TLS/SSL Issues

**Issue**: Corporate proxy with self-signed certificates or SSL certificate errors

**Behavior**:
- SSL errors are detected and the agent is marked as unhealthy
- Next request will create a new agent
- Error is logged with detailed diagnostics

```typescript
if (isSSLCertificateError(err) && sslErrorCacheKey) {
  const pool = getGlobalAgentPool();
  pool.markUnhealthy(sslErrorCacheKey, err.message);
}
```

### 4. DNS Resolution

**Issue**: Proxy hostname resolution fails

**Behavior**:
- DNS error logged with error code `ENOTFOUND`
- Falls back to direct if `proxyFallbackToDirect: true`
- Otherwise returns 503 with error details

### 5. Protocol Mismatch

**Issue**: HTTP proxy for HTTPS upstream

**Behavior**:
- `undici` handles CONNECT tunneling automatically
- No special configuration needed
- Works transparently

### 6. IPv6 Proxies

**Issue**: IPv6 proxy addresses

**Supported Formats**:
- `http://[2001:db8::1]:8080`
- `socks5://[::1]:1080`

The URL constructor handles IPv6 addresses correctly.

### 7. Agent Pool Exhaustion

**Issue**: Too many unique endpoint/proxy combinations

**Behavior**:
- Agent Pool implements LRU eviction (default max: 100 agents)
- TTL-based expiration (default: 5 minutes)
- Cleanup interval (default: 30 seconds)

```typescript
const DEFAULT_CONFIG: AgentPoolConfig = {
  maxTotalAgents: 100,
  agentTtlMs: 300000, // 5 minutes
  connectionIdleTimeoutMs: 60000, // 1 minute
  cleanupIntervalMs: 30000, // 30 seconds
};
```

### 8. HTTP/2 with SOCKS Proxy

**Issue**: HTTP/2 enabled but SOCKS proxy configured

**Behavior**:
- System automatically detects SOCKS protocol
- Logs warning: "SOCKS proxy does not support HTTP/2, falling back to HTTP/1.1"
- Forces HTTP/1.1 for the connection

### 9. Concurrent Request Handling

**Issue**: Multiple concurrent requests to the same provider

**Behavior**:
- Agent Pool caches agents per endpoint/proxy combination
- Race condition protection via pending creation promises
- Connection reuse improves performance

```typescript
// Check if there's a pending creation for this key
const pending = this.pendingCreations.get(cacheKey);
if (pending) {
  const result = await pending;
  this.stats.cacheHits++;
  return { ...result, isNew: false };
}
```

## References

### Core Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent.ts` | ProxyAgent creation, URL masking, validation |
| `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent/agent-pool.ts` | Agent caching, health management, LRU eviction |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` | Request forwarding with proxy support and fallback |
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | Provider type definitions including proxy config |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema for proxy settings |

### Frontend Components

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/forms/provider-form/sections/network-section.tsx` | Proxy URL and fallback configuration UI |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/forms/proxy-test-button.tsx` | Proxy connection testing button |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/forms/api-test-button.tsx` | API test with proxy support |

### Dependencies

| Package | Purpose |
|---------|---------|
| `undici` | HTTP client with ProxyAgent and HTTP/2 support |
| `fetch-socks` | SOCKS4/SOCKS5 dispatcher for undici |

### Related Configuration

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` | Environment variables (FETCH_*_TIMEOUT) |
| `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` | Provider CRUD actions including proxy test |

## Summary

The proxy configuration system in claude-code-hub provides:

1. **Flexible Proxy Support**: HTTP, HTTPS, SOCKS4/5 with authentication via URL embedding
2. **Per-Provider Configuration**: Each provider can have independent proxy settings
3. **Fallback Mechanism**: Optional direct connection fallback on proxy failure (`proxyFallbackToDirect`)
4. **HTTP/2 Support**: Automatic ALPN negotiation for HTTP/HTTPS proxies (SOCKS falls back to HTTP/1.1)
5. **Connection Caching**: Agent Pool for efficient connection reuse and health management
6. **Security**: URL masking in logs to protect credentials
7. **Validation**: URL format validation with protocol checking
8. **Testing**: Built-in proxy connectivity testing

**Key Defaults**:
- `proxyFallbackToDirect`: `false` (must be explicitly enabled)
- HTTP/2: Disabled by default (enable via system settings)
- Timeouts: 30s connect, 600s headers/body
- Agent Pool: Max 100 agents, 5min TTL

This system ensures reliable connectivity to AI providers even in restricted network environments while maintaining security and performance.
