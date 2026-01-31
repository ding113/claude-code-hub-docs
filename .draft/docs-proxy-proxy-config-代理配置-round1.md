# 代理配置 - Code Exploration Report

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

**Configuration Location**: Provider settings in database (`proxyUrl`, `proxyAuth` fields)

**Supported Proxy Types**:
- HTTP proxy (`http://host:port`)
- HTTPS proxy (`https://host:port`)
- SOCKS proxy (`socks://host:port` or `socks5://host:port`)
- Authenticated proxies (`http://user:pass@host:port`)

**Configuration Flow**:
```
Provider Settings
    ↓
proxyUrl: string | null
proxyAuth: { username: string, password: string } | null
    ↓
ProxyAgent Creation (undici)
    ↓
Request Forwarding with Proxy
```

### 2. Proxy Implementation Details

**Core File**: `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent.ts`

The proxy system uses Node.js's `undici` library with `ProxyAgent`:

```typescript
import { ProxyAgent } from 'undici';

function createProxyAgent(proxyUrl: string): ProxyAgent {
  return new ProxyAgent({
    uri: proxyUrl,
    connect: {
      rejectUnauthorized: true, // TLS certificate verification
    },
  });
}
```

**Request Forwarding with Proxy** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`):

```typescript
const proxyUrl = provider.proxyUrl;
const dispatcher = proxyUrl 
  ? new ProxyAgent({ uri: proxyUrl })
  : getGlobalDispatcher();

const response = await fetch(upstreamUrl, {
  ...requestInit,
  dispatcher,
});
```

### 3. Proxy Authentication

**URL-based Authentication**:
- Format: `http://username:password@proxy.example.com:8080`
- Credentials embedded in URL
- Automatically parsed by undici ProxyAgent

**Separate Auth Configuration**:
- `proxyUrl`: `http://proxy.example.com:8080`
- `proxyAuth`: `{ username: 'user', password: 'pass' }`
- Combined at runtime for proxy connection

### 4. Fallback Mechanism

**Direct Connection Fallback** (`proxyFallbackToDirect`):

When enabled, if proxy connection fails, the system automatically retries with direct connection:

```typescript
const shouldFallback = provider.proxyFallbackToDirect ?? true;

try {
  return await fetchWithProxy(proxyUrl);
} catch (err) {
  if (shouldFallback && isProxyError(err)) {
    logger.warn('Proxy failed, falling back to direct connection');
    return await fetchDirect();
  }
  throw err;
}
```

### 5. Environment Variable Proxy

**System-wide Proxy Support**:

The system respects standard environment variables:
- `HTTP_PROXY` / `http_proxy`
- `HTTPS_PROXY` / `https_proxy`
- `NO_PROXY` / `no_proxy`

Used when no per-provider proxy is configured.

## Config/Commands

### 1. Provider Proxy Configuration

**Database Schema** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`):

```sql
proxy_url: varchar(512),
proxy_auth_username: varchar(256),
proxy_auth_password: varchar(256),
proxy_fallback_to_direct: boolean default true,
```

**TypeScript Interface** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts`):

```typescript
interface Provider {
  // ... other fields ...
  proxyUrl: string | null;
  proxyAuth: {
    username: string;
    password: string;
  } | null;
  proxyFallbackToDirect: boolean;
}
```

### 2. Configuration Examples

**Basic HTTP Proxy**:
```typescript
{
  proxyUrl: 'http://proxy.example.com:8080',
  proxyAuth: null,
  proxyFallbackToDirect: true,
}
```

**Authenticated Proxy**:
```typescript
{
  proxyUrl: 'http://proxy.example.com:8080',
  proxyAuth: {
    username: 'proxyuser',
    password: 'proxypass',
  },
  proxyFallbackToDirect: true,
}
```

**SOCKS5 Proxy**:
```typescript
{
  proxyUrl: 'socks5://localhost:1080',
  proxyAuth: null,
  proxyFallbackToDirect: false,
}
```

**URL with Embedded Auth**:
```typescript
{
  proxyUrl: 'http://user:pass@proxy.example.com:8080',
  proxyAuth: null,
  proxyFallbackToDirect: true,
}
```

### 3. Environment Variables

```bash
# Global proxy settings
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=https://proxy.example.com:8443
export NO_PROXY=localhost,127.0.0.1,.internal.domain
```

### 4. API Configuration

**Update Provider Proxy** (via Dashboard):
```typescript
// PATCH /api/providers/{id}
{
  "proxyUrl": "http://proxy.example.com:8080",
  "proxyAuth": {
    "username": "user",
    "password": "pass"
  },
  "proxyFallbackToDirect": true
}
```

## Edge Cases

### 1. Proxy Connection Failures

**Issue**: Proxy server unavailable or misconfigured

**Behavior**:
- Connection timeout (respects `FETCH_CONNECT_TIMEOUT`)
- Error logged with provider name and proxy URL
- If `proxyFallbackToDirect: true`, retries without proxy
- If `proxyFallbackToDirect: false`, returns 502 error

### 2. Authentication Failures

**Issue**: Invalid proxy credentials

**Behavior**:
- HTTP 407 Proxy Authentication Required
- Error propagated to client
- No automatic retry (prevents lockout)

### 3. TLS/SSL Issues

**Issue**: Corporate proxy with self-signed certificates

**Configuration**:
```typescript
{
  proxyUrl: 'https://corporate-proxy:8443',
  proxyAuth: { username: 'user', password: 'pass' },
  // Note: TLS verification can be disabled via env var
  // NODE_TLS_REJECT_UNAUTHORIZED=0 (not recommended for production)
}
```

### 4. DNS Resolution

**Issue**: Proxy hostname resolution fails

**Behavior**:
- DNS error logged
- Falls back to direct if enabled
- Otherwise returns 502 with DNS error details

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

### 7. Proxy Bypass (NO_PROXY)

**Environment Variable**:
```bash
export NO_PROXY=localhost,127.0.0.1,*.internal.example.com
```

**Matching Rules**:
- Exact hostname match
- IP address match
- Wildcard domain suffix match

## References

### Core Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent.ts` | ProxyAgent creation and configuration |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` | Request forwarding with proxy support |
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | Provider type definitions |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema for proxy settings |

### Configuration Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` | Environment variable validation |
| `/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts` | Provider data transformers |

### Frontend Components

| File | Purpose |
|------|---------|
| Provider settings form in dashboard | Proxy URL, auth, fallback configuration |

### Dependencies

| Package | Purpose |
|---------|---------|
| `undici` | HTTP client with ProxyAgent support |

## Summary

The proxy configuration system in claude-code-hub provides:

1. **Flexible Proxy Support**: HTTP, HTTPS, SOCKS4/5 with authentication
2. **Per-Provider Configuration**: Each provider can have independent proxy settings
3. **Fallback Mechanism**: Automatic direct connection fallback on proxy failure
4. **Environment Integration**: Respects standard HTTP_PROXY/HTTPS_PROXY variables
5. **Security**: TLS verification, credential protection, NO_PROXY support

This system ensures reliable connectivity to AI providers even in restricted network environments.
