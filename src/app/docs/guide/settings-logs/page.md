---
dimensions:
  type:
    primary: getting-started
    detail: settings
  level: beginner
standard_title: 日志设置
language: zh
---

# 日志设置

日志设置页面允许管理员动态调整系统日志级别，实时控制日志输出的详细程度。这对于生产环境排查问题非常有用，无需重启服务即可切换日志级别。

---

## 访问路径

设置 > 日志（`/settings/logs`）

---

## 功能概述

日志设置页面提供以下核心功能：

- **动态日志级别调整**：实时修改系统日志输出级别
- **即时生效**：调整后立即生效，无需重启服务
- **级别预览**：清晰展示当前级别与新选择级别的差异

---

## 日志级别说明

Claude Code Hub 使用 [Pino](https://getpino.io/) 作为日志库，支持以下六个日志级别（从高到低）：

| 级别 | 说明 | 适用场景 |
|------|------|----------|
| **Fatal** | 仅致命错误 | 极高负载生产环境，最小化日志开销 |
| **Error** | 错误信息 | 高负载生产环境，仅关注错误 |
| **Warn** | 警告 + 错误 | 需要监控限流触发、熔断器状态等警告信息 |
| **Info** | 关键业务事件 + 警告 + 错误 | **推荐生产环境**，记录供应商选择、Session 复用、价格同步等关键事件 |
| **Debug** | 调试信息 + 所有级别 | **推荐开发环境**，包含详细调试信息 |
| **Trace** | 极详细追踪 + 所有级别 | 深度排查问题时使用，日志量极大 |

{% callout type="note" title="日志级别包含关系" %}
日志级别具有包含关系。例如，选择 `Info` 级别时，会同时输出 `Info`、`Warn`、`Error` 和 `Fatal` 级别的日志。
{% /callout %}

### 日志级别优先级

每个日志级别都有一个对应的优先级数值，数值越小表示越详细：

| 级别 | 优先级数值 |
|------|-----------|
| trace | 10 |
| debug | 20 |
| info | 30 |
| warn | 40 |
| error | 50 |
| fatal | 60 |

系统会根据当前设置的日志级别，输出所有优先级数值大于或等于该级别的日志。例如，当日志级别设置为 `info`（30）时，只会输出 `info`（30）、`warn`（40）、`error`（50）和 `fatal`（60）级别的日志。

---

## 使用方法

### 查看当前日志级别

进入日志设置页面后，系统会自动从服务端获取当前的日志级别，并在下拉选择器中显示。

### 修改日志级别

1. 在「日志级别控制」区域，点击日志级别下拉选择器
2. 从下拉列表中选择目标日志级别
3. 系统会显示一个橙色提示框，说明当前级别与即将切换到的级别
4. 确认无误后，点击「保存设置」按钮
5. 保存成功后会收到提示，新的日志级别立即生效

{% callout type="warning" title="生产环境建议" %}
- 生产环境推荐使用 `Info` 级别，可以记录关键业务事件而不会产生过多日志
- 排查问题时可临时切换到 `Debug` 或 `Trace` 级别，问题解决后记得调回
- `Trace` 级别会产生大量日志，可能影响系统性能，请谨慎使用
{% /callout %}

---

## 环境变量配置

除了在界面上动态调整，还可以通过环境变量设置初始日志级别：

```bash
# 设置日志级别（可选值：fatal, error, warn, info, debug, trace）
LOG_LEVEL=info
```

**优先级规则：**

1. 优先使用环境变量 `LOG_LEVEL` 的值
2. 如果设置了 `DEBUG_MODE=true`，则使用 `debug` 级别（向后兼容）
3. 开发环境（`NODE_ENV=development`）默认 `debug`
4. 生产环境默认 `info`

{% callout type="note" title="动态调整与环境变量" %}
通过界面动态调整的日志级别仅在当前进程有效。服务重启后会重新读取环境变量的配置。如需持久化日志级别设置，请修改环境变量。
{% /callout %}

---

## 技术架构

### 双日志器架构

Claude Code Hub 采用双日志器架构，确保在任何环境下都能正常输出日志：

1. **Console Logger（同步创建）**：系统启动时立即创建，使用浏览器/Node.js 原生 console 对象
2. **Pino Logger（异步加载）**：在 Node.js 环境下异步加载，加载完成后自动切换

这种架构的优势：

- **零延迟启动**：应用启动时立即可用，无需等待 Pino 加载
- **无缝切换**：Pino 加载完成后自动切换，日志级别设置自动继承
- **环境兼容**：在浏览器环境或 Edge Runtime 中自动降级为 Console Logger

### 灵活的参数格式

日志方法支持两种调用方式，自动适配参数顺序：

```typescript
// 方式一：Pino 原生方式（对象在前，消息在后）
logger.info({ userId: 123, action: 'login' }, '用户登录成功');

// 方式二：便捷方式（消息在前，对象在后）
logger.info('用户登录成功', { userId: 123, action: 'login' });
```

系统会自动检测参数类型并交换顺序，最终都会以 Pino 原生格式输出。

---

## 运行时 API

除了通过界面调整日志级别，开发者还可以在代码中使用以下 API：

### setLogLevel

动态调整日志级别：

```typescript
import { setLogLevel } from '@/lib/logger';

// 临时开启调试模式
setLogLevel('debug');

// 执行需要调试的操作...

// 恢复正常级别
setLogLevel('info');
```

### getLogLevel

获取当前日志级别：

```typescript
import { getLogLevel } from '@/lib/logger';

const currentLevel = getLogLevel();
console.log(`当前日志级别: ${currentLevel}`);
```

### 直接设置 logger.level

也可以直接通过 logger 对象的 level 属性进行设置：

```typescript
import { logger } from '@/lib/logger';

// 获取当前级别
console.log(logger.level);

// 设置新级别
logger.level = 'debug';
```

{% callout type="warning" title="API 使用注意" %}
运行时 API 的修改仅影响当前进程。如果应用有多个实例（如 PM2 集群模式），需要分别调用每个实例的 API。
{% /callout %}

---

## 日志输出格式

### 开发环境

开发环境下，日志使用 `pino-pretty` 格式化输出，具有以下特点：

- 带颜色高亮
- 时间戳转换为本地时间格式
- 隐藏 pid 和 hostname 字段

### 生产环境

生产环境下，日志使用 JSON 格式输出，便于日志收集和分析工具处理：

```json
{"level":"info","time":"2025-01-15T10:30:00.000Z","msg":"供应商选择完成","providerId":1,"providerName":"claude-primary"}
```

---

## 常见问题

### Q: 修改日志级别需要重启服务吗？

不需要。日志级别修改后立即生效，系统会使用 Pino 的运行时级别切换功能，无需重启任何进程。

### Q: 日志级别修改后为什么没有效果？

请检查以下几点：

1. 确认保存成功（界面显示成功提示）
2. 如果有多个服务实例，日志级别只会在当前实例生效（每个实例需单独设置）
3. 检查日志输出是否被其他工具（如日志收集器）过滤

### Q: 如何在容器环境中持久化日志级别？

通过环境变量设置：

```yaml
# docker-compose.yml
services:
  app:
    environment:
      - LOG_LEVEL=info
```

### Q: Debug 和 Trace 级别有什么区别？

- `Debug`：输出调试信息，如请求参数、响应结果、中间计算过程等
- `Trace`：输出极详细的追踪信息，包括每个函数调用、数据流转等细节

一般排查问题使用 `Debug` 级别即可，`Trace` 仅在需要深入追踪程序执行流程时使用。

---

## 相关文档

- [系统配置](/docs/guide/settings-config) - 配置站点参数和自动清理策略
- [数据管理](/docs/guide/settings-data) - 数据库备份和日志清理
- [消息推送](/docs/guide/settings-notifications) - 配置告警通知
