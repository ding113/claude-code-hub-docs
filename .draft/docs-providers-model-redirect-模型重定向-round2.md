# Model Redirect (模型重定向) - Round 2 Verified Draft

## Intent Analysis

The model redirect functionality in claude-code-hub serves a critical architectural purpose: it enables administrators to transparently rewrite model names in incoming requests before they're forwarded to upstream providers. This capability is fundamental to building a flexible, cost-effective, and multi-provider AI proxy infrastructure.

### Primary Use Cases

**1. Cost Optimization**

One of the most common use cases for model redirects is cost optimization. Organizations can route expensive model requests to more cost-effective alternatives without requiring any changes to client code. For example:

```typescript
// Client requests (expensive)
"claude-3-opus-20240229"

// Redirected to (cost-effective)
"claude-3-sonnet-20240229"
```

This allows administrators to implement cost-saving strategies gradually. They can start by redirecting internal or non-critical workloads to cheaper models while keeping production workloads on premium models. Over time, as confidence in the cheaper models grows, the redirect rules can be expanded.

**2. Third-Party AI Service Integration**

When integrating with third-party AI providers, especially those in different regions or with different API conventions, model redirects become essential. For example, a Chinese AI provider might use model names like `glm-4` or `qwen-max`, while your internal applications expect standard Claude model names.

```typescript
// Client requests (standard Anthropic naming)
"claude-3-opus-20240229"

// Redirected to (third-party provider naming)
"glm-4"
```

This abstraction layer allows client applications to use familiar model names while the proxy handles the translation to provider-specific naming conventions.

**3. Model Alias Management**

Organizations often want to create their own model aliases that are independent of the underlying provider. For example:

```typescript
// Internal alias
"company-large-model"

// Redirected based on provider
// Provider A: "gpt-4-turbo"
// Provider B: "claude-3-opus-20240229"
// Provider C: "gemini-1.5-pro"
```

This approach provides several benefits:
- **Provider Independence**: Applications reference internal aliases, making it easy to switch underlying providers
- **Simplified Client Configuration**: Clients only need to know a small set of internal model names
- **Gradual Migrations**: New models can be introduced by updating redirect rules rather than client code

**4. A/B Testing and Gradual Rollouts**

Model redirects enable sophisticated A/B testing strategies. By configuring different providers with different redirect rules, administrators can gradually shift traffic from one model to another:

```typescript
// Provider A (70% of traffic)
"claude-3-sonnet" → "claude-3-sonnet-20240229"

// Provider B (30% of traffic)
"claude-3-sonnet" → "claude-3-sonnet-20241022"
```

This allows for real-world testing of new model versions with a controlled portion of traffic before full rollout.

**5. Fallback and Degradation Strategies**

In high-availability scenarios, redirects can implement graceful degradation:

```typescript
// Primary: Claude 3 Opus
"critical-analysis" → "claude-3-opus-20240229"

// Fallback during outages: Claude 3 Sonnet
"critical-analysis" → "claude-3-sonnet-20240229"
```

By updating redirect rules dynamically, operators can respond to outages or performance issues without client intervention.

### Core Design Philosophy

The fundamental principle of model redirects is **transparency**. Clients request the model they expect, and the proxy silently transforms this to the actual model the upstream provider should receive. This transparency is maintained across:

- **Request/Response Cycle**: Clients receive responses as if they were talking to the requested model
- **Error Handling**: Errors are returned in the format expected by the client
- **Billing**: Original model names are preserved for accurate billing and usage tracking
- **Logging**: Both original and redirected model names are logged for audit purposes

This design ensures that model redirects are a purely operational concern - they don't leak into the client application logic or user experience.

## Behavior Summary

### Core Mechanism

The model redirect system operates through the `ModelRedirector` class located at `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts`. This class provides static methods that are invoked during the request forwarding phase, specifically after provider selection but before request transmission.

#### Request Flow with Model Redirects

The redirect process follows a well-defined sequence:

```
┌─────────────────┐
│  Client Request │  Model: "claude-3-opus-20240229"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Provider Select │  Selects Provider A based on health, weight, etc.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ModelRedirector │  Checks Provider A's modelRedirects
│    .apply()     │  Finds: "claude-3-opus-20240229" → "claude-3-sonnet-20240229"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Request Modify  │  Updates request body and/or URL
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Forward Request │  Sends to Provider A with redirected model
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Return Response │  Client receives response (unaware of redirect)
└─────────────────┘
```

**Step 1: Request Reception**

A client sends a request with a specific model name. This can be any model name the client expects to use:

```typescript
// Example request body
{
  "model": "claude-3-opus-20240229",
  "messages": [...],
  "max_tokens": 4096
}
```

The model name is extracted during session creation in `ProxySession.fromContext()`:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts (line 168)
const modelFromBody =
  typeof bodyResult.requestMessage.model === "string"
    ? bodyResult.requestMessage.model
    : null;
```

**Step 2: Provider Selection**

The proxy's provider selection logic (`ProxyProviderResolver.pickRandomProvider()`) selects an upstream provider based on:
- Health status (circuit breaker state)
- Rate limiting status
- Provider group membership
- Model support (including redirect rules)
- Weight and priority

**Step 3: Redirect Application**

Before forwarding, `ModelRedirector.apply()` is called at line 1134 in `forwarder.ts`:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts (lines 1133-1139)
// 应用模型重定向（如果配置了）
const wasRedirected = ModelRedirector.apply(session, provider);
if (wasRedirected) {
  logger.debug("ProxyForwarder: Model redirected", {
    providerId: provider.id,
  });
}
```

The `apply()` method performs several operations:
1. Retrieves the original model from the session
2. Checks if the provider has redirect rules configured
3. Looks up the requested model in the redirect map
4. If found, applies the redirect and updates the session

**Step 4: Model Transformation**

If a redirect is found, the model name is rewritten. The exact transformation depends on the provider type:

For Claude/OpenAI providers:
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 98-99)
session.request.message.model = redirectedModel;
session.request.model = redirectedModel;
```

For Gemini providers:
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 74-96)
if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
  const originalPath = session.requestUrl.pathname;
  const newPath = originalPath.replace(
    /\/models\/([^/:]+)(:[^/]+)?$/,
    `/models/${redirectedModel}$2`
  );
  // ... URL update logic
}
```

**Step 5: Request Forwarding**

The modified request is serialized and sent to the upstream provider:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 105-107)
const updatedBody = JSON.stringify(session.request.message);
const encoder = new TextEncoder();
session.request.buffer = encoder.encode(updatedBody).buffer;
```

**Step 6: Response Return**

The response from the upstream provider is returned to the client. The client remains completely unaware that a redirect occurred - they receive a response as if they had directly requested the original model.

### Key Design Decisions

**Original Model Preservation**

The system always preserves the original model name requested by the client. This is a critical design decision that enables several important features:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (line 69)
// Save original model BEFORE modification
session.setOriginalModel(originalModel);

// Then modify the request
session.request.message.model = redirectedModel;
session.request.model = redirectedModel;
```

The preserved original model is used for:

1. **Billing Calculations**: Users are charged based on what they requested, not what was actually used. This ensures pricing transparency and prevents unexpected charges when redirects are applied.

2. **Audit Logging**: Request logs show both the original and redirected models, providing a complete audit trail:
   ```typescript
   // From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (line 110)
   session.request.note = `[Model Redirected: ${originalModel} → ${redirectedModel}] ${session.request.note || ""}`;
   ```

3. **Provider Chain Recording**: Each redirect is recorded in the provider chain for debugging:
   ```typescript
   // From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 116-120)
   lastDecision.modelRedirect = {
     originalModel: originalModel,
     redirectedModel: redirectedModel,
     billingModel: originalModel,
   };
   ```

**Provider-Specific Redirects**

Redirects are configured per-provider, not globally. This is a deliberate design choice that provides maximum flexibility:

```typescript
// Provider A configuration
{
  name: "Provider A",
  modelRedirects: {
    "claude-3-opus": "gpt-4-turbo",
    "claude-3-sonnet": "gpt-3.5-turbo"
  }
}

// Provider B configuration
{
  name: "Provider B",
  modelRedirects: {
    "claude-3-opus": "glm-4",
    "claude-3-sonnet": "glm-3.5"
  }
}
```

This allows different providers to handle the same model name differently based on their capabilities and pricing.

**Reset on Provider Switch**

When a request fails and needs to be retried with a different provider, the model is reset to its original value:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 25-30)
if (!provider.modelRedirects || Object.keys(provider.modelRedirects).length === 0) {
  if (session.isModelRedirected() && trueOriginalModel) {
    ModelRedirector.resetToOriginal(session, trueOriginalModel, provider);
  }
  return false;
}
```

This ensures that each provider's redirect rules are applied to the original model name, not a previously redirected one. Without this reset, Provider B might receive a model name that was already redirected by Provider A, leading to incorrect behavior.

### Provider Type Handling

The system handles model redirects differently based on the provider type. This provider-specific handling is necessary because different AI providers use different mechanisms to specify the target model.

#### Claude/OpenAI Compatible Providers

For Claude (`claude`, `claude-auth`) and OpenAI-compatible (`openai-compatible`, `codex`) providers, the model name is passed in the request body as a JSON field:

```typescript
// Typical request body
{
  "model": "claude-3-opus-20240229",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "max_tokens": 1024
}
```

The redirector modifies the model field in the parsed message object:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 98-99)
session.request.message.model = redirectedModel;
session.request.model = redirectedModel;

// Regenerate the request buffer with the new model (lines 105-107)
const updatedBody = JSON.stringify(session.request.message);
const encoder = new TextEncoder();
session.request.buffer = encoder.encode(updatedBody).buffer;
```

The buffer regeneration is crucial because the HTTP client sends `session.request.buffer` to the upstream provider, not the parsed message object.

#### Gemini Providers

Gemini APIs (`gemini`, `gemini-cli`) use a different approach - the model name is embedded in the URL path rather than the request body:

```
POST /v1beta/models/gemini-2.5-flash:generateContent
```

This design choice by Google means the redirector must modify the URL path instead of the request body. The implementation uses regex pattern matching:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 74-96)
if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
  const originalPath = session.requestUrl.pathname;

  // Match pattern: /models/{model}:action or /models/{model}
  const newPath = originalPath.replace(
    /\/models\/([^/:]+)(:[^/]+)?$/,
    `/models/${redirectedModel}$2`
  );

  if (newPath !== originalPath) {
    const newUrl = new URL(session.requestUrl.toString());
    newUrl.pathname = newPath;
    session.requestUrl = newUrl;

    logger.debug(`[ModelRedirector] Updated Gemini URL path`, {
      originalPath,
      newPath,
      originalModel,
      redirectedModel,
    });
  }
}
```

The regex `/\/models\/([^/:]+)(:[^/]+)?$/` breaks down as:
- `\/models\/`: Matches the literal `/models/` path segment
- `([^/:]+)`: Captures the model name (any character except `/` or `:`)
- `(:[^/]+)?`: Optionally captures the action (e.g., `:generateContent`, `:streamGenerateContent`)
- `$`: Ensures the match is at the end of the path

This ensures the correct model is invoked even when the upstream provider uses URL-based model specification.

#### Reset Behavior for Gemini

When resetting to the original model (during provider failover), the Gemini URL path must also be restored:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 174-187)
private static resetToOriginal(
  session: ProxySession,
  originalModel: string,
  provider: Provider
): void {
  // Reset Gemini URL path if applicable
  if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
    const originalPathname = session.getOriginalUrlPathname();
    if (originalPathname && originalPathname !== session.requestUrl.pathname) {
      const newUrl = new URL(session.requestUrl.toString());
      newUrl.pathname = originalPathname;
      session.requestUrl = newUrl;

      logger.debug("[ModelRedirector] Reset Gemini URL path to original", {
        originalPathname,
        providerId: provider.id,
        providerName: provider.name,
      });
    }
  }
  // ... rest of reset logic
}
```

This ensures that when switching from a Gemini provider to another provider (or vice versa), the URL path correctly reflects the model being requested.

## Configuration

### Provider Configuration Schema

Model redirects are stored in the `modelRedirects` field of the Provider entity. This field is defined in the Provider type at `/Users/ding/Github/claude-code-hub/src/types/provider.ts`:

```typescript
// From /Users/ding/Github/claude-code-hub/src/types/provider.ts (line 60)
export interface Provider {
  id: number;
  name: string;
  url: string;
  key: string;
  providerVendorId: number | null;
  isEnabled: boolean;
  weight: number;
  priority: number;
  costMultiplier: number;
  groupTag: string | null;
  providerType: ProviderType;
  preserveClientIp: boolean;
  modelRedirects: Record<string, string> | null;  // <-- Model redirect configuration
  allowedModels: string[] | null;
  joinClaudePool: boolean;
  // ... additional fields
}
```

The `modelRedirects` field is a simple key-value mapping where:
- **Key**: The model name requested by the client (source model)
- **Value**: The model name to send to the upstream provider (target model)

This structure allows for straightforward lookup during request processing. When a request arrives with model "X", the system checks `provider.modelRedirects["X"]`. If a value exists, that's the model name sent to the provider; if not, the original name is used.

### Data Flow in Configuration

The configuration flows through several layers:

```
UI Form (ModelRedirectEditor)
    ↓
API Request (CreateProviderSchema/UpdateProviderSchema)
    ↓
Server Action (createProvider/updateProvider)
    ↓
Database (providers table, model_redirects JSONB column)
    ↓
Provider Cache (findAllProviders)
    ↓
Request Processing (ModelRedirector.apply)
```

### Database Schema

In the Drizzle ORM schema, `modelRedirects` is stored as a JSONB column:

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (line 182)
modelRedirects: jsonb('model_redirects').$type<Record<string, string>>(),
```

### Validation Schema

When creating or updating providers, the model redirects are validated using Zod:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts (lines 383, 562)
model_redirects: z.record(z.string(), z.string()).nullable().optional(),
```

This validation ensures that:
- Keys are non-empty strings (source model names)
- Values are non-empty strings (target model names)
- The entire record can be null (no redirects configured)

### UI Configuration

Administrators configure model redirects through the provider settings UI. The `ModelRedirectEditor` component (`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/model-redirect-editor.tsx`) provides:

1. **Visual Rule Management**: Display existing redirects as source → target pairs
2. **Add New Rules**: Input fields for source and target model names
3. **Edit Existing Rules**: Inline editing of target models
4. **Delete Rules**: Remove unwanted redirects
5. **Validation**: Prevent empty inputs and duplicate source models

The UI enforces that:
- Source model names cannot be empty (validated with `newSource.trim()`)
- Target model names cannot be empty (validated with `newTarget.trim()`)
- Duplicate source models are not allowed (checked via `value[newSource.trim()]`)

### API Configuration

When creating or updating providers via the API, model redirects are passed as JSON:

```typescript
// POST /api/providers
{
  "name": "My Provider",
  "url": "https://api.example.com",
  "key": "sk-...",
  "model_redirects": {
    "claude-3-opus-20240229": "claude-3-sonnet-20240229",
    "gpt-4": "gpt-3.5-turbo"
  }
}
```

## Edge Cases

### Edge Case 1: No Redirect Configured

**Scenario**: A provider has no `modelRedirects` configuration (null or empty object).

**Behavior**: The `ModelRedirector.apply()` method returns `false` immediately without modifying the request. The original model name is sent to the provider.

**Code Reference**:
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 25-30)
if (!provider.modelRedirects || Object.keys(provider.modelRedirects).length === 0) {
  // If new provider has no redirect config and previous redirect occurred, reset
  if (session.isModelRedirected() && trueOriginalModel) {
    ModelRedirector.resetToOriginal(session, trueOriginalModel, provider);
  }
  return false;
}
```

### Edge Case 2: Model Not in Redirect Map

**Scenario**: The requested model doesn't have a redirect rule in the provider's configuration.

**Behavior**: The redirector checks if the model exists in the redirect map. If not, it either:
- Resets to original if a previous redirect occurred (during provider failover)
- Returns false without modification if no previous redirect

**Code Reference**:
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 44-56)
const redirectedModel = provider.modelRedirects[originalModel];
if (!redirectedModel) {
  if (session.isModelRedirected()) {
    ModelRedirector.resetToOriginal(session, originalModel, provider);
  }
  return false;
}
```

### Edge Case 3: Provider Failover with Redirects

**Scenario**: A request is redirected to Model A and sent to Provider 1. Provider 1 fails, and the request needs to be retried with Provider 2.

**Behavior**:
1. The model is reset to its original value
2. Provider 2's redirect rules are applied to the original model
3. This ensures each provider's redirects are evaluated against the original request

**Code Reference** (in `resetToOriginal` at lines 164-198):
```typescript
private static resetToOriginal(
  session: ProxySession,
  originalModel: string,
  provider: Provider
): void {
  session.request.model = originalModel;
  session.request.message.model = originalModel;
  // Reset Gemini URL path if applicable
  // Regenerate request buffer
}
```

**Safety Limit**: The forwarder has a maximum provider switch limit to prevent infinite loops:
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts (line 70)
const MAX_PROVIDER_SWITCHES = 20; // 保险栓：最多切换 20 次供应商
```

### Edge Case 4: Gemini URL Path Redirects

**Scenario**: A Gemini request comes in with model `gemini-2.5-flash` in the URL path, but the provider needs to redirect to `gemini-2.0-flash`.

**Behavior**: The redirector detects the provider type and modifies the URL path instead of the request body:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 74-96)
if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
  const originalPath = session.requestUrl.pathname;
  const newPath = originalPath.replace(
    /\/models\/([^/:]+)(:[^/]+)?$/,
    `/models/${redirectedModel}$2`
  );
  // Create new URL object with modified path
  const newUrl = new URL(session.requestUrl.toString());
  newUrl.pathname = newPath;
  session.requestUrl = newUrl;
}
```

### Edge Case 5: Billing Model Source Configuration

**Scenario**: System admin needs to decide whether to bill based on the original model or the redirected model.

**Behavior**: The system supports a `billingModelSource` configuration with two options:
- `"original"`: Bill using the original model's pricing (default)
- `"redirected"`: Bill using the redirected model's pricing

**Code Reference** (from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts`, lines 1735-1743):
```typescript
if (billingModelSource === "original") {
  // 优先使用重定向前的原始模型
  primaryModel = originalModel;
  fallbackModel = redirectedModel;
} else {
  // 优先使用重定向后的实际模型
  primaryModel = redirectedModel;
  fallbackModel = originalModel;
}
```

**Database Schema** (from `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`, line 564):
```typescript
billingModelSource: varchar('billing_model_source', { length: 20 }).notNull().default('original'),
```

### Edge Case 6: Model Redirect with Provider Chain

**Scenario**: A request goes through multiple providers due to failures, and we need to track which redirects were applied.

**Behavior**: Each redirect is recorded in the provider chain decision context:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 113-126)
const providerChain = session.getProviderChain();
if (providerChain.length > 0) {
  const lastDecision = providerChain[providerChain.length - 1];
  lastDecision.modelRedirect = {
    originalModel: originalModel,
    redirectedModel: redirectedModel,
    billingModel: originalModel, // 始终使用原始模型计费
  };
}
```

This allows administrators to see the complete redirect history for debugging and auditing.

### Edge Case 7: Empty or Whitespace Model Names

**Scenario**: A redirect configuration has empty strings or whitespace-only values.

**Behavior**: The UI validation prevents this during configuration:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/model-redirect-editor.tsx (lines 35-42)
if (!newSource.trim()) {
  setError(t("sourceEmpty"));
  return;
}
if (!newTarget.trim()) {
  setError(t("targetEmpty"));
  return;
}
```

At runtime, empty models are handled gracefully:
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 35-41)
if (!originalModel) {
  logger.debug("[ModelRedirector] No model in request, skipping redirect", {...});
  return false;
}
```

### Edge Case 8: Circular Redirects

**Scenario**: Provider A redirects Model X to Model Y, and Provider B redirects Model Y back to Model X.

**Behavior**: This is not inherently prevented by the system. However, since redirects are provider-specific and the model is reset on provider switch, a true circular redirect within a single request is not possible. Each provider's redirect is applied independently.

The system relies on:
- Original model preservation via `setOriginalModel()` (only sets once per session)
- Provider-specific redirect evaluation
- Automatic reset during provider failover

### Edge Case 9: Model Redirects with joinClaudePool

**Scenario**: A non-Anthropic provider has `joinClaudePool` enabled and redirects a Claude model to another model.

**Behavior**: When evaluating if a provider supports a Claude model, the system checks if the redirected model is also a Claude model:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts (lines 133-137)
if (provider.joinClaudePool) {
  const redirectedModel = provider.modelRedirects?.[requestedModel];
  return redirectedModel?.startsWith("claude-") || false;
}
```

This ensures that only providers redirecting to actual Claude models are considered for Claude model requests when in the Claude pool.

### Edge Case 10: Model Redirects with allowedModels

**Scenario**: A provider has both `allowedModels` and `modelRedirects` configured.

**Behavior**: The `providerSupportsModel` function checks both:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts (lines 147-151)
const explicitlyDeclared = !!(
  provider.allowedModels?.includes(requestedModel) || provider.modelRedirects?.[requestedModel]
);

if (explicitlyDeclared) {
  return true; // 显式声明优先级最高，允许跨类型代理
}
```

A model is considered supported if it's either in the allowed list OR has a redirect rule. This allows providers to declare support for models they redirect to.

## References

### Core Implementation Files

1. **`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts`** (200 lines)
   - The main `ModelRedirector` class
   - Contains `apply()` at line 20, `getRedirectedModel()` at line 138, `hasRedirect()` at line 153
   - Private `resetToOriginal()` at line 164
   - Handles provider-specific redirect logic and Gemini URL path modification

2. **`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts`**
   - `ProxySession` class manages original model preservation
   - `getOriginalModel()` at lines 529-531
   - `setOriginalModel()` at lines 568-573
   - `isModelRedirected()` at lines 578-580
   - `getOriginalUrlPathname()` at lines 585-587
   - Stores `originalModelName` (line 82) and `originalUrlPathname` (line 85)

3. **`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`**
   - `providerSupportsModel()` function at lines 115-172
   - Considers both `allowedModels` and `modelRedirects` for support determination
   - Handles `joinClaudePool` logic with redirect validation at lines 133-137

4. **`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`**
   - Calls `ModelRedirector.apply()` at line 1134
   - Integrates redirect logic into the request forwarding flow
   - `MAX_PROVIDER_SWITCHES = 20` safety limit at line 70

5. **`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/message-service.ts`**
   - `ProxyMessageService.ensureContext()` saves original model before redirect at lines 24-32
   - Ensures billing uses the correct original model name

6. **`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts`**
   - Cost calculation uses `billingModelSource` configuration
   - Supports billing by original or redirected model
   - Lines 1735-1743 handle billing model selection

### Type Definitions

7. **`/Users/ding/Github/claude-code-hub/src/types/provider.ts`**
   - `Provider` interface defines `modelRedirects: Record<string, string> | null` at line 60
   - `CreateProviderData` and `UpdateProviderData` include `model_redirects` field at lines 252, 322
   - `ProviderType` union type at lines 6-12

8. **`/Users/ding/Github/claude-code-hub/src/types/message.ts`**
   - `ProviderChainItem` interface with `modelRedirect` field at lines 64-69
   - Contains `originalModel`, `redirectedModel`, `billingModel` fields

9. **`/Users/ding/Github/claude-code-hub/src/types/system-config.ts`**
   - `BillingModelSource` type definition: `"original" | "redirected"` at line 3

### Validation and Repository

10. **`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`**
    - Zod schema for `model_redirects` validation at lines 383, 562
    - `billingModelSource` validation at lines 729-730

11. **`/Users/ding/Github/claude-code-hub/src/repository/provider.ts`**
    - Database operations for provider CRUD
    - Handles `modelRedirects` JSON serialization/deserialization
    - Line 38 (create), 93 (returning), 173 (select)

12. **`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`**
    - `modelRedirects` JSONB column at line 182
    - `billingModelSource` column at line 564

### UI Components

13. **`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/model-redirect-editor.tsx`**
    - React component for managing redirect rules in the UI
    - Supports add, edit, delete operations
    - Validates input to prevent empty or duplicate entries

### Related Types

```typescript
// From /Users/ding/Github/claude-code-hub/src/types/provider.ts (lines 6-12)
export type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini"
  | "gemini-cli"
  | "openai-compatible";

// From /Users/ding/Github/claude-code-hub/src/types/provider.ts (line 60)
export interface Provider {
  id: number;
  name: string;
  url: string;
  key: string;
  providerType: ProviderType;
  modelRedirects: Record<string, string> | null;
  allowedModels: string[] | null;
  joinClaudePool: boolean;
  // ... other fields
}
```

### Provider Chain Item Type

```typescript
// From /Users/ding/Github/claude-code-hub/src/types/message.ts (lines 64-69)
interface ProviderChainItem {
  // ... other fields
  // 模型重定向信息（在供应商级别记录）
  modelRedirect?: {
    originalModel: string; // 用户请求的模型（计费依据）
    redirectedModel: string; // 实际转发的模型
    billingModel: string; // 计费模型（通常等于 originalModel）
  };
  // ... other fields
}
```

## Integration Points

### With Provider Selection

Model redirects influence provider selection through the `providerSupportsModel()` function. A provider is considered capable of handling a model if:
1. It's an Anthropic provider and the model is Claude (with optional allowedModels whitelist)
2. It's a non-Anthropic provider with `joinClaudePool` that redirects the Claude model to another Claude model
3. The model is explicitly declared in `allowedModels` or has a redirect rule

### With Billing

The billing system uses the original model name by default, but can be configured to use the redirected model name. This is controlled by the `billingModelSource` system setting (default: `"original"`). The billing logic in `updateRequestCostFromUsage()` handles the selection:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts (lines 1735-1743)
if (billingModelSource === "original") {
  primaryModel = originalModel;
  fallbackModel = redirectedModel;
} else {
  primaryModel = redirectedModel;
  fallbackModel = originalModel;
}
```

### With Request Logging

Every redirect is logged with detailed information:
- Original model name
- Redirected model name
- Provider ID and name
- Provider type
- Timestamp

These logs are available in the request details for debugging and auditing purposes.

### With Session Management

The session tracks whether a redirect has occurred via `isModelRedirected()`. This flag is used during provider failover to determine if the model needs to be reset to its original value before applying a new provider's redirect rules.

## Additional Implementation Details

### ModelRedirector Class API

The `ModelRedirector` class provides a clean, static-method-based API for working with model redirects:

#### `apply(session: ProxySession, provider: Provider): boolean`

The main entry point for applying model redirects. This method:
1. Retrieves the original model from the session
2. Checks if the provider has redirect rules
3. Applies the redirect if found
4. Returns `true` if a redirect was applied, `false` otherwise

```typescript
// Usage in forwarder.ts (line 1134)
const wasRedirected = ModelRedirector.apply(session, provider);
if (wasRedirected) {
  logger.debug("ProxyForwarder: Model redirected", {
    providerId: provider.id,
  });
}
```

#### `getRedirectedModel(originalModel: string, provider: Provider): string`

A utility method that returns the redirected model name without modifying the session. This is useful for previewing what model would be used:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 138-144)
static getRedirectedModel(originalModel: string, provider: Provider): string {
  if (!provider.modelRedirects || !originalModel) {
    return originalModel;
  }
  return provider.modelRedirects[originalModel] || originalModel;
}
```

#### `hasRedirect(model: string, provider: Provider): boolean`

Checks if a provider has a redirect configured for a specific model:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 153-155)
static hasRedirect(model: string, provider: Provider): boolean {
  return !!(provider.modelRedirects && model && provider.modelRedirects[model]);
}
```

#### `resetToOriginal(session: ProxySession, originalModel: string, provider: Provider): void`

Private method that resets the session to use the original model. This is called during provider failover to ensure clean state for the next provider.

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 164-198)
private static resetToOriginal(
  session: ProxySession,
  originalModel: string,
  provider: Provider
): void {
  session.request.model = originalModel;
  session.request.message.model = originalModel;

  // Reset Gemini URL path if applicable
  if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
    const originalPathname = session.getOriginalUrlPathname();
    if (originalPathname && originalPathname !== session.requestUrl.pathname) {
      const newUrl = new URL(session.requestUrl.toString());
      newUrl.pathname = originalPathname;
      session.requestUrl = newUrl;
    }
  }

  // Re-generate request buffer
  const updatedBody = JSON.stringify(session.request.message);
  session.request.buffer = new TextEncoder().encode(updatedBody).buffer;

  logger.info("[ModelRedirector] Reset model to original (provider switch)", {...});
}
```

### Integration with Provider Selection

Model redirects play a crucial role in the provider selection process. The `providerSupportsModel()` function in `provider-selector.ts` considers redirects when determining if a provider can handle a request:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts (lines 115-172)
function providerSupportsModel(provider: Provider, requestedModel: string): boolean {
  const isClaudeModel = requestedModel.startsWith("claude-");
  const isClaudeProvider =
    provider.providerType === "claude" || provider.providerType === "claude-auth";

  // Case 1: Claude model requests
  if (isClaudeModel) {
    // Anthropic providers handle based on allowedModels
    if (isClaudeProvider) {
      if (!provider.allowedModels || provider.allowedModels.length === 0) {
        return true;
      }
      return provider.allowedModels.includes(requestedModel);
    }

    // Non-Anthropic providers with joinClaudePool
    if (provider.joinClaudePool) {
      const redirectedModel = provider.modelRedirects?.[requestedModel];
      // Only support if redirecting to another Claude model
      return redirectedModel?.startsWith("claude-") || false;
    }

    return false;
  }

  // Case 2: Non-Claude models
  const explicitlyDeclared = !!(
    provider.allowedModels?.includes(requestedModel) ||
    provider.modelRedirects?.[requestedModel]
  );

  if (explicitlyDeclared) {
    return true;
  }
  // ... rest of logic
}
```

This integration ensures that:
1. Providers with redirects for a model are considered capable of handling that model
2. Non-Anthropic providers in the Claude pool must redirect to actual Claude models
3. Explicit declarations (either via allowedModels or modelRedirects) take priority

### Logging and Observability

Model redirects generate detailed logs for observability:

**Redirect Applied Log:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 57-66)
logger.info("[ModelRedirector] Model redirected", {
  originalModel,
  redirectedModel,
  providerId: provider.id,
  providerName: provider.name,
  providerType: provider.providerType,
});
```

**Gemini URL Update Log:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 85-91)
logger.debug(`[ModelRedirector] Updated Gemini URL path`, {
  originalPath,
  newPath,
  originalModel,
  redirectedModel,
});
```

**Reset Log:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts (lines 193-197)
logger.info("[ModelRedirector] Reset model to original (provider switch)", {
  originalModel,
  providerId: provider.id,
  providerName: provider.name,
});
```

These logs enable administrators to:
- Track which redirects are being applied
- Debug issues with model routing
- Monitor the effectiveness of cost optimization strategies
- Audit model usage for compliance

### Performance Considerations

Model redirects are designed to have minimal performance impact:

1. **O(1) Lookup**: Redirect lookups use JavaScript object property access, which is O(1)
2. **No Database Queries**: Redirects are loaded as part of the provider configuration, avoiding additional database queries during request processing
3. **Lazy Evaluation**: Redirects are only evaluated when a provider is selected, not during provider filtering
4. **Minimal Memory Overhead**: The redirect map is stored as a simple object with string keys and values

### Security Considerations

While model redirects are primarily an operational feature, there are security aspects to consider:

1. **Input Validation**: The UI and API validate that model names are non-empty strings
2. **No Code Execution**: Redirect values are treated as opaque strings, not evaluated as code
3. **Audit Trail**: All redirects are logged with provider information for security auditing
4. **Access Control**: Redirect configuration is only available to administrators through the settings UI

### Best Practices

Based on the implementation, here are recommended best practices for using model redirects:

1. **Start Conservative**: Begin with a small set of redirects and expand gradually
2. **Monitor Logs**: Regularly review logs to ensure redirects are working as expected
3. **Test Failover**: Verify that provider failover works correctly with your redirect configuration
4. **Document Redirects**: Maintain documentation of why each redirect exists
5. **Use Consistent Naming**: Establish conventions for model names to avoid confusion
6. **Review Regularly**: Periodically review redirect rules to ensure they're still needed

## Summary

The model redirect functionality in claude-code-hub provides a powerful and flexible mechanism for transparently rewriting model names in AI proxy requests. It serves as a critical abstraction layer that enables cost optimization, third-party integration, and operational flexibility.

### Key Characteristics

1. **Transparency**: Clients are completely unaware that redirects are occurring. They request the model they expect and receive responses in the expected format.

2. **Provider-Specific**: Each provider maintains its own redirect configuration, allowing different routing strategies for different upstream services.

3. **Billing Integrity**: Original model names are preserved throughout the request lifecycle, ensuring accurate billing and usage tracking based on what the client requested. The `billingModelSource` setting (default: `"original"`) controls whether to use original or redirected model pricing.

4. **Failover Safety**: The system intelligently resets models to their original values during provider failover, ensuring that each provider's redirect rules are evaluated against the original request. A `MAX_PROVIDER_SWITCHES = 20` limit prevents infinite loops.

5. **Format Awareness**: Special handling for different provider types (Claude/OpenAI body-based vs Gemini URL-based) ensures correct behavior across all supported APIs.

6. **Audit Trail**: Complete redirect history is recorded in the provider chain, enabling debugging, monitoring, and compliance auditing.

### Architectural Impact

Model redirects enable several architectural patterns:

- **Cost Optimization**: Route expensive models to cheaper alternatives without client changes
- **Provider Abstraction**: Use internal model names that map to different provider-specific names
- **Gradual Migration**: Shift traffic between models incrementally
- **High Availability**: Implement fallback strategies through redirect configuration

This feature demonstrates the proxy's design philosophy of providing operational flexibility while maintaining a simple, consistent interface for clients.
