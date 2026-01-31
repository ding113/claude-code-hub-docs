---
title: 端点管理
nextjs:
  metadata:
    title: 端点管理
    description: 了解如何管理 Claude Code Hub 中的上游 API 端点，包括健康检查、熔断器和负载均衡
---

# 端点管理

端点是 Claude Code Hub 用于路由请求的上游 API URL。与包含 API 密钥和配置的供应商不同，端点是可以被多个供应商配置共享的 URL 资源。端点管理系统让你能够集中管理 API 端点、监控其健康状况，并在多个端点之间智能分配负载。

{% callout type="note" title="端点 vs 供应商" %}
- **端点** - 上游 API 的 URL（如 `https://api.anthropic.com/v1`）
- **供应商** - 包含 API 密钥和配置的账户，引用特定的端点

当你拥有同一供应商的多个 API 密钥时，只需定义一次端点 URL，然后在多个供应商配置中引用它。
{% /callout %}

## 核心概念

### 端点层次结构

端点系统采用三层结构：

{% table %}
* 层级
* 数据表
* 描述
---
* 供应商 (Vendor)
* `provider_vendors`
* 按网站域名聚合（如 "anthropic.com"）
---
* 端点 (Endpoint)
* `provider_endpoints`
* 供应商下的特定 URL，按类型分类
---
* 供应商配置 (Provider)
* `providers`
* 引用供应商的 API 密钥配置
{% /table %}

### 供应商类型

端点按供应商类型分类，支持以下类型：

| 类型 | 描述 |
|------|------|
| `claude` | 标准 Anthropic API |
| `claude-auth` | Claude 认证服务 |
| `codex` | OpenAI Codex/Responses API |
| `gemini` | Google Gemini API |
| `gemini-cli` | Gemini CLI 格式 |
| `openai-compatible` | 通用 OpenAI 兼容端点 |

### 关键行为

- **软删除** - 端点使用 `deleted_at` 时间戳进行软删除，保留审计追踪
- **唯一约束** - 每个供应商+类型+URL 组合必须唯一
- **自动供应商创建** - 创建供应商时，会根据 URL 域名自动创建供应商
- **级联删除** - 删除供应商会级联删除其端点

## 端点选择流程

当路由请求时，系统按以下步骤选择端点：

1. 识别目标供应商和供应商类型
2. 查询该供应商+类型的所有启用且未删除的端点
3. 过滤掉熔断器打开的端点
4. 按以下条件对剩余端点排序：
   - 探测健康状态（健康 > 未知 > 不健康）
   - 排序值（数值越小优先级越高）
   - 延迟（优先选择响应更快的端点）
   - ID（稳定的决胜条件）
5. 选择最佳端点处理请求

## 管理端点

### 创建端点

使用 `addProviderEndpoint` Server Action 创建新端点：

```typescript
import { addProviderEndpoint } from "@/actions/provider-endpoints";

const result = await addProviderEndpoint({
  vendorId: 1,
  providerType: "claude",
  url: "https://api.anthropic.com/v1",
  label: "Anthropic 主端点",
  sortOrder: 0,
  isEnabled: true,
});

if (result.success) {
  console.log("端点创建成功:", result.data.endpoint);
}
```

**参数说明：**

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `vendorId` | number | 是 | 供应商 ID |
| `providerType` | string | 是 | 供应商类型 |
| `url` | string | 是 | 端点 URL（必须是有效 URL） |
| `label` | string | 否 | 显示标签（最多 200 字符） |
| `sortOrder` | number | 否 | 排序优先级（默认 0，越小越优先） |
| `isEnabled` | boolean | 否 | 是否启用（默认 true） |

{% callout type="warning" %}
创建端点需要管理员权限。URL 必须是有效的 HTTP/HTTPS 地址，且同一供应商+类型+URL 组合不能重复。
{% /callout %}

### 列出端点

按供应商和类型查询端点：

```typescript
import { getProviderEndpoints } from "@/actions/provider-endpoints";

const endpoints = await getProviderEndpoints({
  vendorId: 1,
  providerType: "claude",
});

// 结果按 sortOrder ASC, id ASC 排序
console.log(endpoints);
```

或者只按供应商查询所有端点：

```typescript
import { getProviderEndpointsByVendor } from "@/actions/provider-endpoints";

const allEndpoints = await getProviderEndpointsByVendor({ vendorId: 1 });
```

### 更新端点

修改现有端点的配置：

```typescript
import { editProviderEndpoint } from "@/actions/provider-endpoints";

const result = await editProviderEndpoint({
  endpointId: 1,
  url: "https://api.anthropic.com/v1",
  label: "更新后的标签",
  sortOrder: 1,
  isEnabled: true,
});
```

{% callout type="note" %}
更新操作要求至少提供一个字段。如果端点不存在或已被软删除，将返回 null。
{% /callout %}

### 删除端点

端点使用软删除，保留历史记录：

```typescript
import { removeProviderEndpoint } from "@/actions/provider-endpoints";

const result = await removeProviderEndpoint({ endpointId: 1 });

if (result.success) {
  console.log("端点已删除");
}
```

删除端点时，系统会：
- 设置 `deleted_at` 时间戳
- 将 `is_enabled` 设为 false
- 尝试清理没有活跃供应商或端点的供应商

## 健康检查与探测

### 探测机制

系统会自动探测端点健康状况：

1. 首先尝试对端点 URL 发送 `HEAD` 请求
2. 如果 HEAD 失败且没有状态码（网络错误），则回退到 `GET` 请求
3. 如果状态码小于 500，则认为探测成功

默认超时时间为 5 秒，可通过 `ENDPOINT_PROBE_TIMEOUT_MS` 环境变量配置。

### 探测来源

探测可以由以下方式触发：

| 来源 | 描述 |
|------|------|
| `scheduled` | 定时自动健康检查 |
| `manual` | 用户从 UI 手动触发 |
| `runtime` | 请求路由期间触发 |

### 手动触发探测

```typescript
import { probeProviderEndpointAndRecord } from "@/lib/provider-endpoints/probe";

const result = await probeProviderEndpointAndRecord({
  endpointId: 1,
  source: "manual",
  timeoutMs: 5000,
});

console.log("探测结果:", {
  healthy: result?.ok,
  statusCode: result?.statusCode,
  latency: result?.latencyMs,
});
```

### 查看探测日志

查询端点的探测历史：

```typescript
import { findProviderEndpointProbeLogs } from "@/repository/provider-endpoints";

const logs = await findProviderEndpointProbeLogs({
  endpointId: 1,
  limit: 100,
  offset: 0,
});

// 日志按 createdAt DESC 排序
logs.forEach(log => {
  console.log(`${log.createdAt}: ${log.ok ? "健康" : "异常"} - ${log.latencyMs}ms`);
});
```

## 熔断器

### 端点级熔断器

每个端点都有独立的熔断器保护，防止向不健康的端点发送重复请求。

**配置：**

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `failureThreshold` | 3 | 连续失败次数达到此值后熔断 |
| `openDuration` | 300000ms (5分钟) | 熔断持续时间 |
| `halfOpenSuccessThreshold` | 1 | 半开状态下需要成功次数才能关闭 |

**状态转换：**

```
Closed（关闭）→ Open（打开）：failureCount >= failureThreshold
Open（打开）→ Half-Open（半开）：currentTime > circuitOpenUntil
Half-Open（半开）→ Closed（关闭）：halfOpenSuccessCount >= threshold
```

**使用熔断器 API：**

```typescript
import {
  isEndpointCircuitOpen,
  recordEndpointFailure,
  recordEndpointSuccess,
  resetEndpointCircuit,
} from "@/lib/endpoint-circuit-breaker";

// 检查熔断器状态
const isOpen = await isEndpointCircuitOpen(1);

// 记录失败（可能触发熔断）
await recordEndpointFailure(1, new Error("Timeout"));

// 记录成功（可能关闭熔断器）
await recordEndpointSuccess(1);

// 手动重置熔断器
await resetEndpointCircuit(1);
```

熔断器状态存储在 Redis 中，带有 24 小时 TTL，确保应用重启后状态不丢失。

### 供应商-类型级熔断器

当某个供应商+类型的所有端点都超时时，系统会自动熔断整个供应商+类型组合，防止浪费请求。

```typescript
import {
  isVendorTypeCircuitOpen,
  setVendorTypeCircuitManualOpen,
  resetVendorTypeCircuit,
} from "@/lib/vendor-type-circuit-breaker";

// 检查供应商+类型是否被熔断
const isOpen = await isVendorTypeCircuitOpen(1, "claude");

// 手动打开/关闭熔断器
await setVendorTypeCircuitManualOpen(1, "claude", true);

// 重置熔断器
await resetVendorTypeCircuit(1, "claude");
```

## 端点优先级与选择

### 排序算法

端点按以下优先级排序（数字越小优先级越高）：

1. **健康状态** (0-2)
   - `0`: `lastProbeOk === true`（健康）
   - `1`: `lastProbeOk === null`（从未探测）
   - `2`: `lastProbeOk === false`（不健康）

2. **排序值** - `sortOrder` 升序

3. **延迟** - `lastProbeLatencyMs` 升序（null 视为无限大）

4. **ID** - 升序（稳定决胜条件）

### 选择最佳端点

```typescript
import {
  getPreferredProviderEndpoints,
  pickBestProviderEndpoint,
} from "@/lib/provider-endpoints/endpoint-selector";

// 获取排序后的端点列表
const endpoints = await getPreferredProviderEndpoints({
  vendorId: 1,
  providerType: "claude",
  excludeEndpointIds: [], // 可选：排除特定端点（用于重试场景）
});

// 直接获取最佳端点
const bestEndpoint = await pickBestProviderEndpoint({
  vendorId: 1,
  providerType: "claude",
});

if (bestEndpoint) {
  console.log(`使用端点: ${bestEndpoint.url}`);
}
```

## 供应商管理

### 自动供应商创建

当你创建供应商配置时，系统会自动根据 URL 域名创建供应商：

```typescript
import { getOrCreateProviderVendorIdFromUrls } from "@/repository/provider-endpoints";

const vendorId = await getOrCreateProviderVendorIdFromUrls({
  providerUrl: "https://api.anthropic.com/v1",
  websiteUrl: "https://anthropic.com",
});
```

### 管理供应商

```typescript
import {
  findProviderVendors,
  findProviderVendorById,
  updateProviderVendor,
  deleteProviderVendor,
} from "@/repository/provider-endpoints";

// 列出所有供应商
const vendors = await findProviderVendors(100, 0);

// 获取单个供应商
const vendor = await findProviderVendorById(1);

// 更新供应商信息
const updated = await updateProviderVendor(1, {
  displayName: "Anthropic",
  websiteUrl: "https://anthropic.com",
  faviconUrl: "https://anthropic.com/favicon.ico",
});

// 删除供应商（会级联删除其端点）
const deleted = await deleteProviderVendor(1);
```

## 数据库架构

### provider_endpoints 表

```typescript
{
  id: number;                    // 主键
  vendorId: number;              // 外键 → provider_vendors.id
  providerType: string;          // 供应商类型
  url: string;                   // 端点 URL
  label: string | null;          // 显示标签
  sortOrder: number;             // 排序优先级
  isEnabled: boolean;            // 是否启用
  lastProbedAt: Date | null;     // 最后探测时间
  lastProbeOk: boolean | null;   // 最后探测结果
  lastProbeStatusCode: number | null;  // HTTP 状态码
  lastProbeLatencyMs: number | null;   // 响应延迟
  lastProbeErrorType: string | null;   // 错误类型
  lastProbeErrorMessage: string | null; // 错误信息
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;        // 软删除标记
}
```

### provider_endpoint_probe_logs 表

```typescript
{
  id: number;
  endpointId: number;            // 外键 → provider_endpoints.id
  source: string;                // 探测来源: scheduled | manual | runtime
  ok: boolean;                   // 是否成功
  statusCode: number | null;     // HTTP 状态码
  latencyMs: number | null;      // 响应延迟
  errorType: string | null;      // 错误类型
  errorMessage: string | null;   // 错误信息
  createdAt: Date;
}
```

## 界面操作

### 端点管理页面

在设置页面的供应商管理中，你可以：

- 查看按供应商分组的端点列表
- 启用/禁用端点
- 查看延迟趋势图
- 手动触发探测
- 编辑或删除端点

### 可用性仪表盘

仪表盘提供端点健康度的实时监控：

- **探测网格** - 以卡片形式显示所有端点的状态
- **延迟曲线** - 显示历史延迟趋势
- **终端日志** - 实时查看探测日志
- **自动刷新** - 每 10 秒自动更新

## 最佳实践

### 端点配置

1. **使用描述性标签** - 为端点添加清晰的标签，如 "主节点-美国东部"、"备用节点-亚太地区"

2. **合理设置排序值** - 将主要端点设为 0，备用端点设为 1、2、3...

3. **监控探测结果** - 定期检查探测日志，识别潜在问题

### 高可用配置

为关键供应商配置多个端点：

```
供应商: anthropic.com
├── 端点 1: https://api.anthropic.com/v1 (sortOrder: 0)
├── 端点 2: https://api-alt.anthropic.com/v1 (sortOrder: 1)
└── 端点 3: https://backup.anthropic.com/v1 (sortOrder: 2)
```

### 故障排查

当端点出现问题时：

1. 检查探测日志，查看具体错误信息
2. 验证端点 URL 是否可访问
3. 检查熔断器状态，必要时手动重置
4. 查看供应商-类型级熔断器是否被触发

## 参考

- [供应商配置](/docs/providers/configuration) - 了解如何配置 API 密钥和供应商
- [熔断器模式](/docs/circuit-breaker) - 深入了解熔断器的工作原理
- [智能路由](/docs/intelligent-routing) - 了解请求路由机制
