# Header Modification (Header 修改) - Round 1 Exploration Draft

## 1. Intent Analysis

### 1.1 What is Header Modification?

Header Modification is a core feature of the claude-code-hub proxy system that allows administrators to programmatically modify HTTP request headers before they are forwarded to upstream AI providers. This feature serves several critical purposes:

1. **Privacy Protection**: Remove sensitive headers (like client IP addresses, internal tokens) before requests reach external providers
2. **Request Normalization**: Standardize headers across different client types and versions
3. **Provider-Specific Customization**: Apply different header rules based on which provider will handle the request
4. **Security Compliance**: Enforce organizational policies by stripping or adding required headers

### 1.2 Why Header Modification Matters

In a multi-tenant AI proxy environment, header modification is essential because:

- **Client Diversity**: Different AI clients (Claude Code CLI, Codex CLI, custom applications) send different headers
- **Provider Requirements**: Each AI provider (Anthropic, OpenAI, Gemini) has different authentication and protocol requirements
- **Privacy Regulations**: GDPR, CCPA, and other regulations may require stripping identifying information
- **Debugging and Auditing**: Headers can be modified to inject trace IDs or other diagnostic information

### 1.3 Scope of Header Modification

The system supports modifying **request headers only** (not response headers). Response headers are handled separately through the `HeaderProcessor` class for sanitization purposes.

---

## 2. Behavior Summary

### 2.1 Header Filter Types

The system supports two primary header modification actions:

| Action | Description | Use Case |
|--------|-------------|----------|
| `remove` | Deletes a header from the request | Remove internal authentication tokens, client IP headers |
| `set` | Sets or replaces a header value | Override User-Agent, add custom tracking headers |

### 2.2 Filter Binding Types

Header filters can be applied at different scopes:

| Binding Type | Description | When Applied |
|--------------|-------------|--------------|
| `global` | Applies to all requests | Before provider selection |
| `providers` | Applies to specific providers | After provider selection |
| `groups` | Applies to providers with specific group tags | After provider selection |

### 2.3 Execution Order

1. **Request arrives** → Headers parsed into `ProxySession`
2. **Global filters applied** → `ProxyRequestFilter.ensure()` calls `requestFilterEngine.applyGlobal()`
3. **Provider selected** → Based on model, load balancing, etc.
4. **Provider-specific filters applied** → `ProxyProviderRequestFilter.ensure()` calls `requestFilterEngine.applyForProvider()`
5. **Headers processed** → `HeaderProcessor` sanitizes and builds final headers
6. **Request forwarded** → Modified headers sent to upstream provider

### 2.4 Header Name Case Sensitivity

Header names are **case-insensitive** per HTTP specification. The system uses the Web API `Headers` object which normalizes header names to lowercase internally. When configuring filters, the `target` field should use the canonical header name (e.g., `user-agent`, `x-api-key`).

---

## 3. Configuration and Commands

### 3.1 Database Schema

**File**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (Lines 508-536)

```typescript
export const requestFilters = pgTable('request_filters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  scope: varchar('scope', { length: 20 })
    .notNull()
    .$type<'header' | 'body'>(),
  action: varchar('action', { length: 30 })
    .notNull()
    .$type<'remove' | 'set' | 'json_path' | 'text_replace'>(),
  matchType: varchar('match_type', { length: 20 }),
  target: text('target').notNull(),        // Header name for scope="header"
  replacement: jsonb('replacement'),       // Header value for action="set"
  priority: integer('priority').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  bindingType: varchar('binding_type', { length: 20 })
    .notNull()
    .default('global')
    .$type<'global' | 'providers' | 'groups'>(),
  providerIds: jsonb('provider_ids').$type<number[] | null>(),
  groupTags: jsonb('group_tags').$type<string[] | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  requestFiltersEnabledIdx: index('idx_request_filters_enabled').on(table.isEnabled, table.priority),
  requestFiltersScopeIdx: index('idx_request_filters_scope').on(table.scope),
  requestFiltersActionIdx: index('idx_request_filters_action').on(table.action),
  requestFiltersBindingIdx: index('idx_request_filters_binding').on(table.isEnabled, table.bindingType),
}));
```

### 3.2 Type Definitions

**File**: `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts` (Lines 8-29)

```typescript
export type RequestFilterScope = "header" | "body";
export type RequestFilterAction = "remove" | "set" | "json_path" | "text_replace";
export type RequestFilterMatchType = "regex" | "contains" | "exact" | null;
export type RequestFilterBindingType = "global" | "providers" | "groups";

export interface RequestFilter {
  id: number;
  name: string;
  description: string | null;
  scope: RequestFilterScope;        // "header" for header modification
  action: RequestFilterAction;      // "remove" or "set" for headers
  matchType: RequestFilterMatchType; // null for header filters
  target: string;                   // Header name (e.g., "user-agent")
  replacement: unknown;             // Header value for "set" action
  priority: number;
  isEnabled: boolean;
  bindingType: RequestFilterBindingType;
  providerIds: number[] | null;
  groupTags: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.3 Creating Header Filters (Server Actions)

**File**: `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts`

```typescript
// Create a header removal filter
await createRequestFilterAction({
  name: "Remove Internal Token",
  description: "Strip x-internal-token before forwarding",
  scope: "header",
  action: "remove",
  target: "x-internal-token",
  bindingType: "global",
  priority: 10,
});

// Create a header override filter
await createRequestFilterAction({
  name: "Set Custom User-Agent",
  description: "Override User-Agent for all requests",
  scope: "header",
  action: "set",
  target: "user-agent",
  replacement: "MyApp/1.0",
  bindingType: "providers",
  providerIds: [1, 2],  // Apply to specific providers
  priority: 5,
});

// Create a group-based filter
await createRequestFilterAction({
  name: "Group Header Override",
  description: "Apply to providers in 'premium' group",
  scope: "header",
  action: "set",
  target: "x-priority",
  replacement: "high",
  bindingType: "groups",
  groupTags: ["premium"],
  priority: 20,
});
```

### 3.4 Priority System

Filters are applied in order of ascending priority (lower numbers first). When multiple filters target the same header:

1. Global filters apply first (sorted by priority)
2. Provider-specific filters apply second (sorted by priority)
3. Later filters can override earlier ones

**Example**:
- Filter A: `priority: 5`, sets `user-agent: "Agent-A"`
- Filter B: `priority: 10`, sets `user-agent: "Agent-B"`
- Result: `user-agent: "Agent-B"` (Filter B wins)

---

## 4. Implementation Details

### 4.1 Request Filter Engine

**File**: `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`

The `RequestFilterEngine` class is the core implementation that applies header modifications.

#### 4.1.1 Global Filter Application (Lines 260-283)

```typescript
async applyGlobal(session: ProxySession): Promise<void> {
  // Early exit optimization
  if (this.isInitialized && this.globalFilters.length === 0) return;

  await this.ensureInitialized();
  if (this.globalFilters.length === 0) return;

  for (const filter of this.globalFilters) {
    try {
      if (filter.scope === "header") {
        this.applyHeaderFilter(session, filter);  // Line 270
      } else if (filter.scope === "body") {
        this.applyBodyFilter(session, filter);
      }
    } catch (error) {
      logger.error("[RequestFilterEngine] Failed to apply global filter", {
        filterId: filter.id,
        scope: filter.scope,
        action: filter.action,
        error,
      });
    }
  }
}
```

#### 4.1.2 Provider-Specific Filter Application (Lines 288-336)

```typescript
async applyForProvider(session: ProxySession): Promise<void> {
  if (this.isInitialized && this.providerFilters.length === 0) return;

  await this.ensureInitialized();
  if (this.providerFilters.length === 0 || !session.provider) return;

  const providerId = session.provider.id;
  
  // Parse provider group tags if group filters exist
  let providerTagsSet: Set<string> | null = null;
  if (this.hasGroupBasedFilters) {
    const providerGroupTag = session.provider.groupTag;
    providerTagsSet = new Set(providerGroupTag?.split(",").map((t) => t.trim()) ?? []);
  }

  for (const filter of this.providerFilters) {
    // Check binding match
    let matches = false;

    if (filter.bindingType === "providers") {
      // O(1) lookup using Set
      matches = filter.providerIdsSet?.has(providerId) ?? false;
    } else if (filter.bindingType === "groups" && providerTagsSet) {
      // Check if any provider tag matches filter group tags
      matches = filter.groupTagsSet
        ? Array.from(providerTagsSet).some((tag) => filter.groupTagsSet!.has(tag))
        : false;
    }

    if (!matches) continue;

    try {
      if (filter.scope === "header") {
        this.applyHeaderFilter(session, filter);  // Line 322
      } else if (filter.scope === "body") {
        this.applyBodyFilter(session, filter);
      }
    } catch (error) {
      logger.error("[RequestFilterEngine] Failed to apply provider filter", {...});
    }
  }
}
```

#### 4.1.3 Header Filter Implementation (Lines 346-365)

```typescript
private applyHeaderFilter(session: ProxySession, filter: CachedRequestFilter) {
  const key = filter.target;  // Header name (case-insensitive)
  
  switch (filter.action) {
    case "remove":
      // Delete the header from the request
      session.headers.delete(key);
      break;
      
    case "set": {
      // Set/replace header value
      const value =
        typeof filter.replacement === "string"
          ? filter.replacement
          : filter.replacement !== null && filter.replacement !== undefined
            ? JSON.stringify(filter.replacement)
            : "";
      session.headers.set(key, value);
      break;
    }
    
    default:
      logger.warn("[RequestFilterEngine] Unsupported header action", { 
        action: filter.action 
      });
  }
}
```

### 4.2 Proxy Session Header Management

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts`

#### 4.2.1 Header Storage and Original Copy (Lines 55-58, 139-140)

```typescript
export class ProxySession {
  readonly headers: Headers;
  // Original headers copy for detecting filter modifications
  private readonly originalHeaders: Headers;
  readonly headerLog: string;
  
  private constructor(init: { ... }) {
    // ...
    this.headers = init.headers;
    this.originalHeaders = new Headers(init.headers); // Copy for comparison
    this.headerLog = init.headerLog;
    // ...
  }
```

#### 4.2.2 Header Modification Detection (Lines 236-240)

```typescript
/**
 * Check if a header was modified by filters.
 * 
 * Compares original value with current value. Considered modified if:
 * - Value changed
 * - Header was deleted
 * - Header was added (didn't exist before)
 * 
 * @param key - Header name (case-insensitive)
 * @returns true if modified, false otherwise
 */
isHeaderModified(key: string): boolean {
  const original = this.originalHeaders.get(key);
  const current = this.headers.get(key);
  return original !== current;
}
```

This method is used by the forwarder to detect if filters modified specific headers like `user-agent`.

### 4.3 Proxy Filter Middleware

#### 4.3.1 Global Filter Middleware

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts`

```typescript
import { logger } from "@/lib/logger";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import type { ProxySession } from "./session";

/**
 * Request Filter: Supports Header deletion/override, Body replacement
 * 
 * Design:
 * - Filter rules configured in admin panel stored in request_filters table
 * - RequestFilterEngine caches rules and listens to eventEmitter for hot reload
 * - Executed in GuardPipeline before sensitive word detection
 */
export class ProxyRequestFilter {
  static async ensure(session: ProxySession): Promise<void> {
    try {
      await requestFilterEngine.applyGlobal(session);
    } catch (error) {
      // Fail-open: filter failure doesn't block main flow
      logger.error("[ProxyRequestFilter] Failed to apply global request filters", { error });
    }
  }
}
```

#### 4.3.2 Provider-Specific Filter Middleware

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts`

```typescript
import { logger } from "@/lib/logger";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import type { ProxySession } from "./session";

/**
 * Provider-specific Request Filter
 * Applies filters bound to specific provider or group
 * Executed AFTER provider selection
 */
export class ProxyProviderRequestFilter {
  static async ensure(session: ProxySession): Promise<void> {
    if (!session.provider) {
      logger.warn(
        "[ProxyProviderRequestFilter] No provider selected, skipping..."
      );
      return;
    }

    try {
      await requestFilterEngine.applyForProvider(session);
    } catch (error) {
      // Fail-open: filter doesn't block main flow
      logger.error("[ProxyProviderRequestFilter] Failed to apply provider-specific filters", {
        error,
        providerId: session.provider.id,
      });
    }
  }
}
```

### 4.4 Header Processor (Sanitization)

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/headers.ts`

The `HeaderProcessor` class handles header sanitization before forwarding to providers. This is separate from the filter system but works in conjunction with it.

```typescript
export interface HeaderProcessorConfig {
  /** Headers to blacklist (remove) */
  blacklist?: string[];
  /** Headers to set/override */
  overrides?: Record<string, string>;
  /** Keep original authorization (default false) */
  preserveAuthorization?: boolean;
  /** Keep client IP headers (default false) */
  preserveClientIpHeaders?: boolean;
}

export class HeaderProcessor {
  private blacklist: Set<string>;
  private overrides: Map<string, string>;

  constructor(config: HeaderProcessorConfig = {}) {
    // Default blacklist includes privacy-sensitive headers
    const clientIpHeaders = [
      "x-forwarded-for",
      "x-real-ip",
      "x-client-ip",
      "x-originating-ip",
      "x-remote-ip",
      "x-remote-addr",
    ];

    const defaultBlacklist = [
      ...clientIpHeaders,
      "x-forwarded-host",
      "x-forwarded-port",
      "x-forwarded-proto",
      "forwarded",
      "cf-connecting-ip",
      "cf-ipcountry",
      "cf-ray",
      // ... many more CDN/proxy headers
    ];
    
    // ... initialization logic
  }

  process(headers: Headers): Headers {
    const processed = new Headers();

    // Step 1: Filter based on blacklist
    headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (this.blacklist.has(lowerKey)) {
        return; // Skip blacklisted header
      }
      processed.set(key, value);
    });

    // Step 2: Apply overrides
    this.overrides.forEach((value, key) => {
      processed.set(key, value);
    });

    return processed;
  }
}
```

### 4.5 Forwarder Integration

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` (Lines 2097-2198)

The forwarder uses `HeaderProcessor` to build final headers and checks if filters modified the User-Agent:

```typescript
private static buildHeaders(
  session: ProxySession,
  provider: NonNullable<typeof session.provider>
): Headers {
  const outboundKey = provider.key;
  const preserveClientIp = provider.preserveClientIp ?? false;
  const { clientIp, xForwardedFor } = ProxyForwarder.resolveClientIp(session.headers);

  // Build header overrides
  const overrides: Record<string, string> = {
    host: HeaderProcessor.extractHost(provider.url),
    authorization: `Bearer ${outboundKey}`,
    "x-api-key": outboundKey,
    "content-type": "application/json",
    "accept-encoding": "identity", // Disable compression
  };

  // Codex special handling: respect filter-modified User-Agent
  if (provider.providerType === "codex") {
    const filteredUA = session.headers.get("user-agent");
    const originalUA = session.userAgent;
    const wasModified = session.isHeaderModified("user-agent");

    // Priority:
    // 1. If filter modified user-agent (wasModified=true), use filtered value
    // 2. If filter deleted user-agent (wasModified=true but filteredUA=null), fallback to original
    // 3. If no original, use hardcoded default
    let resolvedUA: string;
    if (wasModified) {
      resolvedUA =
        filteredUA ?? originalUA ?? "codex_cli_rs/0.55.0 (Mac OS 26.1.0; arm64) vscode/2.0.64";
    } else {
      resolvedUA = originalUA ?? "codex_cli_rs/0.55.0 (Mac OS 26.1.0; arm64) vscode/2.0.64";
    }
    overrides["user-agent"] = resolvedUA;
  }
  
  // ... rest of header building
}
```

---

## 5. Edge Cases and Behaviors

### 5.1 Fail-Open Behavior

Header filter failures **do not block** the request. The system uses a fail-open approach:

```typescript
try {
  await requestFilterEngine.applyGlobal(session);
} catch (error) {
  // Fail-open: filter failure doesn't block main flow
  logger.error("[ProxyRequestFilter] Failed to apply global request filters", { error });
}
```

This ensures that a misconfigured filter doesn't break the entire proxy service.

### 5.2 Empty and Null Values

When using `action: "set"`:
- If `replacement` is `null` or `undefined`, the header is set to empty string `""`
- If `replacement` is a non-string value, it's JSON-serialized
- To effectively remove a header, use `action: "remove"` instead of setting to empty string

### 5.3 Header Name Case Sensitivity

The Web API `Headers` object normalizes header names to lowercase internally. However, the original case is preserved when sending. When configuring filters:

- Use lowercase for consistency: `user-agent`, `x-api-key`
- The system will match correctly regardless of case used in the filter configuration

### 5.4 Filter Priority Conflicts

When multiple filters target the same header:

1. **Same priority**: Filters are sorted by ID (ascending), later IDs win
2. **Different priority**: Higher priority (larger number) wins
3. **Global vs Provider**: Provider filters apply after global filters, so they can override

### 5.5 Provider Binding Validation

The system enforces constraints on binding types:

```typescript
// Cannot mix providers and groups
if (bindingType === "providers" && groupTags?.length > 0) {
  return "Cannot select both Providers and Groups";
}

// Global filters cannot specify providers or groups
if (bindingType === "global" && (providerIds?.length > 0 || groupTags?.length > 0)) {
  return "Global type cannot specify Providers or Groups";
}
```

### 5.6 Special Headers That Cannot Be Modified

Some headers are managed by the system and cannot be effectively modified by filters:

- `host`: Always overwritten by `HeaderProcessor` with provider URL host
- `authorization`: Always overwritten with provider API key
- `content-length`: Deleted by `HeaderProcessor` (dynamically calculated)
- `connection`: Managed by undici/Node.js

### 5.7 Codex User-Agent Special Handling

For Codex providers, the system has special logic to respect filter-modified User-Agent:

```typescript
const wasModified = session.isHeaderModified("user-agent");
if (wasModified) {
  resolvedUA =
    filteredUA ?? originalUA ?? "codex_cli_rs/0.55.0...";
}
```

This allows administrators to override the Codex CLI's User-Agent via filters.

### 5.8 Cache TTL and 1M Context Headers

The system automatically manages certain Anthropic beta headers:

```typescript
// For 1h cache TTL
if (session.getCacheTtlResolved?.() === "1h") {
  const existingBeta = session.headers.get("anthropic-beta") || "";
  const betaFlags = new Set(existingBeta.split(",").map(s => s.trim()).filter(Boolean));
  betaFlags.add("extended-cache-ttl-2025-04-11");
  overrides["anthropic-beta"] = Array.from(betaFlags).join(", ");
}

// For 1M context
if (session.getContext1mApplied?.()) {
  const existingBeta = overrides["anthropic-beta"] || session.headers.get("anthropic-beta") || "";
  const betaFlags = new Set(existingBeta.split(",").map(s => s.trim()).filter(Boolean));
  betaFlags.add("context-1m-2025-08-07");
  overrides["anthropic-beta"] = Array.from(betaFlags).join(", ");
}
```

These are added via the `HeaderProcessor` overrides, not the filter system.

### 5.9 Special Settings for Header Overrides

The system tracks special header modifications through the `SpecialSetting` type system:

**File**: `/Users/ding/Github/claude-code-hub/src/types/special-settings.ts` (Lines 67-89)

```typescript
// Cache TTL Header Override
export type AnthropicCacheTtlHeaderOverrideSpecialSetting = {
  type: "anthropic_cache_ttl_header_override";
  scope: "request_header";
  hit: boolean;
  ttl: string;
};

// 1M Context Header Override
export type AnthropicContext1mHeaderOverrideSpecialSetting = {
  type: "anthropic_context_1m_header_override";
  scope: "request_header";
  hit: boolean;
  header: "anthropic-beta";
  flag: string;
};
```

These special settings are derived from session state and recorded for audit purposes:

**File**: `/Users/ding/Github/claude-code-hub/src/lib/utils/special-settings.ts` (Lines 113-130)

```typescript
// Derive cache TTL header override special setting
if (params.cacheTtlApplied) {
  derived.push({
    type: "anthropic_cache_ttl_header_override",
    scope: "request_header",
    hit: true,
    ttl: params.cacheTtlApplied,
  });
}

// Derive 1M context header override special setting
if (params.context1mApplied === true) {
  derived.push({
    type: "anthropic_context_1m_header_override",
    scope: "request_header",
    hit: true,
    header: "anthropic-beta",
    flag: CONTEXT_1M_BETA_HEADER,
  });
}
```

---

## 6. Testing

### 6.1 Unit Tests for Header Modification Detection

**File**: `/Users/ding/Github/claude-code-hub/tests/unit/proxy/session.test.ts` (Lines 387-438)

```typescript
describe("ProxySession - isHeaderModified", () => {
  it("should detect modified header", () => {
    const headers = new Headers([["user-agent", "original"]]);
    const session = createSessionForHeaders(headers);
    session.headers.set("user-agent", "modified");
    expect(session.isHeaderModified("user-agent")).toBe(true);
  });

  it("should detect unmodified header", () => {
    const headers = new Headers([["user-agent", "same"]]);
    const session = createSessionForHeaders(headers);
    expect(session.isHeaderModified("user-agent")).toBe(false);
  });

  it("should handle non-existent header", () => {
    const headers = new Headers();
    const session = createSessionForHeaders(headers);
    expect(session.isHeaderModified("x-custom")).toBe(false);
  });

  it("should detect deleted header", () => {
    const headers = new Headers([["user-agent", "original"]]);
    const session = createSessionForHeaders(headers);
    session.headers.delete("user-agent");
    expect(session.isHeaderModified("user-agent")).toBe(true);
  });

  it("should detect added header", () => {
    const headers = new Headers();
    const session = createSessionForHeaders(headers);
    session.headers.set("x-new-header", "new-value");
    expect(session.isHeaderModified("x-new-header")).toBe(true);
  });

  it("should distinguish empty string from null", () => {
    const headers = new Headers([["x-test", ""]]);
    const session = createSessionForHeaders(headers);
    session.headers.delete("x-test");
    expect(session.isHeaderModified("x-test")).toBe(true); // "" -> null
    expect(session.headers.get("x-test")).toBeNull();
  });
});
```

### 6.2 Request Filter Engine Tests

**File**: `/Users/ding/Github/claude-code-hub/tests/unit/request-filter-engine.test.ts`

Tests cover:
- Header removal filters
- Header set filters
- Priority ordering
- Provider binding
- Group binding
- Fail-open behavior

### 6.3 Request Filter Binding Tests

**File**: `/Users/ding/Github/claude-code-hub/tests/unit/request-filter-binding.test.ts`

Comprehensive test suite with 24+ test cases covering:

| Category | Test Count | Description |
|----------|------------|-------------|
| Global Filters | 7 | Tests for filters applied to all requests |
| Provider-Specific Filters | 6 | Tests for filters bound to specific providers |
| Group-Specific Filters | 7 | Tests for filters bound to provider groups |
| Combined Filters | 4 | Tests for global + provider + group interaction |

**Example Test Cases:**

| Test | Scope | Action | Expected Result |
|------|-------|--------|-----------------|
| Global header filter (remove) | header | remove | Header `x-remove` is deleted |
| Global header filter (set) | header | set | Header `x-custom` = "custom-value" |
| Single provider ID match | providers | - | Filter applied when providerId matches |
| Exact groupTag match | groups | - | Filter applied when tag matches exactly |
| Multiple global filters priority | header | set | Last filter (highest priority) wins |

### 6.4 Proxy Forwarder Header Tests

**File**: `/Users/ding/Github/claude-code-hub/tests/unit/proxy/proxy-forwarder.test.ts`

**User-Agent Resolution Logic:**

| Scenario | Filtered UA | Original UA | Result |
|----------|-------------|-------------|--------|
| Filter modified UA | "Filtered-UA/2.0" | "Original-UA/1.0" | Uses "Filtered-UA/2.0" |
| Filter not modified | "Original-UA/1.0" | "Original-UA/1.0" | Uses "Original-UA/1.0" |
| Filter deleted UA | (none) | "Original-UA/1.0" | Falls back to "Original-UA/1.0" |
| Original was empty | (none) | (none) | Uses default UA string |
| Filter set empty string | "" | "Original-UA/1.0" | Uses "" (preserves empty) |

### 6.5 Guard Pipeline Integration Tests

**File**: `/Users/ding/Github/claude-code-hub/tests/unit/proxy/chat-completions-handler-guard-pipeline.test.ts`

**Pipeline Execution Order:**
```
auth -> sensitive -> client -> model -> version -> probe -> session -> warmup -> requestFilter -> rateLimit -> provider -> providerRequestFilter -> messageContext -> forward -> dispatch
```

Key findings:
- `requestFilter` is called after `warmup` and before `rateLimit`
- `providerRequestFilter` is called after `provider` selection
- Both filters are executed in both OpenAI(messages) and Response(input) paths
- Filters are also executed in count_tokens path (without session/warmup/rateLimit)

---

## 7. UI Components

### 7.1 Filter Management Page

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/page.tsx`

Main settings page for request filters management. Displays the filter table and provides access to create/edit dialogs.

### 7.2 Filter Dialog

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` (508 lines)

**Form fields:**
- **Name** — Filter identifier
- **Binding Type** — Global, Providers, or Groups
- **Scope** — Header or Body
- **Action** — Dynamic based on scope:
  - Header: `remove`, `set`
  - Body: `json_path`, `text_replace`
- **Match Type** — For body text_replace: `contains`, `exact`, `regex`
- **Target** — Header name or JSON path
- **Replacement** — Value to set/replace with
- **Priority** — Numeric priority (lower = earlier execution)
- **Enabled toggle** — For edit mode

### 7.3 Filter Table

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-table.tsx` (291 lines)

**Features:**
- Displays all filters with columns: Name, Scope, Action, Target, Replacement, Priority, Apply, Status, Actions
- Toggle switch for enabling/disabling filters
- Edit button opens FilterDialog in edit mode
- Delete button with confirmation
- Refresh cache button
- Tooltips showing bound providers/groups

### 7.4 Multi-Select Components

**ProviderMultiSelect** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/provider-multi-select.tsx`):
- Loads providers via `listProvidersForFilterAction`
- Checkbox-based selection with select all/clear all

**GroupMultiSelect** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/group-multi-select.tsx`):
- Loads group tags via `getDistinctProviderGroupsAction`
- Same checkbox UI pattern

### 6.1 Unit Tests for Header Modification Detection

**File**: `/Users/ding/Github/claude-code-hub/tests/unit/proxy/session.test.ts` (Lines 387-438)

```typescript
describe("ProxySession - isHeaderModified", () => {
  it("should detect modified header", () => {
    const headers = new Headers([["user-agent", "original"]]);
    const session = createSessionForHeaders(headers);

    session.headers.set("user-agent", "modified");

    expect(session.isHeaderModified("user-agent")).toBe(true);
  });

  it("should detect unmodified header", () => {
    const headers = new Headers([["user-agent", "same"]]);
    const session = createSessionForHeaders(headers);

    expect(session.isHeaderModified("user-agent")).toBe(false);
  });

  it("should handle non-existent header", () => {
    const headers = new Headers();
    const session = createSessionForHeaders(headers);

    expect(session.isHeaderModified("x-custom")).toBe(false);
  });

  it("should detect deleted header", () => {
    const headers = new Headers([["user-agent", "original"]]);
    const session = createSessionForHeaders(headers);

    session.headers.delete("user-agent");

    expect(session.isHeaderModified("user-agent")).toBe(true);
  });

  it("should detect added header", () => {
    const headers = new Headers();
    const session = createSessionForHeaders(headers);

    session.headers.set("x-new-header", "new-value");

    expect(session.isHeaderModified("x-new-header")).toBe(true);
  });

  it("should distinguish empty string from null", () => {
    const headers = new Headers([["x-test", ""]]);
    const session = createSessionForHeaders(headers);

    session.headers.delete("x-test");

    expect(session.isHeaderModified("x-test")).toBe(true); // "" -> null
    expect(session.headers.get("x-test")).toBeNull();
  });
});
```

### 6.2 Request Filter Engine Tests

**File**: `/Users/ding/Github/claude-code-hub/tests/unit/request-filter-engine.test.ts`

Tests cover:
- Header removal filters
- Header set filters
- Priority ordering
- Provider binding
- Group binding
- Fail-open behavior

---

## 8. Migration History

### 8.1 Initial Creation

**File**: `/Users/ding/Github/claude-code-hub/drizzle/0024_request-filters.sql`

```sql
CREATE TABLE IF NOT EXISTS "request_filters" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" varchar(100) NOT NULL,
    "description" text,
    "scope" varchar(20) NOT NULL,
    "action" varchar(30) NOT NULL,
    "match_type" varchar(20),
    "target" text NOT NULL,
    "replacement" jsonb,
    "priority" integer DEFAULT 0 NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);
```

### 8.2 Binding Support Addition

**File**: `/Users/ding/Github/claude-code-hub/drizzle/0041_sticky_jackal.sql`

```sql
ALTER TABLE "request_filters" ADD COLUMN "binding_type" varchar(20) DEFAULT 'global' NOT NULL;
ALTER TABLE "request_filters" ADD COLUMN "provider_ids" jsonb;
ALTER TABLE "request_filters" ADD COLUMN "group_tags" jsonb;
CREATE INDEX IF NOT EXISTS "idx_request_filters_binding" ON "request_filters" USING btree ("is_enabled","binding_type");
```

This migration added the ability to bind filters to specific providers or provider groups, enabling more granular control over header modifications.

---

## 9. References

### 7.1 Key Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` | Core filter engine implementation |
| `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts` | Type definitions and CRUD operations |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (Lines 508-536) | Database schema |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` | ProxySession with header tracking |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts` | Global filter middleware |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts` | Provider filter middleware |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/headers.ts` | HeaderProcessor for sanitization |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` | Forwarder with header building |
| `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts` | Server actions for filter management |

### 7.2 Related Documentation

- Request Filters (general concept)
- Body Modification (similar system for request body)
- Provider Configuration (for binding types)
- Special Settings (for anthropic-beta header handling)

---

## 10. Best Practices

### 10.1 Header Filter Design

1. **Use descriptive names**: Name filters clearly to indicate their purpose (e.g., "Remove Internal Token", "Set Custom User-Agent")
2. **Set appropriate priorities**: Use priority to control filter execution order when multiple filters target the same header
3. **Test before enabling**: Use the filter dialog to validate configurations before enabling in production
4. **Monitor filter effects**: Check request logs to verify filters are working as expected

### 10.2 Common Use Cases

| Use Case | Scope | Action | Target | Replacement |
|----------|-------|--------|--------|-------------|
| Remove internal auth | header | remove | x-internal-token | - |
| Standardize User-Agent | header | set | user-agent | "MyApp/1.0" |
| Add tracking header | header | set | x-request-source | "claude-code-hub" |
| Remove client IP | header | remove | x-forwarded-for | - |
| Override API version | header | set | anthropic-version | "2023-06-01" |

### 10.3 Performance Considerations

1. **Filter count**: The engine uses early exit optimizations when no filters are configured
2. **Binding type**: Global filters are slightly faster than provider/group filters (no matching logic)
3. **Priority sorting**: Filters are pre-sorted by priority during engine initialization
4. **Set-based lookups**: Provider and group filters use Set data structures for O(1) lookups

### 10.4 Security Considerations

1. **ReDoS protection**: Regex patterns in body filters are validated using `safe-regex`
2. **Fail-open design**: Filter failures don't block requests
3. **Authorization headers**: These are always overwritten by the forwarder; filters cannot leak credentials
4. **Audit trail**: Header modifications can be detected via `isHeaderModified()` and logged

---

## 11. Summary

Header Modification in claude-code-hub is a flexible, multi-layered system that allows administrators to:

1. **Remove sensitive headers** before they reach external providers
2. **Set custom header values** for request normalization
3. **Apply rules globally** or to specific providers/groups
4. **Preserve filter modifications** through the proxy pipeline

The system is designed with:
- **Fail-open safety**: Filter errors don't break requests
- **Performance optimizations**: Pre-compiled filters, Set-based lookups
- **Hot reload**: Filters update without restart via event emitter
- **Audit trail**: Header modifications can be detected and logged

Understanding this system is essential for:
- Privacy compliance (GDPR, CCPA)
- Multi-tenant isolation
- Provider-specific customizations
- Debugging and request tracing
