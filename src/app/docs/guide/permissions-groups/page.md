---
dimensions:
  type:
    primary: getting-started
    detail: dashboard
  level: intermediate
standard_title: 用户权限与分组
language: zh
---

# 用户权限与分组

本文档详细介绍 Claude Code Hub 的用户权限系统和分组机制，包括用户角色权限、供应商分组、Key 分组、用户分组的完整逻辑说明。

## 概述

Claude Code Hub 采用三层分组架构来管理用户对供应商的访问权限：

```
Key.providerGroup > User.providerGroup > 全局（无限制）
```

- **Key 分组**：优先级最高，用于覆盖用户级配置
- **User 分组**：用户级别的默认配置，由管理员设置或自动同步
- **全局**：未设置分组时可访问所有供应商

这种设计允许灵活控制不同用户和密钥对供应商的访问权限，同时保持了严格的安全隔离。

## 用户角色与权限

### 角色类型

系统支持两种用户角色：

| 角色 | 说明 |
| --- | --- |
| `admin` | 管理员，拥有完整的系统管理权限 |
| `user` | 普通用户，仅能管理自己的资源 |

{% callout type="note" %}
用户角色目前无法通过 Web UI 修改，需要直接在数据库中更新。初始管理员账户在系统部署时自动创建。
{% /callout %}

### 管理员可执行的操作

管理员拥有完整的系统管理权限，包括：

**用户管理**
- 添加、编辑、删除用户
- 续期用户有效期
- 启用/禁用用户

**字段编辑**
- 可修改所有用户的所有字段
- 包括敏感配置字段（限额、分组、状态等）

**Key 管理**
- 查看和管理所有用户的 API Key
- 修改任意 Key 的供应商分组
- 配置 Key 级别的限额和权限

**系统设置**
- 配置供应商和分组标签
- 设置全局限额规则
- 管理敏感词、过滤器、错误规则等

### 普通用户可执行的操作

普通用户的权限受到严格限制：

**可执行的操作**
- 查看自己的 API Key 列表
- 创建新的 API Key
- 修改自己的基本信息（用户名、备注）
- 删除自己的 API Key（至少保留一个）

**不可执行的操作**
- 查看其他用户的信息
- 修改任何敏感配置字段
- 修改已创建 Key 的供应商分组

### 仅管理员可修改的字段

以下字段属于敏感配置，仅管理员有权修改：

| 字段 | 说明 |
| --- | --- |
| `rpm` | 每分钟请求数限制 |
| `dailyQuota` | 每日消费额度（美元） |
| `providerGroup` | 供应商分组限制 |
| `limit5hUsd` | 5 小时消费限额 |
| `limitWeeklyUsd` | 每周消费限额 |
| `limitMonthlyUsd` | 每月消费限额 |
| `limitTotalUsd` | 总消费上限 |
| `limitConcurrentSessions` | 并发会话限制 |
| `dailyResetMode` | 每日重置模式 |
| `dailyResetTime` | 每日重置时间 |
| `isEnabled` | 启用/禁用状态 |
| `expiresAt` | 过期时间 |
| `allowedClients` | 允许的客户端列表 |
| `allowedModels` | 允许的模型列表 |

{% callout type="warning" %}
普通用户尝试修改这些字段时，系统会返回 `权限拒绝` 错误。即使通过 API 直接调用也会被拒绝。
{% /callout %}

## 供应商分组系统

供应商分组通过 `groupTag` 字段实现，用于控制哪些用户可以访问哪些供应商。

### groupTag 字段

供应商的 `groupTag` 字段支持配置多个分组标签：

- **格式**：逗号分隔的字符串
- **示例**：`cli,chat` 表示该供应商同时属于 `cli` 和 `chat` 两个分组
- **限制**：最大 50 字符

在「供应商管理」页面中，可以为每个供应商设置分组标签。

### 分组匹配算法

系统采用**交集匹配**策略进行供应商分组验证：

| 用户/Key 分组 | 供应商标签 | 匹配结果 |
| --- | --- | --- |
| `cli` | `cli,chat` | 匹配 |
| `chat` | `cli,chat` | 匹配 |
| `premium` | `cli,chat` | 不匹配 |
| `cli,premium` | `cli,chat` | 匹配（cli 交集） |
| `api,web` | `cli,chat` | 不匹配 |

**匹配规则**：只要用户/Key 的分组与供应商的标签存在**任意交集**，即视为匹配成功。

{% callout type="warning" title="大小写敏感" %}
分组匹配是**大小写敏感**的精确字符串匹配。例如 `CLI` 不会匹配 `cli`，配置时请确保大小写一致。
{% /callout %}

### 严格分组隔离

当用户或 Key 配置了分组限制后，系统会执行严格的隔离策略：

**有分组标签的供应商**
- 只有分组标签与用户/Key 分组存在交集时才能访问

**无分组标签的供应商**
- 会被**拒绝访问**，确保分组隔离的完整性
- 这是一个重要的安全特性：有分组限制的用户不会意外使用到"公共"供应商

{% callout type="warning" %}
配置供应商分组后，未设置分组标签的供应商将无法被该用户访问。请确保目标供应商已正确配置分组标签。
{% /callout %}

{% callout type="warning" title="无可用供应商错误" %}
如果用户配置了分组限制，但过滤后没有任何匹配的供应商可用，系统会返回错误 `User group has no providers`，请求将失败。请确保分组内至少有一个启用的供应商。
{% /callout %}

## Key 分组系统

Key 的 `providerGroup` 字段用于覆盖用户级别的分组配置，提供更细粒度的控制。

### providerGroup 字段

Key 的 `providerGroup` 字段有两种状态：

| 值 | 含义 |
| --- | --- |
| `null`（空） | 继承用户的 `providerGroup` 配置 |
| 非空字符串 | 覆盖用户配置，使用 Key 自己的分组 |

### 分组优先级规则

系统按以下优先级确定有效的供应商分组：

```
effectiveGroup = key.providerGroup || user.providerGroup
```

1. **Key 的 providerGroup**：优先级最高，如果 Key 配置了分组则使用 Key 的分组
2. **User 的 providerGroup**：如果 Key 未设置分组，则使用用户级别的分组配置
3. **全局**：如果两者都未设置，用户可以访问所有供应商

### 普通用户创建 Key 的分组限制

普通用户在创建 Key 时，分组配置受到以下限制：

**必须是用户分组的子集**
- 普通用户只能为 Key 配置自己拥有的分组
- 例如：用户分组为 `cli,chat`，则 Key 只能配置 `cli`、`chat` 或 `cli,chat`
- 不能配置用户没有的分组（如 `premium`）

**不指定时自动继承**
- 如果创建 Key 时未指定 `providerGroup`，Key 会继承用户的全部分组

{% callout type="note" %}
管理员创建 Key 时不受此限制，可以自由配置任意分组。
{% /callout %}

### Key 分组修改权限

| 角色 | 创建时设置分组 | 修改已有 Key 的分组 |
| --- | --- | --- |
| 管理员 | 可自由配置任意分组 | 可自由修改 |
| 普通用户 | 仅限用户分组的子集 | **不可修改** |

{% callout type="warning" %}
普通用户创建 Key 后，**无法再修改**该 Key 的 `providerGroup`。如需更改，请联系管理员。
{% /callout %}

## 用户分组系统

用户的 `providerGroup` 字段定义了用户可以访问的供应商范围。

### providerGroup 字段

用户的 `providerGroup` 可以通过两种方式设置：

**管理员手动配置**
- 管理员可以在用户创建/编辑表单中直接设置分组
- 可以配置多个分组，用逗号分隔

**自动同步机制**
- 用户分组会根据其所有 Key 的分组自动同步
- 同步规则：用户分组 = 所有 Key 分组的**并集**

### 自动同步机制

当用户的 Key 发生变化时，系统会自动重新计算用户的 `providerGroup`：

**触发时机**
- Key 新增时
- Key 编辑时（修改了 `providerGroup`）
- Key 删除时

**同步规则**
```
用户分组 = 所有 Key 分组的并集（去重排序）
```

**同步示例**

假设用户有以下 Key：

| Key | providerGroup |
| --- | --- |
| Key A | `cli,chat` |
| Key B | `api` |
| Key C | `null`（空） |

同步后，用户的 `providerGroup` 将变为：`api,chat,cli`（按字母排序的并集）

{% callout type="note" %}
Key C 的 `providerGroup` 为空，不参与并集计算。
{% /callout %}

### 分组继承链

完整的分组继承链如下：

```
请求认证
    ↓
提取 Key.providerGroup 和 User.providerGroup
    ↓
计算 effectiveGroup = Key.providerGroup || User.providerGroup
    ↓
[effectiveGroup 存在]
    ↓
分组预过滤：只保留与 effectiveGroup 有交集的供应商
    ↓
[effectiveGroup 不存在]
    ↓
全局访问：可使用所有启用的供应商
```

## 独立余额查询页面

独立余额查询页面（My Usage）是为普通用户提供的简化界面，只显示用量和配额信息。

### canLoginWebUi 字段

Key 的 `canLoginWebUi` 字段控制用户登录后的访问界面：

| canLoginWebUi 值 | 登录后访问的界面 |
| --- | --- |
| `true` | 完整 Dashboard（默认） |
| `false` | 独立余额查询页面（/my-usage） |

{% callout type="warning" title="反向逻辑" %}
在 Key 编辑表单中，开关显示为「独立个人用量页面」：
- **开关开启** = `canLoginWebUi=false` = 使用独立余额页面
- **开关关闭** = `canLoginWebUi=true` = 使用完整 Dashboard

这是反向逻辑设计，请注意区分。
{% /callout %}

### 路由控制逻辑

系统根据用户角色和 `canLoginWebUi` 值决定登录后的跳转目标：

| 角色 | canLoginWebUi | 登录后跳转 |
| --- | --- | --- |
| 管理员 | 任意 | /dashboard |
| 普通用户 | `true` | /dashboard |
| 普通用户 | `false` | /my-usage |

**自动重定向规则**
- 管理员访问 /my-usage 会被重定向到 /dashboard
- 普通用户（`canLoginWebUi=false`）访问 /dashboard 会被重定向到 /my-usage

### 独立页面的功能范围

**可查看的内容**
- 当前配额使用情况
- 各维度限额的使用进度（5小时、日、周、月、总计）
- 使用日志摘要
- 账户过期时间
- 当前分组信息

**不可执行的操作**
- 修改 Key 的供应商分组
- 访问用户管理功能
- 查看其他用户信息
- 访问系统设置

### 适用场景

**适合使用独立余额页面的场景**
- 仅需查看自己使用情况的普通用户
- 不需要管理密钥分组的用户
- 需要提供简洁只读界面的场景

**适合使用完整 Dashboard 的场景**
- 需要管理自己 Key 的用户
- 需要查看详细日志和统计的用户
- 需要修改 Key 配置的用户

### 默认值说明

不同创建方式的默认值不同：

| 创建方式 | canLoginWebUi 默认值 | 开关状态 |
| --- | --- | --- |
| 通过「添加 Key」按钮新增 | 取决于表单输入（默认 `true`） | 默认关闭 |
| 创建用户时自动生成的默认 Key | `true` | 关闭 |

{% callout type="note" %}
两种创建方式的默认行为相同，都是 `canLoginWebUi=true`（开关关闭），即默认使用完整 Dashboard。如需使用独立余额页面，需要手动开启开关。
{% /callout %}

## 权限矩阵汇总

### 操作权限矩阵

| 操作 | 管理员 | 普通用户（Web UI） | 普通用户（余额页） |
| --- | --- | --- | --- |
| 查看用户列表 | 可以 | 不可以 | 不可以 |
| 创建用户 | 可以 | 不可以 | 不可以 |
| 编辑任意用户 | 可以 | 不可以 | 不可以 |
| 删除用户 | 可以 | 不可以 | 不可以 |
| 查看自己的 Key | 可以 | 可以 | 可以 |
| 创建自己的 Key | 可以 | 可以 | 不可以 |
| 编辑自己 Key 的名称 | 可以 | 可以 | 不可以 |
| 编辑自己 Key 的分组 | 可以 | 不可以 | 不可以 |
| 删除自己的 Key | 可以 | 可以（保留至少1个） | 不可以 |
| 查看他人的 Key | 可以 | 不可以 | 不可以 |
| 修改敏感配置字段 | 可以 | 不可以 | 不可以 |
| 访问系统设置 | 可以 | 不可以 | 不可以 |

### 分组配置权限矩阵

| 操作 | 管理员 | 普通用户 |
| --- | --- | --- |
| 设置用户的 providerGroup | 可以（任意值） | 不可以 |
| 创建 Key 时指定分组 | 可以（任意值） | 可以（限用户分组子集） |
| 修改已有 Key 的分组 | 可以 | 不可以 |
| 设置供应商的 groupTag | 可以 | 不可以 |

## 相关功能

- [用户管理](/docs/guide/users) - 用户和 API Key 的基本管理操作
- [供应商管理](/docs/guide/settings-providers) - 配置供应商和分组标签
- [限额管理](/docs/guide/quota-management) - 配置各维度的消费限额
- [用户配额](/docs/guide/quotas-users) - 查看用户配额使用情况
