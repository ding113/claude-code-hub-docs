---
title: 时区处理
nextjs:
  metadata:
    title: 时区处理
    description: 了解 Claude Code Hub 的时区处理系统，包括配置方法、三层降级策略、时间窗口计算和前后端一致性保障。
---

# 时区处理

Claude Code Hub 实现了一套完整的时区处理系统，用于统一后端时间边界计算和前端日期时间显示。该系统基于 IANA 时区数据库标识符（如 `Asia/Shanghai`、`America/New_York`），通过多层配置和智能降级机制，确保在全球分布式部署场景下的时间一致性。

## 概述

时区处理在以下核心场景中发挥关键作用：

- **配额限流系统的时间窗口计算**（5小时、日、周、月周期）
- **排行榜数据的时区感知统计**（今日、本周、本月排行）
- **日志查询的时间范围筛选**
- **Webhook 通知的定时调度**
- **前端界面的本地化时间显示**

系统采用三层降级策略确保时区配置始终可用：数据库配置优先，环境变量次之，最终回退到 UTC。

## 配置时区

### 通过管理界面配置

系统管理员可以通过设置页面配置全局时区：

1. 导航至**设置 > 系统配置**
2. 找到**系统时区**选项
3. 选择以下任一模式：
   - **自动**：使用环境变量 `TZ` 的值
   - **特定时区**：从预定义的 IANA 时区列表中选择

预定义的常用时区包括：

- **UTC**：协调世界时
- **亚洲**：Asia/Shanghai、Asia/Tokyo、Asia/Seoul、Asia/Singapore、Asia/Hong_Kong、Asia/Taipei、Asia/Bangkok、Asia/Dubai、Asia/Kolkata
- **欧洲**：Europe/London、Europe/Paris、Europe/Berlin、Europe/Moscow、Europe/Amsterdam、Europe/Rome、Europe/Madrid
- **美洲**：America/New_York、America/Los_Angeles、America/Chicago、America/Denver、America/Toronto、America/Vancouver、America/Sao_Paulo、America/Mexico_City
- **太平洋**：Pacific/Auckland、Pacific/Sydney、Australia/Melbourne、Australia/Perth

### 通过环境变量配置

在 `.env` 文件或部署环境中设置：

```bash
TZ=Asia/Shanghai
```

环境变量作为数据库配置的 fallback，在以下情况生效：

- 数据库中未配置时区（`timezone` 为 `null`）
- 数据库不可用时

### 配置生效时间

系统设置使用 60 秒 TTL 的内存缓存。修改时区后，最多需要 60 秒才能全局生效。

## 三层降级策略

系统采用三层降级策略确保时区配置始终有效：

```
数据库配置 (system_settings.timezone)
    ↓ (如果未设置或无效)
环境变量 (TZ)
    ↓ (如果未设置或无效)
默认回退 (UTC)
```

### 第一层：数据库配置

管理员通过 UI 配置的时区存储在 `system_settings` 表中，具有最高优先级。这允许运行时动态调整时区而无需重启服务。

### 第二层：环境变量

`TZ` 环境变量作为第二优先级，适用于以下场景：

- 首次部署时数据库尚未初始化
- 数据库临时不可用
- 希望使用基础设施层面的配置管理

### 第三层：UTC 回退

当前两层都无效时，系统自动回退到 UTC。这确保了任何情况下系统都能正常运行，避免因时区问题导致的服务中断。

## 时区解析器

### 解析系统时区

使用 `resolveSystemTimezone()` 函数获取当前生效的系统时区：

```typescript
import { resolveSystemTimezone } from "@/lib/utils/timezone";

const timezone = await resolveSystemTimezone();
// 返回: "Asia/Shanghai" 或 "America/New_York" 等
```

该函数自动执行三层降级逻辑，始终返回有效的 IANA 时区标识符。

### 验证时区有效性

使用 `isValidIANATimezone()` 验证时区字符串：

```typescript
import { isValidIANATimezone } from "@/lib/utils/timezone";

isValidIANATimezone("Asia/Shanghai");     // true
isValidIANATimezone("Invalid/Zone");      // false
isValidIANATimezone("UTC");               // true
```

验证使用浏览器或 Node.js 原生的 `Intl.DateTimeFormat` API，确保时区在 IANA 时区数据库中存在。

### 获取时区显示标签

生成用户友好的时区标签：

```typescript
import { getTimezoneLabel } from "@/lib/utils/timezone";

getTimezoneLabel("Asia/Shanghai");
// 返回: "(UTC+08:00) Asia/Shanghai"
```

## 时间窗口计算

### 限流系统的时间窗口

限流系统支持四种时间周期，每种都有特定的时区处理逻辑：

| 周期 | 模式 | 时区影响 |
|------|------|----------|
| 5小时 | 滚动窗口 | 无时区影响，基于 UTC 时间 |
| 每日 | 固定重置 | 基于系统时区的自定义重置时间 |
| 每周 | 自然周 | 基于系统时区的周一 00:00 |
| 每月 | 自然月 | 基于系统时区的每月 1 号 00:00 |

### 每日限流的两种模式

每日限额支持两种重置模式：

**固定模式（fixed）**

在指定的每天时刻重置。例如配置 `dailyResetTime = "08:00"`，则每天北京时间 08:00 重置限额。

```typescript
// 每天 08:00 重置（系统时区）
const range = await getTimeRangeForPeriod("daily", "08:00");
```

**滚动模式（rolling）**

基于过去 24 小时滚动计算，不受时区设置影响。

```typescript
// 过去 24 小时滚动窗口
const range = await getTimeRangeForPeriodWithMode("daily", "00:00", "rolling");
```

### 时区转换原理

系统使用 `date-fns-tz` 库进行时区转换，遵循以下模式：

```typescript
import { toZonedTime, fromZonedTime } from "date-fns-tz";

// 1. 将 UTC 时间转换为系统时区的本地时间
const zonedNow = toZonedTime(utcDate, timezone);

// 2. 在本地时间上进行日期计算
const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });

// 3. 将本地时间转换回 UTC 时间戳
const startTime = fromZonedTime(zonedStartOfWeek, timezone);
```

这确保了"周一 00:00"是基于系统配置的时区，而非服务器本地时区。

## 数据库层面的时区处理

### SQL 时区转换

排行榜和统计查询在 SQL 层面进行时区转换：

```typescript
// 使用 PostgreSQL AT TIME ZONE 进行时区转换
sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = 
    (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
```

这确保了：

- "今日"数据基于系统时区的日期边界
- 统计结果与应用程序计算一致
- 避免 Node.js Date 对象带来的时区偏移问题

### 排行榜时区感知

所有排行榜查询都接收时区参数：

```typescript
// 获取今日排行榜（基于系统时区）
const dailyLeaderboard = await findDailyLeaderboard();

// 获取本周排行榜（基于系统时区）
const weeklyLeaderboard = await findWeeklyLeaderboard();

// 获取本月排行榜（基于系统时区）
const monthlyLeaderboard = await findMonthlyLeaderboard();
```

## 前端时区处理

### Next-Intl 时区配置

项目使用 next-intl 进行国际化，时区在请求级别配置：

```typescript
// src/i18n/request.ts
export default getRequestConfig(async ({ requestLocale }) => {
  const timeZone = await resolveSystemTimezone();
  
  return {
    locale,
    messages,
    timeZone,
    now: new Date(),
  };
});
```

时区通过 `NextIntlClientProvider` 传递到前端组件：

```typescript
<NextIntlClientProvider messages={messages} timeZone={timeZone} now={now}>
  {children}
</NextIntlClientProvider>
```

### 使用系统时区显示时间

前端组件使用 `useTimeZone()` 获取系统配置的时区：

```typescript
"use client";

import { useTimeZone } from "next-intl";
import { formatInTimeZone } from "date-fns-tz";

function TimestampDisplay({ date }: { date: Date }) {
  const timeZone = useTimeZone() ?? "UTC";
  
  return (
    <span>
      {formatInTimeZone(date, timeZone, "yyyy-MM-dd HH:mm:ss")}
    </span>
  );
}
```

### 相对时间组件

系统提供 `RelativeTime` 组件显示相对时间（如"2 小时前"），同时支持悬停显示绝对时间：

```typescript
import { RelativeTime } from "@/components/ui/relative-time";

<RelativeTime date={createdAt} />
```

该组件：

- 使用 `useTimeZone()` 获取系统时区
- 使用 `formatInTimeZone` 格式化绝对时间
- 解决 Next.js SSR Hydration 错误

## 日期输入解析

### 解析用户输入的日期

系统提供 `parseDateInputAsTimezone` 函数处理用户输入的日期字符串：

```typescript
import { parseDateInputAsTimezone } from "@/lib/utils/date-input";

// 日期格式：解析为该时区的当天结束时间（23:59:59）
const date1 = parseDateInputAsTimezone("2025-01-15", "Asia/Shanghai");

// 带时区标识符：直接解析为绝对时间点
const date2 = parseDateInputAsTimezone("2025-01-15T08:00:00Z", "Asia/Shanghai");

// 无时区的 ISO 时间：视为指定时区的本地时间
const date3 = parseDateInputAsTimezone("2025-01-15 08:00:00", "Asia/Shanghai");
```

支持的输入格式：

- **YYYY-MM-DD**：解析为该时区的当天 23:59:59
- **带时区标识符的 ISO 时间**（Z 或 +-HH:MM）：直接解析
- **无时区的 ISO 时间**：视为指定时区的本地时间

## Webhook 通知调度

### 通知时区配置

Webhook 通知支持绑定级别的自定义时区：

```typescript
// 优先级：绑定的 scheduleTimezone > 系统时区
const timezone = binding?.scheduleTimezone ?? await resolveSystemTimezone();
```

这允许：

- 系统级默认时区
- 特定通知绑定使用不同的时区
- Cron 表达式基于指定时区执行

### 日期格式化

Webhook 消息中的日期使用系统时区格式化：

```typescript
import { formatDateTime } from "@/lib/webhook/utils/date";

const formatted = formatDateTime(new Date(), "Asia/Shanghai");
// 返回: "2025/01/15 08:00:00"
```

## 最佳实践

### 始终使用 resolveSystemTimezone()

不要直接读取环境变量或数据库获取时区，始终使用封装好的函数：

```typescript
// 正确
const timezone = await resolveSystemTimezone();

// 错误
const timezone = process.env.TZ;
```

### 数据库存储 UTC

所有时间戳以 UTC 存储，仅在显示时转换：

```typescript
// 存储：始终使用 UTC
await db.insert(messageRequest).values({
  createdAt: new Date(), // UTC
});

// 显示：转换为系统时区
const display = formatInTimeZone(createdAt, timezone, "yyyy-MM-dd HH:mm");
```

### 使用 date-fns-tz 进行时区转换

不要手动计算时区偏移，使用专门的库：

```typescript
// 正确
import { toZonedTime, fromZonedTime } from "date-fns-tz";
const local = toZonedTime(utcDate, timezone);

// 错误
const local = new Date(utcDate.getTime() + offset * 60 * 60 * 1000);
```

### 验证用户输入的时区

在保存用户提供的时区前进行验证：

```typescript
import { isValidIANATimezone } from "@/lib/utils/timezone";

if (!isValidIANATimezone(userInput)) {
  throw new Error("无效的时区标识符");
}
```

## 故障排查

### 检查时区配置

通过系统设置页面或 API 检查当前生效的时区：

```typescript
// 获取服务器时区
const timezone = await getServerTimeZone();
console.log("当前系统时区:", timezone);
```

### 验证时区生效

修改时区后，可以通过以下方式验证：

1. 检查排行榜的"今日"数据范围是否正确
2. 验证日志查询的日期边界是否符合预期
3. 确认 Webhook 通知在正确的本地时间发送

### 常见问题

**问题：修改时区后没有立即生效**

系统设置缓存 TTL 为 60 秒。如需立即生效，可重启服务或等待缓存过期。

**问题：前后端时间显示不一致**

确保：

- 前端使用 `useTimeZone()` 获取时区
- 服务端通过 `NextIntlClientProvider` 传递时区
- 前后端使用相同的格式化函数

**问题：每日限额重置时间不正确**

检查：

- 系统时区配置是否正确
- Key 的 `dailyResetTime` 是否设置正确
- 使用的是固定模式还是滚动模式

## 技术依赖

时区处理系统基于以下技术栈：

- **date-fns**：日期操作基础库
- **date-fns-tz**：时区支持扩展
- **next-intl**：国际化和时区上下文
- **Intl.DateTimeFormat**：原生时区验证和格式化

这些依赖确保了时区处理的准确性和跨平台兼容性。
