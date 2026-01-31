# 客户端版本检查 (Client Version Check) - Round 1 Exploration Draft

## 1. 概述 (Overview)

### 1.1 功能定位

客户端版本检查是 claude-code-hub 的一个重要系统功能，用于确保连接到系统的客户端（如 Claude CLI、VSCode 插件等）使用最新的稳定版本。该功能通过分析用户的 User-Agent 头部信息，识别客户端类型和版本，并根据系统配置的 GA（Generally Available）版本策略，决定是否拦截旧版本客户端的请求。

在现代的 AI 代理服务架构中，客户端版本管理是一个关键但常被忽视的环节。随着 Claude Code、Codex CLI 等工具的快速迭代，用户可能同时使用多个不同版本的客户端，这会导致兼容性问题、功能不一致以及潜在的安全风险。claude-code-hub 的客户端版本检查功能正是为了解决这些问题而设计的。

### 1.2 核心目标

- **版本兼容性管理**：确保用户使用经过验证的稳定客户端版本，减少因版本差异导致的问题
- **自动版本检测**：基于活跃用户数据自动识别最新的 GA 版本，无需手动维护版本列表
- **平滑升级引导**：向使用旧版本的用户提供明确的升级提示，而不是简单地拒绝服务
- **多客户端支持**：独立管理 VSCode 插件、纯 CLI、SDK 等不同客户端类型，每种客户端有自己的版本演进路线
- **运维可控**：管理员可以通过管理界面动态启用或禁用版本检查，根据实际运营情况灵活调整策略

### 1.3 架构位置

客户端版本检查位于代理请求处理管道的 `version` 阶段，在认证（auth）、敏感词检查（sensitive）、客户端检查（client）、模型检查（model）之后执行，在探针请求处理（probe）、会话管理（session）之前执行。

这种位置安排有其特定的考量：
- 在认证之后执行，确保只有合法用户才会进行版本检查
- 在客户端检查之后，避免对已被拒绝的客户端进行不必要的版本计算
- 在会话管理之前，避免为旧版本客户端创建不必要的会话记录
- 在限流之前，确保旧版本客户端不会消耗限流配额

---

## 2. 核心组件 (Core Components)

### 2.1 User-Agent 解析器 (UA Parser)

**文件位置**: `src/lib/ua-parser.ts`

UA 解析器是整个版本检查系统的基础组件，负责从 HTTP 请求的 User-Agent 头部提取客户端类型和版本信息。由于不同的 Claude 客户端使用不同的 UA 格式，解析器需要处理多种变体。

#### 2.1.1 ClientInfo 接口

```typescript
interface ClientInfo {
  clientType: string;  // 客户端类型标识
  version: string;     // 版本号，如 "2.0.31"
  raw: string;         // 原始 UA 字符串
}
```

支持的客户端类型包括：
- `claude-vscode`: VSCode 插件版本，通常通过 VSCode 扩展市场安装
- `claude-cli`: 纯 CLI 版本，通过命令行直接使用
- `claude-cli-unknown`: 无法识别的旧版本，用于向后兼容
- `anthropic-sdk-typescript`: TypeScript SDK，开发者直接调用 API 时使用
- 其他自定义客户端类型，通过正则表达式动态识别

#### 2.1.2 解析逻辑

`parseUserAgent` 函数使用正则表达式提取客户端类型和版本：

```typescript
const regex = /^([a-zA-Z0-9_-]+)\/([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?)/;
```

这个正则表达式的含义：
- `^`: 从字符串开头匹配
- `([a-zA-Z0-9_-]+)`: 捕获客户端名称（字母、数字、下划线、连字符）
- `\/`: 匹配斜杠分隔符
- `([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?)`: 捕获语义化版本号，支持预发布标识

对于 `claude-cli` 类型的客户端，需要进一步通过 `determineClaudeClientType` 函数区分：
- 包含 `claude-vscode` 标记 → `claude-vscode`（优先级最高）
- 包含 `cli` 标记 → `claude-cli`
- 都不包含 → `claude-cli-unknown`

这种分层检测的原因是：所有 Claude 客户端的基础 UA 都是 `claude-cli/{version}`，但通过括号内的附加标记可以区分具体的使用场景。

#### 2.1.3 支持的 UA 格式示例

| User-Agent 字符串 | 解析结果 clientType | 版本 |
|------------------|-------------------|------|
| `claude-cli/2.0.31 (external, claude-vscode, agent-sdk/0.1.30)` | `claude-vscode` | 2.0.31 |
| `claude-cli/2.0.32 (external, cli)` | `claude-cli` | 2.0.32 |
| `claude-cli/2.0.20` | `claude-cli-unknown` | 2.0.20 |
| `anthropic-sdk-typescript/1.0.0` | `anthropic-sdk-typescript` | 1.0.0 |
| `claude-cli/2.0.35 (external, claude-vscode)` | `claude-vscode` | 2.0.35 |

#### 2.1.4 显示名称映射

`getClientTypeDisplayName` 函数提供友好的显示名称，用于错误消息和管理界面：
- `claude-vscode` → "Claude VSCode Extension"
- `claude-cli` → "Claude CLI"
- `claude-cli-unknown` → "Claude CLI (Unknown Version)"
- `anthropic-sdk-typescript` → "Anthropic SDK (TypeScript)"

对于未知的客户端类型，函数会直接返回原始类型字符串，确保系统具有良好的扩展性。

#### 2.1.5 格式化函数

`formatClientInfo` 函数将 ClientInfo 格式化为可读的字符串，格式为 `{clientType} v{version}`，例如 "claude-cli v2.0.31"。这在日志记录和调试时非常有用。

---

### 2.2 客户端版本检查器 (ClientVersionChecker)

**文件位置**: `src/lib/client-version-checker.ts`

ClientVersionChecker 是整个版本检查系统的核心类，负责 GA 版本的检测、版本比较、用户版本追踪等功能。它是一个纯静态类，所有方法都是静态的，便于在代理管道中直接调用。

#### 2.2.1 GA 版本定义

GA（Generally Available）版本是指被至少一定数量用户使用的最新稳定版本。系统通过环境变量 `CLIENT_VERSION_GA_THRESHOLD` 配置阈值（默认 2，范围 1-10）。

GA 版本判定规则：
1. 统计过去 7 天内活跃用户的版本分布
2. 某个版本的用户数 >= GA_THRESHOLD 时视为候选 GA 版本
3. 在所有候选版本中选择版本号最新的作为 GA 版本

这种动态 GA 检测机制的优势在于：
- 不需要手动维护版本白名单
- 自动适应版本发布节奏
- 基于真实用户数据，避免误判
- 支持灰度发布场景

#### 2.2.2 GA 阈值配置

```typescript
const GA_THRESHOLD = (() => {
  const envValue = process.env.CLIENT_VERSION_GA_THRESHOLD;
  const parsed = envValue ? parseInt(envValue, 10) : 2;
  
  // 边界校验：范围 1-10
  if (Number.isNaN(parsed) || parsed < 1) return 1;
  if (parsed > 10) return 10;
  
  return parsed;
})();
```

配置在模块加载时初始化，并进行边界检查。如果配置无效，会记录警告日志并使用边界值。

#### 2.2.3 Redis 缓存策略

**Key 结构**:
- 用户版本: `client_version:{clientType}:{userId}`
- GA 版本: `ga_version:{clientType}`

**TTL 配置**:
- 用户版本: 7 天（与活跃窗口匹配）
- GA 版本: 5 分钟

GA 版本使用短 TTL（5 分钟）的原因是：
- 新版本发布后需要快速检测
- 用户升级后需要及时反映
- 5 分钟的延迟在可接受范围内
- 大幅减少数据库查询压力

#### 2.2.4 核心方法详解

**detectGAVersion(clientType: string)**

这是最重要的方法，负责检测指定客户端类型的最新 GA 版本：

```typescript
static async detectGAVersion(clientType: string): Promise<string | null> {
  // 1. 尝试从 Redis 读取缓存
  const cached = await redis.get(REDIS_KEYS.gaVersion(clientType));
  if (cached) return JSON.parse(cached).version;
  
  // 2. 缓存未命中，查询数据库
  const activeUsers = await getActiveUserVersions(7);
  
  // 3. 解析所有 UA，过滤出指定客户端类型
  const clientUsers = activeUsers
    .map(user => {
      const clientInfo = parseUserAgent(user.userAgent);
      return clientInfo?.clientType === clientType 
        ? { ...user, version: clientInfo.version } 
        : null;
    })
    .filter(Boolean);
  
  // 4. 使用内存计算确定 GA 版本
  const gaVersion = ClientVersionChecker.computeGAVersionFromUsers(clientUsers);
  
  // 5. 将结果写入 Redis 缓存
  await redis.setex(
    REDIS_KEYS.gaVersion(clientType),
    TTL.GA_VERSION,
    JSON.stringify({ version: gaVersion, userCount, updatedAt: Date.now() })
  );
  
  return gaVersion;
}
```

**computeGAVersionFromUsers 算法**

```typescript
private static computeGAVersionFromUsers(
  users: Array<{ userId: number; version: string }>
): string | null {
  if (users.length === 0) return null;
  
  // 1. 统计每个版本的用户数（去重）
  const versionCounts = new Map<string, Set<number>>();
  for (const user of users) {
    if (!versionCounts.has(user.version)) {
      versionCounts.set(user.version, new Set());
    }
    versionCounts.get(user.version)?.add(user.userId);
  }
  
  // 2. 找到用户数 >= GA_THRESHOLD 的最新版本
  let gaVersion: string | null = null;
  for (const [version, userIds] of versionCounts.entries()) {
    if (userIds.size >= GA_THRESHOLD) {
      if (!gaVersion || isVersionGreater(version, gaVersion)) {
        gaVersion = version;
      }
    }
  }
  
  return gaVersion;
}
```

这个算法的特点：
- 使用 Set 去重，确保同一用户的多个请求只计算一次
- 使用 isVersionGreater 进行语义化版本比较
- 时间复杂度 O(n)，n 为用户数

**shouldUpgrade(clientType, userVersion)**

检查用户版本是否需要升级：

```typescript
static async shouldUpgrade(
  clientType: string,
  userVersion: string
): Promise<{ needsUpgrade: boolean; gaVersion: string | null }> {
  try {
    const gaVersion = await ClientVersionChecker.detectGAVersion(clientType);
    if (!gaVersion) {
      return { needsUpgrade: false, gaVersion: null }; // 无 GA 版本，放行
    }
    
    const needsUpgrade = isVersionLess(userVersion, gaVersion);
    return { needsUpgrade, gaVersion };
  } catch (error) {
    // Fail Open: 检查失败时放行
    return { needsUpgrade: false, gaVersion: null };
  }
}
```

**updateUserVersion(userId, clientType, version)**

异步更新用户当前使用的版本：

```typescript
static async updateUserVersion(
  userId: number,
  clientType: string,
  version: string
): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return; // Redis 不可用，跳过
    
    const data = { version, lastSeen: Date.now() };
    await redis.setex(
      REDIS_KEYS.userVersion(clientType, userId),
      TTL.USER_VERSION,
      JSON.stringify(data)
    );
  } catch (error) {
    // 非关键操作，仅记录日志
  }
}
```

这个方法采用 "fire-and-forget" 模式：
- 不阻塞主请求流程
- 失败不影响用户体验
- 仅用于统计和追踪，不参与决策

**getAllClientStats()**

获取所有客户端类型的版本统计，供前端管理界面使用：

```typescript
static async getAllClientStats(): Promise<ClientVersionStats[]> {
  // 1. 查询活跃用户（一次性查询，避免 N+1）
  const activeUsers = await getActiveUserVersions(7);
  
  // 2. 解析 UA 并分组
  const clientGroups = new Map<string, Array<...>>();
  for (const user of activeUsers) {
    const clientInfo = parseUserAgent(user.userAgent);
    if (!clientInfo) continue;
    // 按 clientType 分组
  }
  
  // 3. 为每个客户端类型生成统计
  const stats: ClientVersionStats[] = [];
  for (const [clientType, users] of clientGroups.entries()) {
    // 去重、计算 GA、标记状态
  }
  
  return stats;
}
```

返回的数据结构：

```typescript
interface ClientVersionStats {
  clientType: string;
  gaVersion: string | null;
  totalUsers: number;
  users: {
    userId: number;
    username: string;
    version: string;
    lastSeen: Date;
    isLatest: boolean;
    needsUpgrade: boolean;
  }[];
}
```

---

### 2.3 代理版本守卫 (ProxyVersionGuard)

**文件位置**: `src/app/v1/_lib/proxy/version-guard.ts`

ProxyVersionGuard 是守卫管道的具体实现，负责在请求处理过程中执行版本检查。

#### 2.3.1 职责

1. 检查系统配置是否启用客户端版本检查
2. 解析客户端 UA 并提取版本信息
3. 检查用户版本是否需要升级
4. 异步更新用户版本追踪
5. 拦截旧版本用户或放行请求

#### 2.3.2 执行流程

```
1. 检查 enableClientVersionCheck 配置
   └─ 未启用 → 放行
2. 确保用户已认证
   └─ 未认证 → 放行（理论上不会发生）
3. 解析 User-Agent
   └─ 解析失败 → 放行（向后兼容）
4. 异步更新用户版本（不阻塞）
5. 检查是否需要升级
   └─ 不需要 → 放行
6. 构建错误响应并拦截
```

#### 2.3.3 Fail Open 策略

版本检查采用 "Fail Open" 设计原则：
- 任何错误都放行请求，不影响服务可用性
- 配置关闭时跳过所有检查
- UA 解析失败时向后兼容
- 数据库查询失败返回空结果

这种设计确保了版本检查功能不会成为系统的单点故障。即使 Redis 不可用、数据库连接失败或代码出现 bug，用户的请求仍然可以正常处理。

#### 2.3.4 错误响应格式

当拦截旧版本客户端时，返回 HTTP 400 错误：

```json
{
  "error": {
    "type": "client_upgrade_required",
    "message": "Your Claude CLI (v2.0.20) is outdated. Please upgrade to v2.0.35 or later to continue using this service.",
    "current_version": "2.0.20",
    "required_version": "2.0.35",
    "client_type": "claude-cli",
    "client_display_name": "Claude CLI"
  }
}
```

错误响应包含以下信息：
- `type`: 错误类型标识，客户端可以据此提供特定的处理逻辑
- `message`: 人类可读的错误消息，包含当前版本和所需版本
- `current_version`: 用户当前使用的版本
- `required_version`: 所需的最低版本
- `client_type`: 客户端类型标识
- `client_display_name`: 客户端显示名称

---

### 2.4 版本比较工具 (Version Utilities)

**文件位置**: `src/lib/version.ts`

版本比较工具提供了语义化版本（SemVer）的解析和比较功能。

#### 2.4.1 语义化版本解析

支持标准的 SemVer 格式：
- 主版本号.次版本号.修订号（如 `1.2.3`）
- 预发布标识（如 `1.2.3-beta.1`）
- 构建元数据（如 `1.2.3+build.1`，比较时忽略）
- v 前缀（如 `v1.2.3`，自动处理）

解析函数 `parseSemverLike` 的处理流程：
1. 去除首尾空白
2. 去除 v/V 前缀
3. 去除构建元数据（+ 后面的内容）
4. 分割核心版本和预发布标识
5. 解析数字部分为整数数组
6. 解析预发布标识为数字或字符串标记

#### 2.4.2 比较函数

**compareVersions(current, latest)**

⚠️ 注意：返回值语义与常见的比较函数相反！

- 返回 1: latest > current（需要升级）
- 返回 0: 版本相等
- 返回 -1: current > latest（当前更新）

这种设计的原因是：在版本检查的上下文中，我们最关心的是 "latest 是否比 current 新"，返回 1 表示 "需要升级"，语义上更直观。

比较逻辑：
1. 比较核心版本号的每个部分
2. 稳定版本 > 预发布版本
3. 预发布版本按标识符逐个比较
4. 数字标识符 < 字符串标识符

**辅助函数**:
- `isVersionGreater(a, b)`: 判断 a 是否比 b 新
- `isVersionLess(a, b)`: 判断 a 是否比 b 旧
- `isVersionEqual(a, b)`: 判断版本是否相等

#### 2.4.3 预发布版本处理

遵循 SemVer 规范：
- 稳定版本 > 预发布版本（`1.2.3` > `1.2.3-beta`）
- 数字标识符按数值比较（`alpha.2` < `alpha.10`）
- 数字标识符 < 字符串标识符（`alpha.1` < `alpha.beta`）

#### 2.4.4 Fail Open 设计

如果版本字符串无法解析，视为相等：

```typescript
if (!currentParsed || !latestParsed) {
  return 0; // Fail open
}
```

这确保了：
- 开发版本（如 "dev"）不会触发升级提示
- 自定义版本格式不会导致误判
- 系统对异常输入具有容错性

---

### 2.5 数据访问层

**文件位置**: `src/repository/client-versions.ts`

数据访问层负责从数据库查询活跃用户版本信息。

#### 2.5.1 活跃用户查询

`getActiveUserVersions(days = 7)` 函数：
- 查询过去 N 天内活跃用户
- 从 `messageRequest` 表获取 User-Agent 信息
- 关联 `users` 表获取用户名
- 按用户和 UA 分组，取最后活跃时间

#### 2.5.2 查询逻辑

```sql
SELECT 
  messageRequest.userId,
  users.name as username,
  messageRequest.userAgent,
  MAX(messageRequest.createdAt) as lastSeen
FROM messageRequest
LEFT JOIN users ON messageRequest.userId = users.id AND users.deletedAt IS NULL
WHERE messageRequest.createdAt >= {cutoffDate}
  AND messageRequest.userAgent IS NOT NULL
GROUP BY messageRequest.userId, users.name, messageRequest.userAgent
ORDER BY MAX(messageRequest.createdAt) DESC
```

查询特点：
- 使用 LEFT JOIN 关联用户表，处理可能已删除的用户
- 使用 MAX(createdAt) 获取每个 (userId, userAgent) 组合的最后活跃时间
- 过滤掉没有 UA 的请求（可能是某些自动化工具）
- 按最后活跃时间降序排列

#### 2.5.3 Fail Open

```typescript
try {
  // 执行查询
} catch (error) {
  // Fail Open: 查询失败返回空数组
  logger.error({ error }, "[ClientVersions] 查询活跃用户失败");
  return [];
}
```

查询失败时返回空数组，确保版本检查可以继续执行（虽然不会有任何 GA 版本被检测到）。

---

## 3. 系统集成 (System Integration)

### 3.1 守卫管道集成

**文件位置**: `src/app/v1/_lib/proxy/guard-pipeline.ts`

版本检查作为守卫管道的一个步骤，在 `CHAT_PIPELINE` 和 `COUNT_TOKENS_PIPELINE` 中都包含：

```typescript
export const CHAT_PIPELINE: GuardConfig = {
  steps: [
    "auth",           // 认证
    "sensitive",      // 敏感词检查
    "client",         // 客户端检查
    "model",          // 模型检查
    "version",        // ← 版本检查
    "probe",          // 探针请求
    "session",        // 会话管理
    "warmup",         // Warmup 请求处理
    "requestFilter",  // 请求过滤
    "rateLimit",      // 限流
    "provider",       // 供应商选择
    "providerRequestFilter", // 供应商请求过滤
    "messageContext", // 消息上下文
  ],
};

export const COUNT_TOKENS_PIPELINE: GuardConfig = {
  steps: [
    "auth",
    "client",
    "model",
    "version",        // ← 版本检查（同样包含）
    "probe",
    "requestFilter",
    "provider",
    "providerRequestFilter",
  ],
};
```

`COUNT_TOKENS_PIPELINE` 是一个精简的管道，用于 `count_tokens` 请求，跳过了会话管理、限流等非必要步骤，但保留了版本检查。

### 3.2 系统配置

**数据库 Schema**: `src/drizzle/schema.ts`

```typescript
enableClientVersionCheck: boolean('enable_client_version_check')
  .notNull()
  .default(false),
```

**类型定义**: `src/types/system-config.ts`

```typescript
interface SystemSettings {
  enableClientVersionCheck: boolean;
  // ...
}

interface UpdateSystemSettingsInput {
  enableClientVersionCheck?: boolean;
}
```

### 3.3 配置接口

**Action**: `src/actions/system-config.ts`

提供 `saveSystemSettings` 动作，支持更新 `enableClientVersionCheck` 配置：

```typescript
export async function saveSystemSettings(
  input: UpdateSystemSettingsInput
): Promise<ActionResult<void>> {
  // 验证输入
  const validated = UpdateSystemSettingsSchema.parse(input);
  
  // 更新数据库
  await updateSystemSettings({
    enableClientVersionCheck: validated.enableClientVersionCheck,
    // ...
  });
  
  // 清除缓存
  invalidateSystemSettingsCache();
}
```

**缓存**: `src/lib/config/system-settings-cache.ts`

系统设置通过缓存层访问，默认 `enableClientVersionCheck` 为 `false`：

```typescript
return {
  // ...
  enableClientVersionCheck: false,
  // ...
} satisfies SystemSettings;
```

缓存 TTL 为 60 秒，确保配置变更可以较快生效。

---

## 4. 管理界面 (Admin Interface)

### 4.1 客户端版本管理页面

**页面**: `src/app/[locale]/settings/client-versions/page.tsx`

权限要求：管理员（`role === "admin"`）

页面包含两个主要区域：
1. **升级提醒设置**：启用/禁用版本检查功能
2. **客户端版本分布**：显示各客户端类型的版本统计

页面使用 React Suspense 进行流式渲染：

```typescript
<Suspense fallback={<ClientVersionsSettingsSkeleton />}>
  <ClientVersionsSettingsContent />
</Suspense>

<Suspense fallback={<ClientVersionsTableSkeleton />}>
  <ClientVersionsStatsContent />
</Suspense>
```

### 4.2 功能开关组件

**组件**: `src/app/[locale]/settings/client-versions/_components/client-version-toggle.tsx`

提供启用/禁用版本检查的切换开关，包含功能说明：

```typescript
export function ClientVersionToggle({ enabled }: ClientVersionToggleProps) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [isPending, startTransition] = useTransition();
  
  async function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await saveSystemSettings({
        enableClientVersionCheck: checked,
      });
      
      if (result.ok) {
        setIsEnabled(checked);
        toast.success(checked ? t("toggle.enableSuccess") : t("toggle.disableSuccess"));
      }
    });
  }
  
  return (
    <SettingsToggleRow
      title={t("toggle.enable")}
      description={t("toggle.description")}
      checked={isEnabled}
      onCheckedChange={handleToggle}
      disabled={isPending}
    />
  );
}
```

功能说明包含：
- 自动检测每种客户端的最新 GA 版本
- GA 版本判定规则（用户数 >= 阈值）
- 活跃窗口定义（过去 7 天）
- 旧版本拦截行为
- 推荐做法（先观察版本分布再启用）

### 4.3 版本统计表格

**组件**: `src/app/[locale]/settings/client-versions/_components/client-version-stats-table.tsx`

显示信息包括：

**统计卡片**:
- 客户端类型数
- 总用户数
- 有 GA 版本的类型数
- GA 覆盖率

**详细表格**（按客户端类型分组）：
- 用户名
- 当前版本
- 最后活跃时间
- 状态（最新/需升级/未知）

状态标签使用颜色区分：
- 最新：绿色（bg-green-500）
- 需升级：红色（bg-red-500）
- 未知：灰色

### 4.4 数据获取 Action

**Action**: `src/actions/client-versions.ts`

`fetchClientVersionStats()` 函数：

```typescript
export async function fetchClientVersionStats(): Promise<ActionResult<ClientVersionStats[]>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限访问客户端版本统计" };
    }
    
    const stats = await ClientVersionChecker.getAllClientStats();
    return { ok: true, data: stats };
  } catch (error) {
    logger.error({ error }, "获取客户端版本统计失败");
    return { ok: false, error: message };
  }
}
```

---

## 5. 系统版本检查 (System Version Check)

### 5.1 版本检查 API

**端点**: `GET /api/version`

**文件**: `src/app/api/version/route.ts`

功能：检查系统自身是否有新版本可用

#### 5.1.1 版本来源

1. 环境变量 `NEXT_PUBLIC_APP_VERSION`
2. `VERSION` 文件
3. `package.json` 版本

优先级从高到低。

#### 5.1.2 最新版本获取

1. 首先尝试 GitHub Releases API
2. 如果失败，回退到读取仓库中的 `VERSION` 文件
3. 开发版本（`dev-*`）特殊处理，比较 commit SHA

```typescript
async function getLatestVersionInfo(): Promise<LatestVersionInfo | null> {
  try {
    const release = await fetchLatestRelease();
    if (!release) {
      // Fallback to VERSION file
      const latest = await fetchLatestVersionFromVersionFile();
      return latest ? { latest, releaseUrl: "..." } : null;
    }
    
    return {
      latest: normalizeVersionForDisplay(release.tag_name),
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
    };
  } catch (error) {
    // Fallback to VERSION file when GitHub API is rate-limited
    const latest = await fetchLatestVersionFromVersionFile();
    // ...
  }
}
```

#### 5.1.3 响应格式

```json
{
  "current": "v1.2.3",
  "latest": "v1.3.0",
  "hasUpdate": true,
  "releaseUrl": "https://github.com/.../releases/tag/v1.3.0",
  "publishedAt": "2024-01-15T10:30:00Z"
}
```

### 5.2 前端版本检查组件

**组件**: `src/components/customs/version-checker.tsx`

提供完整的版本检查 UI：
- 当前版本显示
- 最新版本显示
- 更新可用提示（橙色高亮）
- 发布时间（根据用户时区格式化）
- 检查更新按钮（带加载动画）
- 查看发布页面链接

**组件**: `src/components/customs/version-update-notifier.tsx`

提供静默版本检查：
- 页面加载时自动检查
- 仅在有更新时显示图标（AlertCircle）
- 工具提示显示版本信息
- 点击跳转到发布页面

---

## 6. 国际化支持 (i18n)

### 6.1 翻译文件

**中文**: `messages/zh-CN/settings/clientVersions.json`
**英文**: `messages/en/settings/clientVersions.json`

### 6.2 翻译键结构

```
clientVersions:
  title: 页面标题
  description: 功能描述
  section:
    settings: 设置区域
    distribution: 分布统计区域
  toggle: 开关相关
    enable: 启用开关标签
    description: 开关描述
    enableSuccess: 启用成功提示
    disableSuccess: 禁用成功提示
    toggleFailed: 操作失败提示
  features: 功能说明
    title: 功能说明标题
    whatHappens: 启用后会发生什么
    autoDetect: 自动检测 GA 版本
    gaRule: GA 判定规则
    gaRuleDesc: 规则描述
    activeWindow: 活跃窗口
    activeWindowDesc: 窗口描述
    blockOldVersion: 旧版本拦截行为
    errorMessage: 错误消息说明
    recommendation: 推荐做法
    recommendationDesc: 推荐描述
  table: 表格相关
    internalType: 内部类型标签
    currentGA: 当前 GA 版本标签
    usersCount: 用户数显示
    user: 用户列标题
    version: 版本列标题
    lastActive: 最后活跃列标题
    status: 状态列标题
    noUsers: 无用户数据提示
    latest: 最新状态标签
    needsUpgrade: 需升级状态标签
    unknown: 未知状态标签
    stats:
      clientTypes: 客户端类型统计
      totalUsers: 用户总数统计
      withGA: 有 GA 版本统计
      coverage: GA 覆盖率统计
```

### 6.3 导航标签

多语言导航标签：
- 简体中文: "客户端升级提醒"
- 繁体中文: "用戶端升級提醒"
- 英文: "Updates"
- 日文: "更新通知"
- 俄文: "Обновления"

---

## 7. 测试覆盖 (Testing)

### 7.1 版本比较测试

**文件**: `tests/unit/version.test.ts`

测试场景：
- 正常版本比较（latest > current）
- 预发布版本处理（stable > prerelease）
- 预发布标识比较（alpha < beta）
- 构建元数据忽略（+build）
- Fail Open 策略（无法解析的版本视为相等）

```typescript
describe("版本比较", () => {
  test("应正确判断是否存在可升级版本（latest > current）", () => {
    expect(compareVersions("v0.3.0", "v0.3.33")).toBe(1);
    expect(compareVersions("v0.3.33", "v0.3.0")).toBe(-1);
    expect(compareVersions("v0.3.33", "v0.3.33")).toBe(0);
  });
  
  test("应正确处理预发布版本（stable > prerelease）", () => {
    expect(compareVersions("v1.2.3-beta.1", "v1.2.3")).toBe(1);
    expect(compareVersions("v1.2.3", "v1.2.3-beta.1")).toBe(-1);
  });
  
  test("无法解析的版本应 Fail Open（视为相等）", () => {
    expect(compareVersions("dev", "v1.0.0")).toBe(0);
    expect(isVersionLess("dev", "v1.0.0")).toBe(false);
    expect(isVersionGreater("dev", "v1.0.0")).toBe(false);
    expect(isVersionEqual("dev", "v1.0.0")).toBe(true);
  });
});
```

### 7.2 客户端守卫测试

**文件**: `tests/unit/proxy/client-guard.test.ts`

测试 User-Agent 匹配逻辑：
- 缺少 UA 时的处理
- 空 UA 的处理
- 模式匹配（大小写不敏感、连字符/下划线归一化）
- 子字符串匹配

### 7.3 代理转发器测试

**文件**: `tests/unit/proxy/proxy-forwarder.test.ts`

测试 User-Agent 解析和转发：
- 过滤器修改 UA 的优先级
- 原始 UA 回退
- 兜底 UA 值
- 空字符串 UA 保留

---

## 8. 配置与环境变量

### 8.1 环境变量

| 变量名 | 说明 | 默认值 | 范围 |
|-------|------|--------|------|
| `CLIENT_VERSION_GA_THRESHOLD` | GA 版本阈值 | 2 | 1-10 |
| `NEXT_PUBLIC_APP_VERSION` | 应用版本号 | - | - |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API 认证 | - | - |

### 8.2 数据库配置

系统设置表中的字段：
- `enable_client_version_check`: BOOLEAN, NOT NULL, DEFAULT false

### 8.3 运行时配置

通过管理界面动态配置：
- 启用/禁用客户端版本检查
- 实时生效，无需重启服务

---

## 9. 安全与可靠性设计

### 9.1 Fail Open 策略

系统在以下情况会放行请求：
- 版本检查功能未启用
- 用户未认证
- User-Agent 解析失败
- 数据库查询失败
- Redis 不可用
- 任何未预期的错误

这种设计确保了版本检查不会成为系统的单点故障。

### 9.2 向后兼容

- 无法识别的 UA 格式不会导致请求失败
- 旧版本客户端在没有启用版本检查时正常工作
- 版本解析失败时视为相等（不强制升级）

### 9.3 性能优化

- GA 版本结果缓存 5 分钟，减少数据库查询
- 用户版本异步更新，不阻塞请求处理
- 内存计算 GA 版本，避免重复数据库查询
- 活跃窗口限制（7 天），控制数据量

---

## 10. 使用场景与最佳实践

### 10.1 启用版本检查的建议流程

1. **观察阶段**：查看版本分布统计，了解当前用户使用的版本情况
2. **确认阶段**：等待新版本稳定，确保有多个用户已升级
3. **启用阶段**：在管理界面启用版本检查功能
4. **监控阶段**：关注用户反馈和系统日志

### 10.2 多客户端管理

VSCode 插件和 CLI 作为独立客户端分别管理：
- `claude-vscode` 有自己的 GA 版本
- `claude-cli` 有自己的 GA 版本
- 用户可能同时使用两种客户端，分别计算

### 10.3 升级提示示例

当用户使用旧版本时，会看到如下错误：

```
Your Claude CLI (v2.0.20) is outdated. 
Please upgrade to v2.0.35 or later to continue using this service.
```

---

## 11. 与其他功能的关系

### 11.1 与客户端守卫的区别

| 功能 | 客户端守卫 (ClientGuard) | 版本守卫 (VersionGuard) |
|------|-------------------------|------------------------|
| 目的 | 限制允许使用的客户端类型 | 确保使用最新版本 |
| 配置级别 | 用户级别 (allowedClients) | 系统级别 (enableClientVersionCheck) |
| 检查时机 | 每次请求 | 每次请求 |
| 失败处理 | 返回 400 错误 | 返回 400 错误 |

### 11.2 与会话管理的关系

版本检查在会话管理之前执行，确保：
- 旧版本客户端在会话建立前被拦截
- 避免为旧版本客户端创建不必要的会话记录

### 11.3 与限流的关系

版本检查在限流之前执行，确保：
- 旧版本客户端不会消耗限流配额
- 限流统计只包含合规客户端

---

## 12. 潜在扩展点

### 12.1 可配置项扩展

- GA 阈值支持按客户端类型配置
- 活跃窗口天数可配置
- 自定义版本检查规则
- 白名单/黑名单版本号

### 12.2 通知机制扩展

- 邮件通知管理员有新版本可用
- 通知用户即将强制升级
- 升级提醒提前期配置

### 12.3 统计功能扩展

- 版本升级趋势图表
- 客户端类型使用比例
- 版本分布历史记录

---

## 13. 实现细节补充

### 13.1 数据库迁移

**原始迁移**: `drizzle/0015_narrow_gunslinger.sql`

```sql
ALTER TABLE "system_settings" ADD COLUMN "enable_client_version_check" boolean DEFAULT false NOT NULL;
```

**修复迁移**: `drizzle/0047_fix_system_settings_columns.sql`

```sql
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "enable_client_version_check" boolean DEFAULT false NOT NULL;
```

### 13.2 权限控制

客户端版本管理页面仅对管理员开放：

```typescript
if (!session || session.user.role !== "admin") {
  return redirect({ href: "/login", locale });
}
```

### 13.3 缓存失效

当系统设置更新时，缓存会自动失效：

```typescript
export async function saveSystemSettings(input: UpdateSystemSettingsInput) {
  // ... 更新数据库 ...
  
  // 清除缓存
  invalidateSystemSettingsCache();
}
```

### 13.4 日志记录

版本检查的关键操作都有详细的日志记录：

```typescript
logger.debug(
  { clientType, gaVersion: data.version },
  "[ClientVersionChecker] GA 版本缓存命中"
);

logger.info(
  { clientType, gaVersion, userCount: cacheData.userCount },
  "[ClientVersionChecker] GA 版本已缓存"
);

logger.warn(
  { userId, clientType, currentVersion, requiredVersion },
  "[ProxyVersionGuard] 客户端版本过旧，已拦截"
);
```

---

## 14. 边缘情况处理 (Edge Cases)

### 14.1 User-Agent 缺失或无效

当请求缺少 User-Agent 头部或格式无法识别时：

```typescript
const clientInfo = parseUserAgent(session.userAgent);
if (!clientInfo) {
  logger.debug({ ua: session.userAgent }, "[ProxyVersionGuard] UA 解析失败，放行");
  return null; // 解析失败，向后兼容
}
```

系统选择放行而非拦截，这是基于以下考虑：
- 某些自动化工具可能不发送 UA
- 自定义客户端可能使用非标准格式
- 强制要求 UA 可能导致意外的服务中断

### 14.2 无活跃用户数据

当系统刚部署或某客户端类型尚无用户时：

```typescript
const gaVersion = await ClientVersionChecker.detectGAVersion(clientType);
if (!gaVersion) {
  return { needsUpgrade: false, gaVersion: null }; // 无 GA 版本，放行
}
```

没有 GA 版本时不拦截任何请求，这允许：
- 新客户端类型的渐进式采用
- 冷启动场景下的正常服务
- 小众客户端的灵活使用

### 14.3 Redis 不可用

当 Redis 连接失败时：

1. **GA 版本检测**：直接查询数据库，跳过缓存
2. **用户版本更新**：静默失败，不影响主流程
3. **系统整体**：继续提供服务，仅性能略有下降

```typescript
const redis = getRedisClient();
if (!redis) {
  return; // Redis 不可用，跳过用户版本更新
}
```

### 14.4 数据库查询失败

当数据库查询失败时：

```typescript
try {
  const results = await db.select(...);
} catch (error) {
  logger.error({ error }, "[ClientVersions] 查询活跃用户失败");
  return []; // Fail Open: 查询失败返回空数组
}
```

返回空数组导致无法检测到 GA 版本，进而放行所有请求。

### 14.5 版本号格式异常

当版本号无法解析时（如 "dev"、"latest"）：

```typescript
const currentParsed = parseSemverLike(current);
const latestParsed = parseSemverLike(latest);

if (!currentParsed || !latestParsed) {
  return 0; // Fail open: 任何无法解析的版本都视为相等
}
```

这确保了开发版本或自定义版本不会触发错误的升级提示。

---

## 15. 性能特征 (Performance Characteristics)

### 15.1 请求处理延迟

版本检查对请求延迟的影响：

| 场景 | 延迟影响 | 说明 |
|------|----------|------|
| 缓存命中 | ~1-2ms | Redis 读取 GA 版本 |
| 缓存未命中 | ~10-50ms | 数据库查询 + 计算 |
| 首次请求（新客户端类型） | ~50-100ms | 完整查询和缓存写入 |

### 15.2 数据库查询成本

`getActiveUserVersions(7)` 查询特征：
- 查询范围：过去 7 天的 `messageRequest` 记录
- 返回数据量：通常几百到几千条（取决于活跃用户数和不同 UA 数）
- 索引使用：命中 `createdAt` 和 `userAgent` 索引
- 执行频率：每 5 分钟每客户端类型一次（缓存失效后）

### 15.3 内存使用

`computeGAVersionFromUsers` 的内存特征：
- 使用 Map 存储版本到用户 Set 的映射
- 内存占用：O(用户数)，通常 < 1MB
- 临时对象，方法返回后由 GC 回收

### 15.4 并发处理

版本检查的并发安全性：
- GA 版本检测：幂等操作，并发安全
- 用户版本更新：使用 Redis 原子操作
- 无共享可变状态

---

## 16. 监控与告警 (Monitoring & Alerting)

### 16.1 关键指标

建议监控的指标：

| 指标 | 来源 | 说明 |
|------|------|------|
| `version_check_total` | ProxyVersionGuard | 版本检查总次数 |
| `version_check_blocked` | ProxyVersionGuard | 拦截的旧版本请求数 |
| `version_check_errors` | ProxyVersionGuard | 版本检查错误数 |
| `ga_version_cache_hit` | ClientVersionChecker | GA 版本缓存命中率 |
| `client_type_distribution` | ClientVersionChecker | 各客户端类型用户数 |

### 16.2 日志分析

关键日志模式：

```
# GA 版本检测成功
[ClientVersionChecker] GA 版本已缓存 { clientType: "claude-vscode", gaVersion: "2.0.35", userCount: 15 }

# 版本检查拦截
[ProxyVersionGuard] 客户端版本过旧，已拦截 { userId: 123, clientType: "claude-cli", currentVersion: "2.0.20", requiredVersion: "2.0.35" }

# 版本检查通过
[ProxyVersionGuard] 版本检查通过 { clientType: "claude-vscode", version: "2.0.35" }
```

### 16.3 告警建议

建议配置的告警：

1. **高拦截率告警**：当拦截率超过 20% 时触发，可能表示 GA 阈值设置过低
2. **缓存命中率低**：当 GA 版本缓存命中率低于 80% 时触发，可能需要调整缓存 TTL
3. **版本检查错误**：当版本检查错误率超过 1% 时触发，检查 Redis/数据库连接

---

## 17. 故障排查指南 (Troubleshooting)

### 17.1 用户报告无法访问

排查步骤：

1. 检查用户收到的错误消息：
   - 如果是 "client_upgrade_required" → 正常拦截，用户需要升级
   - 如果是其他错误 → 检查系统日志

2. 检查版本检查是否启用：
   ```sql
   SELECT enable_client_version_check FROM system_settings;
   ```

3. 检查用户的客户端版本和当前 GA 版本：
   ```typescript
   // 在管理界面查看客户端版本分布
   ```

### 17.2 GA 版本检测异常

问题现象：新版本已发布但 GA 版本未更新

排查步骤：

1. 检查 Redis 缓存：
   ```bash
   redis-cli GET ga_version:claude-vscode
   ```

2. 检查活跃用户数据：
   ```sql
   SELECT user_agent, COUNT(DISTINCT user_id) as user_count
   FROM message_request
   WHERE created_at >= NOW() - INTERVAL '7 days'
   GROUP BY user_agent;
   ```

3. 检查 GA 阈值配置：
   ```bash
   echo $CLIENT_VERSION_GA_THRESHOLD
   ```

### 17.3 性能问题

问题现象：请求延迟增加

排查步骤：

1. 检查 Redis 连接状态
2. 检查数据库查询性能：
   ```sql
   EXPLAIN ANALYZE SELECT ...;  -- 使用 getActiveUserVersions 的查询
   ```

3. 考虑调整缓存 TTL 或 GA 阈值

---

## 18. 最佳实践总结 (Best Practices Summary)

### 18.1 初始部署建议

1. **先观察后启用**：部署后先观察 1-2 周的版本分布数据
2. **逐步调整阈值**：从较高的阈值（如 3-5）开始，逐步降低
3. **监控用户反馈**：关注用户关于升级提示的反馈

### 18.2 日常运维建议

1. **定期检查版本分布**：每周查看管理界面的版本统计
2. **关注新版本发布**：当官方发布新版本时，关注用户升级进度
3. **及时调整策略**：根据运营情况启用/禁用版本检查

### 18.3 与客户端发布配合

1. **灰度发布期间**：禁用版本检查，允许新旧版本共存
2. **正式发布后**：观察 1-2 天，确认稳定后启用版本检查
3. **紧急修复场景**：如需强制升级，可降低 GA 阈值到 1

---

## 19. 总结

客户端版本检查是 claude-code-hub 的一个重要运维功能，通过自动检测和拦截旧版本客户端，帮助管理员确保用户使用的是经过验证的稳定版本。该功能具有以下特点：

1. **智能化**：基于实际用户数据自动识别 GA 版本，无需手动维护版本列表
2. **多客户端支持**：独立管理 VSCode 插件、CLI、SDK 等不同客户端，每种客户端有自己的版本演进路线
3. **Fail Open**：任何异常都不影响服务可用性，确保版本检查不会成为单点故障
4. **可配置**：通过管理界面动态启用/禁用，根据运营情况灵活调整策略
5. **可观测**：提供详细的版本分布统计，帮助管理员了解用户版本使用情况

该功能特别适合需要统一管理大量用户客户端版本的场景，可以有效推动用户及时升级，减少因旧版本导致的问题。通过合理的 GA 阈值配置和渐进式启用策略，可以在保证系统稳定性的同时，引导用户保持客户端更新。

---

*文档生成时间: 2026-01-29*
*基于代码版本: claude-code-hub main branch*
