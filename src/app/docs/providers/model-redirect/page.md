---
title: Model redirect
nextjs:
  metadata:
    title: Model redirect
    description: Learn how to use model redirects to transparently rewrite model names for cost optimization, third-party integration, and operational flexibility.
---

# Model redirect

Model redirect enables you to transparently rewrite model names in incoming requests before they are forwarded to upstream providers. This feature serves as a critical abstraction layer for building flexible, cost-effective, and multi-provider AI proxy infrastructure.

## Overview

When a client sends a request with a specific model name, the proxy can automatically transform that model name to a different one based on provider-specific redirect rules. The client remains completely unaware that any transformation occurred—they receive responses as if they were directly communicating with the originally requested model.

This transparency is maintained across the entire request lifecycle:

- **Request/response cycle**: Clients receive responses in the expected format
- **Error handling**: Errors are returned in the format expected by the client
- **Billing**: Original model names are preserved for accurate billing and usage tracking
- **Logging**: Both original and redirected model names are logged for audit purposes

## Use cases

### Cost optimization

One of the most common use cases for model redirects is cost optimization. You can route expensive model requests to more cost-effective alternatives without requiring any changes to client code.

For example, you might redirect requests for `claude-3-opus-20240229` to `claude-3-sonnet-20240229`:

```json
{
  "claude-3-opus-20240229": "claude-3-sonnet-20240229"
}
```

This approach allows you to implement cost-saving strategies gradually. Start by redirecting internal or non-critical workloads to cheaper models while keeping production workloads on premium models. Over time, as confidence in the cheaper models grows, you can expand the redirect rules.

### Third-party AI service integration

When integrating with third-party AI providers, especially those in different regions or with different API conventions, model redirects become essential. For example, a Chinese AI provider might use model names like `glm-4` or `qwen-max`, while your internal applications expect standard Claude model names.

With model redirects, you can maintain a consistent interface for your clients while the proxy handles the translation to provider-specific naming conventions:

```json
{
  "claude-3-opus-20240229": "glm-4"
}
```

This abstraction layer allows client applications to use familiar model names while the proxy handles the translation.

### Model alias management

Organizations often want to create their own model aliases that are independent of the underlying provider. For example:

```json
{
  "company-large-model": "gpt-4-turbo"
}
```

This approach provides several benefits:

- **Provider independence**: Applications reference internal aliases, making it easy to switch underlying providers
- **Simplified client configuration**: Clients only need to know a small set of internal model names
- **Gradual migrations**: New models can be introduced by updating redirect rules rather than client code

### A/B testing and gradual rollouts

Model redirects enable sophisticated A/B testing strategies. By configuring different providers with different redirect rules, you can gradually shift traffic from one model to another:

```json
// Provider A (70% of traffic)
{
  "claude-3-sonnet": "claude-3-sonnet-20240229"
}

// Provider B (30% of traffic)
{
  "claude-3-sonnet": "claude-3-sonnet-20241022"
}
```

This allows for real-world testing of new model versions with a controlled portion of traffic before full rollout.

### Fallback and degradation strategies

In high-availability scenarios, redirects can implement graceful degradation:

```json
// Primary: Claude 3 Opus
{
  "critical-analysis": "claude-3-opus-20240229"
}

// Fallback during outages: Claude 3 Sonnet
{
  "critical-analysis": "claude-3-sonnet-20240229"
}
```

By updating redirect rules dynamically, you can respond to outages or performance issues without client intervention.

## How it works

### Request flow

The model redirect process follows a well-defined sequence:

1. **Client sends request**: A client sends a request with a specific model name
2. **Provider selection**: The proxy selects an upstream provider based on health, weight, and other factors
3. **Redirect check**: The system checks if the selected provider has redirect rules for the requested model
4. **Model transformation**: If a redirect is found, the model name is rewritten in the request
5. **Request forwarding**: The modified request is sent to the upstream provider
6. **Response return**: The client receives the response, unaware that a redirect occurred

### Original model preservation

The system always preserves the original model name requested by the client. This preservation enables several important features:

1. **Billing calculations**: Users are charged based on what they requested, not what was actually used. This ensures pricing transparency and prevents unexpected charges when redirects are applied.

2. **Audit logging**: Request logs show both the original and redirected models, providing a complete audit trail.

3. **Provider chain recording**: Each redirect is recorded in the provider chain for debugging purposes.

### Provider-specific redirects

Redirects are configured per-provider, not globally. This design provides maximum flexibility, allowing different providers to handle the same model name differently based on their capabilities and pricing.

For example:

```json
// Provider A configuration
{
  "claude-3-opus": "gpt-4-turbo",
  "claude-3-sonnet": "gpt-3.5-turbo"
}

// Provider B configuration
{
  "claude-3-opus": "glm-4",
  "claude-3-sonnet": "glm-3.5"
}
```

### Reset on provider switch

When a request fails and needs to be retried with a different provider, the model is reset to its original value. This ensures that each provider's redirect rules are applied to the original model name, not a previously redirected one.

Without this reset, Provider B might receive a model name that was already redirected by Provider A, leading to incorrect behavior.

## Provider type handling

The system handles model redirects differently based on the provider type. This provider-specific handling is necessary because different AI providers use different mechanisms to specify the target model.

### Claude and OpenAI compatible providers

For Claude (`claude`, `claude-auth`) and OpenAI-compatible (`openai-compatible`, `codex`) providers, the model name is passed in the request body as a JSON field:

```json
{
  "model": "claude-3-opus-20240229",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "max_tokens": 1024
}
```

The redirector modifies the model field in the parsed message object and regenerates the request buffer with the new model name.

### Gemini providers

Gemini APIs (`gemini`, `gemini-cli`) use a different approach—the model name is embedded in the URL path rather than the request body:

```
POST /v1beta/models/gemini-2.5-flash:generateContent
```

This design choice by Google means the redirector must modify the URL path instead of the request body. The implementation uses regex pattern matching to replace the model name in the path while preserving the action (such as `:generateContent` or `:streamGenerateContent`).

When resetting to the original model during provider failover, the Gemini URL path is also restored to ensure correct behavior.

## Configuration

### Provider configuration

Model redirects are stored in the `modelRedirects` field of the Provider entity. This field is a simple key-value mapping where:

- **Key**: The model name requested by the client (source model)
- **Value**: The model name to send to the upstream provider (target model)

```typescript
interface Provider {
  id: number;
  name: string;
  url: string;
  key: string;
  providerType: ProviderType;
  modelRedirects: Record<string, string> | null;
  // ... other fields
}
```

### Database schema

In the database, `modelRedirects` is stored as a JSONB column:

```sql
model_redirects JSONB
```

### Validation

When creating or updating providers, the model redirects are validated to ensure that:

- Keys are non-empty strings (source model names)
- Values are non-empty strings (target model names)
- The entire record can be null (no redirects configured)

### UI configuration

You can configure model redirects through the provider settings UI. The model redirect editor provides:

1. **Visual rule management**: Display existing redirects as source-to-target pairs
2. **Add new rules**: Input fields for source and target model names
3. **Edit existing rules**: Inline editing of target models
4. **Delete rules**: Remove unwanted redirects
5. **Validation**: Prevent empty inputs and duplicate source models

The UI enforces that:

- Source model names cannot be empty
- Target model names cannot be empty
- Duplicate source models are not allowed

### API configuration

When creating or updating providers via the API, model redirects are passed as JSON:

```json
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

## Edge cases

### No redirect configured

If a provider has no `modelRedirects` configuration (null or empty object), the `ModelRedirector.apply()` method returns `false` immediately without modifying the request. The original model name is sent to the provider.

### Model not in redirect map

If the requested model does not have a redirect rule in the provider's configuration, the redirector either resets to the original model (if a previous redirect occurred during provider failover) or returns `false` without modification.

### Provider failover with redirects

When a request is redirected to a model and sent to Provider 1, and Provider 1 fails, the request needs to be retried with Provider 2:

1. The model is reset to its original value
2. Provider 2's redirect rules are applied to the original model
3. This ensures each provider's redirects are evaluated against the original request

The forwarder has a maximum provider switch limit of 20 to prevent infinite loops.

### Billing model source

The system supports a `billingModelSource` configuration with two options:

- `"original"`: Bill using the original model's pricing (default)
- `"redirected"`: Bill using the redirected model's pricing

This allows you to decide whether users should be charged based on what they requested or what was actually used.

### Model redirects with allowedModels

A provider can have both `allowedModels` and `modelRedirects` configured. A model is considered supported if it is either in the allowed list or has a redirect rule. This allows providers to declare support for models they redirect to.

### Model redirects with joinClaudePool

When a non-Anthropic provider has `joinClaudePool` enabled and redirects a Claude model to another model, the system checks if the redirected model is also a Claude model. Only providers redirecting to actual Claude models are considered for Claude model requests when in the Claude pool.

## Integration points

### Provider selection

Model redirects influence provider selection. A provider is considered capable of handling a model if:

1. It is an Anthropic provider and the model is Claude (with optional allowedModels whitelist)
2. It is a non-Anthropic provider with `joinClaudePool` that redirects the Claude model to another Claude model
3. The model is explicitly declared in `allowedModels` or has a redirect rule

### Billing

The billing system uses the original model name by default, but can be configured to use the redirected model name. This is controlled by the `billingModelSource` system setting (default: `"original"`).

### Request logging

Every redirect is logged with detailed information:

- Original model name
- Redirected model name
- Provider ID and name
- Provider type
- Timestamp

These logs are available in the request details for debugging and auditing purposes.

### Session management

The session tracks whether a redirect has occurred. This flag is used during provider failover to determine if the model needs to be reset to its original value before applying a new provider's redirect rules.

## API reference

### ModelRedirector class

The `ModelRedirector` class provides a clean, static-method-based API for working with model redirects.

#### `apply(session: ProxySession, provider: Provider): boolean`

The main entry point for applying model redirects. This method:

1. Retrieves the original model from the session
2. Checks if the provider has redirect rules
3. Applies the redirect if found
4. Returns `true` if a redirect was applied, `false` otherwise

#### `getRedirectedModel(originalModel: string, provider: Provider): string`

A utility method that returns the redirected model name without modifying the session. This is useful for previewing what model would be used.

```typescript
const redirectedModel = ModelRedirector.getRedirectedModel(
  "claude-3-opus-20240229",
  provider
);
```

#### `hasRedirect(model: string, provider: Provider): boolean`

Checks if a provider has a redirect configured for a specific model.

```typescript
const hasRedirect = ModelRedirector.hasRedirect(
  "claude-3-opus-20240229",
  provider
);
```

## Best practices

### Start conservative

Begin with a small set of redirects and expand gradually. Monitor the impact on cost and quality before rolling out redirects more broadly.

### Monitor logs

Regularly review logs to ensure redirects are working as expected. Look for unexpected redirect patterns or errors.

### Test failover

Verify that provider failover works correctly with your redirect configuration. Ensure that when one provider fails, the request is properly reset and redirected according to the next provider's rules.

### Document redirects

Maintain documentation of why each redirect exists. This helps future administrators understand the reasoning behind redirect rules.

### Use consistent naming

Establish conventions for model names to avoid confusion. Consistent naming makes it easier to manage redirects across multiple providers.

### Review regularly

Periodically review redirect rules to ensure they are still needed. Remove redirects that are no longer relevant to keep the configuration clean.

## Performance considerations

Model redirects are designed to have minimal performance impact:

1. **O(1) lookup**: Redirect lookups use JavaScript object property access
2. **No database queries**: Redirects are loaded as part of the provider configuration
3. **Lazy evaluation**: Redirects are only evaluated when a provider is selected
4. **Minimal memory overhead**: The redirect map is stored as a simple object

## Security considerations

While model redirects are primarily an operational feature, there are security aspects to consider:

1. **Input validation**: The UI and API validate that model names are non-empty strings
2. **No code execution**: Redirect values are treated as opaque strings, not evaluated as code
3. **Audit trail**: All redirects are logged with provider information for security auditing
4. **Access control**: Redirect configuration is only available to administrators

## Summary

The model redirect functionality provides a powerful and flexible mechanism for transparently rewriting model names in AI proxy requests. It serves as a critical abstraction layer that enables cost optimization, third-party integration, and operational flexibility.

Key characteristics of the model redirect system:

1. **Transparency**: Clients are completely unaware that redirects are occurring
2. **Provider-specific**: Each provider maintains its own redirect configuration
3. **Billing integrity**: Original model names are preserved for accurate billing
4. **Failover safety**: The system intelligently resets models during provider failover
5. **Format awareness**: Special handling for different provider types ensures correct behavior
6. **Audit trail**: Complete redirect history is recorded for debugging and compliance

Model redirects enable several architectural patterns: cost optimization without client changes, provider abstraction with internal model names, gradual migration of traffic between models, and high availability through fallback strategies.
