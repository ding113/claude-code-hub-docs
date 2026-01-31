# Model Whitelist (模型白名单) - Round 1 Exploration Draft

## Intent Analysis

The Model Whitelist feature in Claude Code Hub serves a critical access control purpose: it enables administrators to restrict which AI models specific users or providers can access. This feature addresses several key operational needs:

1. **Cost Control**: Limit users to cheaper models to manage API spending
2. **Compliance**: Restrict access to only approved/authorized models in enterprise environments
3. **Quality Assurance**: Ensure users only access models that have been tested and validated
4. **Provider Management**: Control which models each provider endpoint can serve

The system implements two distinct layers of model whitelisting:
- **User-level whitelist**: Controls which models an individual user can request
- **Provider-level whitelist**: Controls which models a provider can serve (dual semantics based on provider type)

## Behavior Summary

### User-Level Model Whitelist

The user-level model whitelist is enforced by `ProxyModelGuard` in the request pipeline. Key behaviors:

**Empty/Undefined Whitelist (Default)**:
- When `user.allowedModels` is empty (`[]`) or undefined, no restrictions apply
- Users can request any model available through their assigned providers
- This is the default state for new users

**Non-Empty Whitelist**:
- When `user.allowedModels` contains one or more model names, restrictions are enforced
- The requested model MUST exactly match (case-insensitive) one of the allowed models
- Missing or null model in request → 400 error
- Model not in whitelist → 400 error with specific message

**Matching Logic**:
- Case-insensitive exact match (e.g., "claude-3-opus" matches "Claude-3-Opus")
- No pattern matching or wildcards supported
- Full model name must match (e.g., "claude-3-opus-20240229" must be explicitly listed)

### Provider-Level Model Whitelist (Dual Semantics)

The provider-level `allowedModels` field has different meanings depending on the provider type:

**For Anthropic Providers (claude, claude-auth)**:
- Acts as a **whitelist** - restricts which claude models can be served
- Empty/null = allow all claude-* models
- Non-empty = only allow listed models (exact match)

**For Non-Anthropic Providers (codex, gemini, gemini-cli, openai-compatible)**:
- Acts as a **declaration list** - declares which models the provider claims to support
- Empty/null = accept any model (passed to upstream for validation)
- Non-empty = only route listed models to this provider
- Used for provider selection logic, not strict enforcement

### Guard Pipeline Integration

The model guard executes at a specific point in the request processing pipeline:

```
CHAT_PIPELINE:
  auth → sensitive → client → [model] → version → probe → session → warmup → requestFilter → rateLimit → provider → providerRequestFilter → messageContext

COUNT_TOKENS_PIPELINE:
  auth → client → [model] → version → probe → requestFilter → provider → providerRequestFilter
```

The model guard runs after authentication, sensitive word detection, and client restrictions, but before provider selection. This ensures:
1. User is authenticated before checking model permissions
2. Invalid models are rejected before attempting provider selection
3. Rate limiting occurs after model validation

## Configuration & Management

### Database Schema

**User-Level Whitelist** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`, lines 71-73):

```typescript
// Allowed models (AI model restrictions)
// Empty array = no restrictions, non-empty = only listed models allowed
allowedModels: jsonb('allowed_models').$type<string[]>().default([]),
```

**Provider-Level Whitelist** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`, lines 184-188):

```typescript
// 模型列表：双重语义
// - Anthropic 提供商：白名单（管理员限制可调度的模型，可选）
// - 非 Anthropic 提供商：声明列表（提供商声称支持的模型，可选）
// - null 或空数组：Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型
allowedModels: jsonb('allowed_models').$type<string[] | null>().default(null),
```

### TypeScript Interfaces

**User Interface** (`/Users/ding/Github/claude-code-hub/src/types/user.ts`, lines 30-31):

```typescript
// Allowed models (AI model restrictions)
allowedModels?: string[]; // 允许的AI模型（空数组=无限制）
```

**Provider Interface** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts`, lines 62-66):

```typescript
// 模型列表：双重语义
// - Anthropic 提供商：白名单（管理员限制可调度的模型，可选）
// - 非 Anthropic 提供商：声明列表（提供商声称支持的模型，可选）
// - null 或空数组：Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型
allowedModels: string[] | null;
```

### Validation Rules

**User-Level Validation** (`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`, lines 157-161):

```typescript
// Allowed models (AI model restrictions)
allowedModels: z
  .array(z.string().max(64, "模型名称长度不能超过64个字符"))
  .max(50, "模型数量不能超过50个")
  .optional()
  .default([]),
```

Constraints:
- Maximum 50 models per user
- Each model name max 64 characters
- Model name pattern: `/^[a-zA-Z0-9._:/-]+$/` (alphanumeric, dots, colons, slashes, underscores, hyphens)

**Provider-Level Validation** (`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`, line 384):

```typescript
allowed_models: z.array(z.string()).nullable().optional(),
```

### API Endpoints

**User Management** (`/Users/ding/Github/claude-code-hub/src/actions/users.ts`):

Users can be created/updated with `allowedModels` field through the user management actions. The field is processed through `CreateUserSchema` and `UpdateUserSchema` validation.

**Provider Management** (`/Users/ding/Github/claude-code-hub/src/actions/providers.ts`):

Providers can be configured with `allowed_models` field:
- `addProvider()` - lines 454, 527
- `editProvider()` - lines 622

## Code Implementation Details

### Model Guard Implementation

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-guard.ts`

```typescript
/**
 * Model restriction guard
 *
 * Validates that the requested model is allowed based on user configuration.
 * This check is ONLY performed when the user has configured model restrictions (allowedModels).
 *
 * Logic:
 * - If allowedModels is empty or undefined: skip all checks, allow request
 * - If allowedModels is non-empty:
 *   - Missing or null model → 400 error
 *   - Model doesn't match any allowed pattern (exact, case-insensitive) → 400 error
 *   - Model matches at least one pattern → allow request
 *
 * Matching: case-insensitive exact match
 */
export class ProxyModelGuard {
  static async ensure(session: ProxySession): Promise<Response | null> {
    const user = session.authState?.user;
    if (!user) {
      // No user context - skip check (authentication should have failed already)
      return null;
    }

    // Check if model restrictions are configured
    const allowedModels = user.allowedModels ?? [];
    if (allowedModels.length === 0) {
      // No restrictions configured - skip all checks
      return null;
    }

    // Restrictions exist - now model is required
    const requestedModel = session.request.model;

    // Missing or null model when restrictions exist
    if (!requestedModel || requestedModel.trim() === "") {
      return ProxyResponses.buildError(
        400,
        "Model not allowed. Model specification is required when model restrictions are configured.",
        "invalid_request_error"
      );
    }

    // Case-insensitive exact match
    const requestedModelLower = requestedModel.toLowerCase();
    const isAllowed = allowedModels.some(
      (pattern) => pattern.toLowerCase() === requestedModelLower
    );

    if (!isAllowed) {
      return ProxyResponses.buildError(
        400,
        `Model not allowed. The requested model '${requestedModel}' is not in the allowed list.`,
        "invalid_request_error"
      );
    }

    // Model is allowed
    return null;
  }
}
```

### Provider Selection Logic

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`, lines 115-172

The `providerSupportsModel` function implements the dual semantics for provider-level allowedModels:

```typescript
function providerSupportsModel(provider: Provider, requestedModel: string): boolean {
  const isClaudeModel = requestedModel.startsWith("claude-");
  const isClaudeProvider =
    provider.providerType === "claude" || provider.providerType === "claude-auth";

  // Case 1: Claude 模型请求
  if (isClaudeModel) {
    // 1a. Anthropic 提供商
    if (isClaudeProvider) {
      // 未设置 allowedModels 或为空数组：允许所有 claude 模型
      if (!provider.allowedModels || provider.allowedModels.length === 0) {
        return true;
      }
      // 检查白名单
      return provider.allowedModels.includes(requestedModel);
    }

    // 1b. 非 Anthropic 提供商 + joinClaudePool
    if (provider.joinClaudePool) {
      const redirectedModel = provider.modelRedirects?.[requestedModel];
      // 检查是否重定向到 claude 模型
      return redirectedModel?.startsWith("claude-") || false;
    }

    // 1c. 其他情况：非 Anthropic 提供商且未加入 Claude 调度池
    return false;
  }

  // Case 2: 非 Claude 模型请求（gpt-*, gemini-*, 或其他任意模型）
  // 2a. 优先检查显式声明（支持跨类型代理）
  const explicitlyDeclared = !!(
    provider.allowedModels?.includes(requestedModel) || provider.modelRedirects?.[requestedModel]
  );

  if (explicitlyDeclared) {
    return true; // 显式声明优先级最高，允许跨类型代理
  }

  // 2b. Anthropic 提供商不支持非声明的非 Claude 模型
  if (isClaudeProvider) {
    return false;
  }

  // 2c. 非 Anthropic 提供商
  // 未设置 allowedModels 或为空数组：接受任意模型（由上游提供商判断）
  if (!provider.allowedModels || provider.allowedModels.length === 0) {
    return true;
  }

  // 不在声明列表中且无重定向配置
  return false;
}
```

### Available Models Endpoint

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/models/available-models.ts`, lines 238-244

When fetching available models for a provider, if `allowedModels` is configured, it bypasses upstream API calls:

```typescript
async function fetchModelsFromProvider(provider: Provider): Promise<FetchedModel[]> {
  if (provider.allowedModels && provider.allowedModels.length > 0) {
    logger.debug(`[AvailableModels] Using configured allowedModels for ${provider.name}`, {
      modelCount: provider.allowedModels.length,
    });
    return provider.allowedModels.map((id) => ({ id }));
  }
  // ... fetch from upstream API
}
```

### Guard Pipeline Configuration

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts`, lines 65-70, 172-203

```typescript
const Steps: Record<GuardStepKey, GuardStep> = {
  // ... other steps
  model: {
    name: "model",
    async execute(session) {
      return ProxyModelGuard.ensure(session);
    },
  },
  // ... other steps
};

// Preset configurations
export const CHAT_PIPELINE: GuardConfig = {
  // Full guard chain for normal chat requests
  steps: [
    "auth",
    "sensitive",
    "client",
    "model",        // Model guard executes here
    "version",
    "probe",
    "session",
    "warmup",
    "requestFilter",
    "rateLimit",
    "provider",
    "providerRequestFilter",
    "messageContext",
  ],
};

export const COUNT_TOKENS_PIPELINE: GuardConfig = {
  // Minimal chain for count_tokens: no session, no sensitive, no rate limit, no message logging
  steps: [
    "auth",
    "client",
    "model",        // Model guard also executes for count_tokens
    "version",
    "probe",
    "requestFilter",
    "provider",
    "providerRequestFilter",
  ],
};
```

## UI Components

### User Access Restrictions Section

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/access-restrictions-section.tsx`

This component provides the UI for configuring both `allowedClients` and `allowedModels` for users:

```typescript
export interface AccessRestrictionsSectionProps {
  allowedClients: string[];
  allowedModels: string[];
  modelSuggestions: string[];
  onChange: (field: "allowedClients" | "allowedModels", value: string[]) => void;
  // ... translations
}
```

Key features:
- Tag input for model names with validation
- Model name pattern validation: `/^[a-zA-Z0-9._:/-]+$/`
- Duplicate detection
- Maximum 50 models limit
- Suggestions support

### Provider Routing Section

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/forms/provider-form/sections/routing-section.tsx`, lines 153-236

The provider form includes a Model Whitelist configuration section with:
- Model multi-select component
- Visual display of selected models (badges)
- Count indicator for additional models
- Context-aware help text based on provider type

## Edge Cases & Behaviors

### 1. Empty vs Null Whitelist

**User-Level**:
- `[]` (empty array) = no restrictions
- `undefined` = no restrictions
- `["model-name"]` = restrictions enforced

**Provider-Level**:
- `null` = no restrictions (Anthropic: all claude models, Non-Anthropic: any model)
- `[]` = no restrictions (same as null)
- `["model-name"]` = restrictions/declarations apply

### 2. Case Sensitivity

Model matching is **case-insensitive** at the user level:
- User whitelist: `["Claude-3-Opus"]` will match request for `"claude-3-opus"`
- Provider whitelist: Exact string match (case-sensitive in most operations)

### 3. Model Name Validation

Valid model name pattern: `/^[a-zA-Z0-9._:/-]+$/`

Examples of valid names:
- `claude-3-opus-20240229`
- `gpt-4.1`
- `gemini-1.5-pro`
- `o1-mini`

### 4. Missing Model in Request

When user has whitelist configured but request doesn't specify a model:

```typescript
return ProxyResponses.buildError(
  400,
  "Model not allowed. Model specification is required when model restrictions are configured.",
  "invalid_request_error"
);
```

### 5. Model Not in Whitelist

When requested model is not in user's allowed list:

```typescript
return ProxyResponses.buildError(
  400,
  `Model not allowed. The requested model '${requestedModel}' is not in the allowed list.`,
  "invalid_request_error"
);
```

### 6. Provider Selection with Whitelist

When a user requests a model that passes the user-level whitelist but no provider can serve it:
- The request proceeds through provider selection
- If no provider supports the model, a "No provider available" error is returned
- This is a separate concern from the whitelist check

### 7. Interaction with Model Redirects

Model redirects happen AFTER the whitelist check:
1. User requests model "claude-3-opus"
2. Model guard validates against user.allowedModels
3. Provider selection finds a provider
4. Model redirector may change "claude-3-opus" to "glm-4.6" based on provider config
5. The upstream receives the redirected model name

### 8. count_tokens Endpoint Behavior

The model whitelist is also enforced for `/v1/messages/count_tokens` requests through the `COUNT_TOKENS_PIPELINE`, ensuring consistent access control across all API endpoints.

### 9. Admin Override

There is no admin override for model whitelist - administrators are subject to the same whitelist restrictions as regular users. To allow an admin unrestricted access, their `allowedModels` should be left empty.

### 10. Whitelist and Provider Group Interaction

The model whitelist works independently of provider groups:
- User's `allowedModels` restricts which models they can request
- Provider's `allowedModels` (for Anthropic) restricts which models the provider can serve
- The intersection determines actual availability

Example:
- User allowedModels: `["claude-3-opus", "claude-3-sonnet"]`
- Provider A allowedModels: `["claude-3-opus"]`
- Provider B allowedModels: `["claude-3-sonnet", "claude-3-haiku"]`
- Result: User can access "claude-3-opus" through Provider A and "claude-3-sonnet" through Provider B

## Configuration Examples

### Example 1: Restrict User to Specific Models

```json
{
  "userId": 123,
  "allowedModels": ["claude-3-opus-20240229", "claude-3-sonnet-20240229"]
}
```

This user can only request these two specific Claude model versions.

### Example 2: Provider Whitelist for Anthropic Provider

```json
{
  "providerId": 456,
  "providerType": "claude",
  "allowedModels": ["claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307"]
}
```

This Anthropic provider can only serve these three specific model versions, even if the upstream supports more.

### Example 3: Declaration List for OpenAI-Compatible Provider

```json
{
  "providerId": 789,
  "providerType": "openai-compatible",
  "allowedModels": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"]
}
```

This declares that the provider supports these models, used for provider selection and model list endpoints.

### Example 4: No Restrictions (Default)

```json
{
  "userId": 123,
  "allowedModels": []
}
```

User can request any model available through their assigned providers.

## References

### Key Files

1. **Model Guard**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-guard.ts`
2. **Guard Pipeline**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts`
3. **Provider Selector**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`
4. **Available Models**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/models/available-models.ts`
5. **Database Schema**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`
6. **User Types**: `/Users/ding/Github/claude-code-hub/src/types/user.ts`
7. **Provider Types**: `/Users/ding/Github/claude-code-hub/src/types/provider.ts`
8. **Validation Schemas**: `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`
9. **User Repository**: `/Users/ding/Github/claude-code-hub/src/repository/user.ts`
10. **Provider Repository**: `/Users/ding/Github/claude-code-hub/src/repository/provider.ts`

### UI Components

1. **Access Restrictions Section**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/access-restrictions-section.tsx`
2. **Provider Routing Section**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/forms/provider-form/sections/routing-section.tsx`
3. **User Form**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/user-form.tsx`
4. **Provider Form**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/forms/provider-form/index.tsx`

### Actions

1. **User Actions**: `/Users/ding/Github/claude-code-hub/src/actions/users.ts`
2. **Provider Actions**: `/Users/ding/Github/claude-code-hub/src/actions/providers.ts`

---

*This document is a Round 1 exploration draft for the Model Whitelist documentation. It captures the current implementation as of the exploration date and should be reviewed for accuracy before final publication.*
