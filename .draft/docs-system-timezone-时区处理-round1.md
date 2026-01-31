# 时区处理 - Round 1 Exploration Draft

## 1. 概述

claude-code-hub 项目实现了一套完整的时区处理系统，用于统一后端时间边界计算和前端日期/时间显示。该系统基于 IANA 时区数据库标识符（如 "Asia/Shanghai"、"America/New_York"），通过多层配置和智能降级机制，确保在全球分布式部署场景下的时间一致性。

时区处理在以下核心场景中发挥关键作用：
- 配额限流系统的时间窗口计算（5小时/日/周/月）
- 排行榜数据的时区感知统计
- 日志查询的时间范围筛选
- Webhook 通知的定时调度
- 前端界面的本地化时间显示

## 2. 核心时区工具模块

### 2.1 时区工具模块 (`src/lib/utils/timezone.ts`)

这是整个时区系统的核心模块，提供了时区验证、解析和标签生成等功能。

#### 2.1.1 常用时区常量

系统预定义了一组常用 IANA 时区标识符，用于前端下拉选择界面：

```typescript
export const COMMON_TIMEZONES = [
  // UTC
  "UTC",
  // Asia
  "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Asia/Singapore",
  "Asia/Hong_Kong", "Asia/Taipei", "Asia/Bangkok", "Asia/Dubai", "Asia/Kolkata",
  // Europe
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
  "Europe/Amsterdam", "Europe/Rome", "Europe/Madrid",
  // Americas
  "America/New_York", "America/Los_Angeles", "America/Chicago", "America/Denver",
  "America/Toronto", "America/Vancouver", "America/Sao_Paulo", "America/Mexico_City",
  // Pacific
  "Pacific/Auckland", "Pacific/Sydney", "Australia/Melbourne", "Australia/Perth",
] as const;
```

这些时区按地理区域组织，为用户提供更好的选择体验。

#### 2.1.2 时区验证函数

```typescript
export function isValidIANATimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== "string") return false;
  if (timezone === "UTC") return true;
  
  try {
    // Intl.DateTimeFormat will throw if the timezone is invalid
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
```

该函数利用浏览器/Node.js 原生的 `Intl.DateTimeFormat` API 验证时区标识符的有效性。这是验证 IANA 时区的标准方法，确保时区字符串在系统的时区数据库中存在。

#### 2.1.3 时区标签生成

```typescript
export function getTimezoneLabel(timezone: string, locale = "en"): string {
  if (!isValidIANATimezone(timezone)) {
    return timezone;
  }
  
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeZoneName: "longOffset",
    });
    
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    const offset = offsetPart?.value || "";
    
    // Format: "(UTC+08:00) Asia/Shanghai" or "(GMT+08:00) Asia/Shanghai"
    return `(${offset}) ${timezone}`;
  } catch {
    return timezone;
  }
}
```

此函数生成用户友好的时区显示标签，包含 UTC 偏移量和时区名称，例如 "(UTC+08:00) Asia/Shanghai"。这在设置界面的下拉选择中为用户提供直观的时区信息。

#### 2.1.4 系统时区解析器

这是时区系统最关键的功能——三层降级时区解析：

```typescript
export async function resolveSystemTimezone(): Promise<string> {
  // Step 1: Try DB timezone from cached system settings
  try {
    const settings = await getCachedSystemSettings();
    if (settings.timezone && isValidIANATimezone(settings.timezone)) {
      return settings.timezone;
    }
  } catch (error) {
    logger.warn("[TimezoneResolver] Failed to read cached system settings", { error });
  }
  
  // Step 2: Fallback to env TZ
  try {
    const { TZ } = getEnvConfig();
    if (TZ && isValidIANATimezone(TZ)) {
      return TZ;
    }
  } catch (error) {
    logger.warn("[TimezoneResolver] Failed to read env TZ", { error });
  }
  
  // Step 3: Ultimate fallback
  return "UTC";
}
```

解析器实现了以下降级链：
1. **数据库配置**：从 `system_settings.timezone` 读取（通过缓存层）
2. **环境变量**：从 `TZ` 环境变量读取
3. **终极回退**：返回 "UTC"

每个候选时区都经过 `isValidIANATimezone` 验证，确保返回的时区始终有效。

### 2.2 日期输入解析 (`src/lib/utils/date-input.ts`)

该模块处理用户输入的日期字符串，将其转换为 UTC 时间戳，同时考虑指定时区：

```typescript
export function parseDateInputAsTimezone(input: string, timezone: string): Date {
  if (!input) {
    throw new Error("Invalid date input: empty string");
  }
  
  // Date-only format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    // Parse as end-of-day (23:59:59) in the given timezone
    const localDateTime = parse(`${input} 23:59:59`, "yyyy-MM-dd HH:mm:ss", new Date());
    
    if (Number.isNaN(localDateTime.getTime())) {
      throw new Error(`Invalid date input: ${input}`);
    }
    
    // Convert from timezone local time to UTC
    return fromZonedTime(localDateTime, timezone);
  }
  
  // Check if input has timezone designator (Z or +-HH:MM offset)
  const hasTimezoneDesignator = /([zZ]|[+-]\d{2}:?\d{2})$/.test(input);
  if (hasTimezoneDesignator) {
    const directDate = new Date(input);
    if (Number.isNaN(directDate.getTime())) {
      throw new Error(`Invalid date input: ${input}`);
    }
    return directDate;
  }
  
  // ISO datetime without timezone: parse and treat as timezone local time
  const localDate = new Date(input);
  if (Number.isNaN(localDate.getTime())) {
    throw new Error(`Invalid date input: ${input}`);
  }
  
  // Convert from timezone local time to UTC
  return fromZonedTime(localDate, timezone);
}
```

该函数支持三种输入格式：
- **日期格式**（YYYY-MM-DD）：解析为该时区的当天结束时间（23:59:59）
- **带时区标识符的 ISO 时间**：直接解析为绝对时间点
- **无时区的 ISO 时间**：将其视为指定时区的本地时间，然后转换为 UTC

## 3. 时区配置系统

### 3.1 数据库配置

时区配置存储在 `system_settings` 表中：

```typescript
// src/types/system-config.ts
export interface SystemSettings {
  // ... other fields
  
  // 系统时区配置 (IANA timezone identifier)
  // 用于统一后端时间边界计算和前端日期/时间显示
  // null 表示使用环境变量 TZ 或默认 UTC
  timezone: string | null;
  
  // ... other fields
}
```

数据库迁移脚本：

```sql
-- drizzle/0048_add_system_timezone.sql
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "timezone" varchar(64);
```

### 3.2 环境变量配置

在 `src/lib/config/env.schema.ts` 中定义：

```typescript
TZ: z.string().default("Asia/Shanghai"),
```

默认值为 "Asia/Shanghai"，确保未配置时的合理默认值。

### 3.3 系统设置缓存

为避免每次请求都查询数据库，系统实现了内存缓存：

```typescript
// src/lib/config/system-settings-cache.ts
const CACHE_TTL_MS = 60 * 1000; // 1 minute

let cachedSettings: SystemSettings | null = null;
let cachedAt: number = 0;

export async function getCachedSystemSettings(): Promise<SystemSettings> {
  const now = Date.now();
  
  // Return cached if still valid
  if (cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }
  
  try {
    const settings = await getSystemSettings();
    cachedSettings = settings;
    cachedAt = now;
    return settings;
  } catch (error) {
    // Fail-open: return previous cached value or defaults
    if (cachedSettings) {
      return cachedSettings;
    }
    return createFallbackSettings();
  }
}
```

缓存特性：
- **TTL**：60 秒
- **懒加载**：首次访问时加载
- **手动失效**：设置保存时清除缓存
- **故障开放**：出错时返回缓存值或默认值

### 3.4 前端配置界面

系统设置表单提供时区选择功能：

```typescript
// src/app/[locale]/settings/config/_components/system-settings-form.tsx
<div className="space-y-2">
  <Label htmlFor="timezone">
    <Globe className="h-4 w-4" />
    {t("timezoneLabel")}
  </Label>
  <Select
    value={timezone ?? "__auto__"}
    onValueChange={(value) => setTimezone(value === "__auto__" ? null : value)}
  >
    <SelectContent>
      <SelectItem value="__auto__">{t("timezoneAuto")}</SelectItem>
      {COMMON_TIMEZONES.map((tz) => (
        <SelectItem key={tz} value={tz}>
          {getTimezoneLabel(tz)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  <p className="text-xs text-muted-foreground">{t("timezoneDescription")}</p>
</div>
```

用户可以选择：
- **自动模式**：使用环境变量 TZ
- **特定时区**：从预定义列表中选择

## 4. 时间窗口计算与限流系统

### 4.1 时间工具模块 (`src/lib/rate-limit/time-utils.ts`)

这是限流系统的核心时区处理模块，负责计算各种时间窗口的范围和 TTL。

#### 4.1.1 时间周期类型

```typescript
export type TimePeriod = "5h" | "daily" | "weekly" | "monthly";
export type DailyResetMode = "fixed" | "rolling";

export interface TimeRange {
  startTime: Date;
  endTime: Date;
}

export interface ResetInfo {
  type: "rolling" | "natural" | "custom";
  resetAt?: Date;
  period?: string;
}
```

#### 4.1.2 周期时间范围计算

```typescript
export async function getTimeRangeForPeriod(
  period: TimePeriod,
  resetTime = "00:00"
): Promise<TimeRange> {
  const timezone = await resolveSystemTimezone();
  const normalizedResetTime = normalizeResetTime(resetTime);
  const now = new Date();
  const endTime = now;
  let startTime: Date;
  
  switch (period) {
    case "5h":
      // 滚动窗口：过去 5 小时
      startTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      break;
    
    case "daily": {
      // 自定义每日重置时间（例如：18:00）
      startTime = getCustomDailyResetTime(now, normalizedResetTime, timezone);
      break;
    }
    
    case "weekly": {
      // 自然周：本周一 00:00 (系统时区)
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 }); // 周一
      startTime = fromZonedTime(zonedStartOfWeek, timezone);
      break;
    }
    
    case "monthly": {
      // 自然月：本月 1 号 00:00 (系统时区)
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfMonth = startOfMonth(zonedNow);
      startTime = fromZonedTime(zonedStartOfMonth, timezone);
      break;
    }
  }
  
  return { startTime, endTime };
}
```

关键时区处理逻辑：
- **5小时窗口**：使用 UTC 时间滚动计算，不受时区影响
- **每日窗口**：支持自定义重置时间，基于系统时区计算
- **每周窗口**：计算本周一 00:00（系统时区），使用 `toZonedTime` 和 `fromZonedTime` 进行时区转换
- **每月窗口**：计算本月1号 00:00（系统时区）

#### 4.1.3 时区转换原理

```typescript
// 每周窗口计算示例
const zonedNow = toZonedTime(now, timezone);           // UTC -> 系统时区本地时间
const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 }); // 获取周一
startTime = fromZonedTime(zonedStartOfWeek, timezone); // 系统时区 -> UTC
```

使用 `date-fns-tz` 库的转换流程：
1. `toZonedTime(utcDate, timezone)`：将 UTC 时间转换为指定时区的本地时间表示
2. 在本地时间上进行日期计算（如获取周一、月初）
3. `fromZonedTime(localDate, timezone)`：将本地时间转换回 UTC 时间戳

这确保了"周一 00:00"是基于系统配置的时区，而非服务器本地时区。

#### 4.1.4 支持滚动窗口模式

```typescript
export async function getTimeRangeForPeriodWithMode(
  period: TimePeriod,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): Promise<TimeRange> {
  if (period === "daily" && mode === "rolling") {
    // 滚动窗口：过去 24 小时
    const now = new Date();
    return {
      startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endTime: now,
    };
  }
  
  // 其他情况使用原有逻辑
  return getTimeRangeForPeriod(period, resetTime);
}
```

每日限额支持两种模式：
- **Fixed（固定）**：在指定时间重置（如每天 08:00）
- **Rolling（滚动）**：过去 24 小时滚动窗口

#### 4.1.5 TTL 计算

```typescript
export async function getTTLForPeriod(period: TimePeriod, resetTime = "00:00"): Promise<number> {
  const timezone = await resolveSystemTimezone();
  const now = new Date();
  const normalizedResetTime = normalizeResetTime(resetTime);
  
  switch (period) {
    case "5h":
      return 5 * 3600;
    
    case "daily": {
      const nextReset = getNextDailyResetTime(now, normalizedResetTime, timezone);
      return Math.max(1, Math.ceil((nextReset.getTime() - now.getTime()) / 1000));
    }
    
    case "weekly": {
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });
      const zonedNextWeek = addWeeks(zonedStartOfWeek, 1);
      const nextWeek = fromZonedTime(zonedNextWeek, timezone);
      return Math.ceil((nextWeek.getTime() - now.getTime()) / 1000);
    }
    
    case "monthly": {
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfMonth = startOfMonth(zonedNow);
      const zonedNextMonth = addMonths(zonedStartOfMonth, 1);
      const nextMonth = fromZonedTime(zonedNextMonth, timezone);
      return Math.ceil((nextMonth.getTime() - now.getTime()) / 1000);
    }
  }
}
```

TTL 计算用于设置 Redis Key 的过期时间，确保缓存数据在正确的时间点失效。

### 4.2 配额租约系统

配额租约系统使用时区感知的时间窗口来减少数据库查询压力：

```typescript
// src/lib/rate-limit/lease.ts
export async function getLeaseTimeRange(
  window: LeaseWindowType,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): Promise<{ startTime: Date; endTime: Date }> {
  return getTimeRangeForPeriodWithMode(window as TimePeriod, resetTime, mode);
}

export async function getLeaseTtlSeconds(
  window: LeaseWindowType,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): Promise<number> {
  return getTTLForPeriodWithMode(window as TimePeriod, resetTime, mode);
}
```

租约系统通过时区感知的时间范围计算，确保：
- 租约 TTL 与限额重置时间对齐
- 跨时区部署时限额计算一致

## 5. 前端时区处理

### 5.1 Next-Intl 时区配置

项目使用 next-intl 进行国际化，时区配置在请求级别设置：

```typescript
// src/i18n/request.ts
export default getRequestConfig(async ({ requestLocale }) => {
  // ... locale resolution
  
  const messages = await import(`../../messages/${locale}`).then((module) => module.default);
  const timeZone = await resolveSystemTimezone();
  
  return {
    locale,
    messages,
    timeZone,
    now: new Date(),
    // ...
  };
});
```

```typescript
// src/app/[locale]/layout.tsx
export default async function LocaleLayout({ params, children }) {
  // ...
  const timeZone = await resolveSystemTimezone();
  const now = new Date();
  
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages} timeZone={timeZone} now={now}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

### 5.2 相对时间组件

```typescript
// src/components/ui/relative-time.tsx
export function RelativeTime({ date, className, fallback = "—", autoUpdate = true }: RelativeTimeProps) {
  const locale = useLocale();
  const timeZone = useTimeZone() ?? "UTC";
  
  // Precompute an absolute timestamp string for tooltip content
  const absolute = useMemo(() => {
    if (!date) return fallback;
    const dateObj = typeof date === "string" ? new Date(date) : date;
    if (Number.isNaN(dateObj.getTime())) return fallback;
    // Use system timezone from next-intl for consistent display
    return formatInTimeZone(dateObj, timeZone, "yyyy-MM-dd HH:mm:ss OOOO");
  }, [date, fallback, timeZone]);
  
  // ... render relative time with tooltip showing absolute time
}
```

该组件：
- 使用 `useTimeZone()` 获取系统配置的时区
- 使用 `formatInTimeZone` 格式化绝对时间显示
- 解决 Next.js SSR Hydration 错误

### 5.3 日志时间筛选

```typescript
// src/app/[locale]/dashboard/logs/_components/filters/time-filters.tsx
export function TimeFilters({ filters, onFiltersChange, serverTimeZone }: TimeFiltersProps) {
  const timestampToDateString = useCallback(
    (timestamp: number): string => {
      const date = new Date(timestamp);
      if (serverTimeZone) {
        return formatInTimeZone(date, serverTimeZone, "yyyy-MM-dd");
      }
      return format(date, "yyyy-MM-dd");
    },
    [serverTimeZone]
  );
  
  // ...
}
```

日志筛选组件接收服务器时区，确保：
- 日期选择器显示与服务器一致的日期
- 时间戳正确转换为日期字符串

### 5.4 时间范围工具

```typescript
// src/app/[locale]/dashboard/logs/_utils/time-range.ts
export function formatClockFromTimestamp(timestamp: number, timeZone?: string): string {
  const baseDate = new Date(timestamp);
  const date = timeZone ? toZonedTime(baseDate, timeZone) : baseDate;
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function getQuickDateRange(
  period: QuickPeriod,
  timeZone?: string,
  now: Date = new Date()
): { startDate: string; endDate: string } {
  const baseDate = timeZone ? toZonedTime(now, timeZone) : now;
  switch (period) {
    case "today":
      return {
        startDate: formatDateInTimeZone(baseDate, timeZone),
        endDate: formatDateInTimeZone(baseDate, timeZone),
      };
    case "yesterday": {
      const yesterday = subDays(baseDate, 1);
      return {
        startDate: formatDateInTimeZone(yesterday, timeZone),
        endDate: formatDateInTimeZone(yesterday, timeZone),
      };
    }
    // ...
  }
}
```

## 6. 排行榜与统计

### 6.1 时区感知的排行榜查询

```typescript
// src/repository/leaderboard.ts
export async function findDailyLeaderboard(
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("daily", timezone, undefined, userFilters);
}

export async function findWeeklyLeaderboard(
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("weekly", timezone, undefined, userFilters);
}

export async function findMonthlyLeaderboard(
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("monthly", timezone, undefined, userFilters);
}
```

所有排行榜查询都使用时区参数，确保"今日"、"本周"、"本月"基于系统配置的时区计算。

### 6.2 SQL 时区转换

```typescript
async function findLeaderboardWithTimezone(
  period: LeaderboardPeriod,
  timezone: string,
  dateRange?: DateRangeParams,
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const whereConditions = [
    isNull(messageRequest.deletedAt),
    EXCLUDE_WARMUP_CONDITION,
    buildDateCondition(period, timezone, dateRange),
  ];
  
  // ... query execution
}
```

在 SQL 查询中使用 `AT TIME ZONE` 进行时区转换，确保数据库层面的时间计算与应用程序一致。

### 6.3 每日排行榜通知

```typescript
// src/lib/notification/tasks/daily-leaderboard.ts
export async function generateDailyLeaderboard(topN: number): Promise<DailyLeaderboardData | null> {
  // 获取过去24小时排行榜
  const leaderboard = await findLast24HoursLeaderboard();
  
  // ...
  
  // 格式化日期 (YYYY-MM-DD) 使用系统时区
  const today = new Date();
  const timezone = await resolveSystemTimezone();
  const dateStr = today
    .toLocaleDateString("zh-CN", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\//g, "-");
  
  return {
    date: dateStr,
    entries: topEntries.map((entry) => ({...})),
    totalRequests,
    totalCost,
  };
}
```

每日排行榜通知使用时区格式化日期，确保通知中的日期与系统时区一致。

## 7. Webhook 通知调度

### 7.1 通知队列时区支持

```typescript
// src/lib/notification/notification-queue.ts
export async function scheduleNotificationJobs(): Promise<void> {
  const systemTimezone = await resolveSystemTimezone();
  
  // ...
  
  if (settings.dailyLeaderboardEnabled) {
    const bindings = await getEnabledBindingsByType("daily_leaderboard");
    const [hour, minute] = (settings.dailyLeaderboardTime ?? "09:00").split(":").map(Number);
    const defaultCron = `${minute} ${hour} * * *`;
    
    for (const binding of bindings) {
      const cron = binding.scheduleCron ?? defaultCron;
      const tz = binding.scheduleTimezone ?? systemTimezone;
      
      await queue.add(
        { type: "daily-leaderboard", targetId: binding.targetId, bindingId: binding.id },
        { repeat: { cron, tz }, jobId: `daily-leaderboard:${binding.id}` }
      );
    }
  }
}
```

通知调度支持：
- 系统级默认时区
- 绑定级自定义时区
- Cron 表达式基于指定时区执行

### 7.2 Webhook 日期格式化

```typescript
// src/lib/webhook/utils/date.ts
export function formatDateTime(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, timezone, "yyyy/MM/dd HH:mm:ss");
}
```

Webhook 消息中的日期使用系统时区格式化，确保一致性。

## 8. 日期格式化工具

### 8.1 多语言日期格式化

```typescript
// src/lib/utils/date-format.ts
const LOCALE_MAP: Record<string, Locale> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en: enUS,
  ru: ru,
  ja: ja,
};

export function formatDate(
  date: Date | number | string,
  formatString: string,
  locale: string = "zh-CN",
  timezone?: string
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const dateFnsLocale = getDateFnsLocale(locale);
  
  if (timezone) {
    return formatInTimeZone(dateObj, timezone, formatString, {
      locale: dateFnsLocale,
    });
  }
  
  return format(dateObj, formatString, { locale: dateFnsLocale });
}
```

支持：
- 多语言本地化（中文、英文、俄文、日文）
- 可选时区格式化
- 灵活的格式字符串

### 8.2 日期格式常量

```typescript
export const DATE_FORMATS = {
  "zh-CN": {
    short: "yyyy-MM-dd",
    medium: "yyyy年MM月dd日",
    long: "yyyy年MM月dd日 HH:mm:ss",
    time: "HH:mm:ss",
    monthDay: "MM月dd日",
  },
  "zh-TW": {
    short: "yyyy-MM-dd",
    medium: "yyyy年MM月dd日",
    long: "yyyy年MM月dd日 HH:mm:ss",
    time: "HH:mm:ss",
    monthDay: "MM月dd日",
  },
  en: {
    short: "MM/dd/yyyy",
    medium: "MMM dd, yyyy",
    long: "MMMM dd, yyyy HH:mm:ss",
    time: "HH:mm:ss",
    monthDay: "MMM dd",
  },
  // ...
} as const;
```

## 9. 测试覆盖

### 9.1 时区解析器测试

```typescript
// tests/unit/lib/timezone/timezone-resolver.test.ts
describe("resolveSystemTimezone", () => {
  it("should return DB timezone when set and valid", async () => {
    getCachedSystemSettingsMock.mockResolvedValue(
      createSettings({ timezone: "America/New_York" })
    );
    mockEnvConfig("Asia/Shanghai");
    
    const result = await resolveSystemTimezone();
    expect(result).toBe("America/New_York");
  });
  
  it("should fallback to env TZ when DB timezone is null", async () => {
    getCachedSystemSettingsMock.mockResolvedValue(createSettings({ timezone: null }));
    mockEnvConfig("Europe/London");
    
    const result = await resolveSystemTimezone();
    expect(result).toBe("Europe/London");
  });
  
  it("should fallback to UTC when both DB timezone and env TZ are invalid", async () => {
    getCachedSystemSettingsMock.mockResolvedValue(createSettings({ timezone: "Invalid/Zone" }));
    mockEnvConfig("");
    
    const result = await resolveSystemTimezone();
    expect(result).toBe("UTC");
  });
});
```

### 9.2 时区感知的时间范围测试

```typescript
// tests/unit/lib/rate-limit/lease.test.ts
describe("getLeaseTimeRange timezone behavior", () => {
  it("should use configured timezone for daily fixed window", async () => {
    // 2024-01-15 02:00:00 UTC = 2024-01-15 10:00:00 Shanghai
    const utcTime = new Date("2024-01-15T02:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");
    
    // Reset at 08:00 Shanghai, we've passed it
    const range = await getLeaseTimeRange("daily", "08:00", "fixed");
    
    // Window starts at 08:00 Shanghai = 00:00 UTC
    expect(range.startTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
    expect(range.endTime.toISOString()).toBe("2024-01-15T02:00:00.000Z");
  });
});
```

### 9.3 日期格式化时区测试

```typescript
// tests/unit/lib/date-format-timezone.test.ts
describe("formatDate with timezone parameter", () => {
  const utcDate = new Date("2025-01-15T23:30:00Z");
  
  it("formats date in Asia/Shanghai timezone (UTC+8)", () => {
    // 2025-01-15T23:30:00Z => 2025-01-16T07:30:00 in Asia/Shanghai
    const result = formatDate(utcDate, "yyyy-MM-dd HH:mm", "en", "Asia/Shanghai");
    expect(result).toBe("2025-01-16 07:30");
  });
  
  it("formats date in America/New_York timezone (UTC-5 in January)", () => {
    // 2025-01-15T23:30:00Z => 2025-01-15T18:30:00 in America/New_York (EST)
    const result = formatDate(utcDate, "yyyy-MM-dd HH:mm", "en", "America/New_York");
    expect(result).toBe("2025-01-15 18:30");
  });
});
```

## 10. 架构设计要点

### 10.1 三层降级策略

系统采用三层降级策略确保时区配置始终可用：

1. **数据库层**：管理员通过 UI 配置的时区，存储在 `system_settings` 表
2. **环境层**：部署时通过 `TZ` 环境变量设置
3. **默认层**：终极回退到 UTC

这种设计确保：
- 运行时可通过 UI 动态调整时区
- 首次部署或数据库不可用时使用环境变量
- 任何情况下都有有效的时区配置

### 10.2 缓存策略

时区解析使用两层缓存：

1. **系统设置缓存**：60 秒 TTL，避免频繁查询数据库
2. **Node.js Intl 缓存**：`Intl.DateTimeFormat` 内部缓存时区数据

### 10.3 前后端一致性

确保前后端时间显示一致的关键设计：

1. **服务端渲染时注入**：通过 `NextIntlClientProvider` 将时区传递到前端
2. **统一工具函数**：前后端共用 `date-fns-tz` 进行格式化
3. **服务器时区 API**：提供 `getServerTimeZone` action 供客户端获取

### 10.4 时区转换模式

系统使用标准的时区转换模式：

```
UTC 时间戳 -> toZonedTime -> 本地时间计算 -> fromZonedTime -> UTC 时间戳
```

这种模式确保：
- 所有数据库存储都是 UTC 时间戳
- 时间窗口边界基于配置时区的本地时间
- 计算结果可重现且一致

## 11. 使用场景示例

### 11.1 场景一：跨时区团队使用

假设团队在东京（JST）和纽约（EST）两地：
- 系统配置为 `America/New_York`
- 东京用户看到的"今日"从 JST 09:00 开始（对应 EST 00:00）
- 两地用户的"每日限额"在同一时刻重置

### 11.2 场景二：自定义每日重置时间

某公司希望每日限额在早上 8 点重置：
- 系统时区：`Asia/Shanghai`
- Key 配置：`dailyResetTime = "08:00"`
- 每天北京时间 08:00，限额自动重置

### 11.3 场景三：滚动窗口模式

对于需要严格 24 小时滑动窗口的场景：
- 配置 `dailyResetMode = "rolling"`
- 限额基于过去 24 小时滚动计算
- 不受时区设置影响

## 12. 技术依赖

### 12.1 核心依赖

- **date-fns**: ^4 - 日期操作基础库
- **date-fns-tz**: ^3 - 时区支持扩展
- **next-intl**: ^4 - 国际化和时区上下文

### 12.2 浏览器/Node.js API

- **Intl.DateTimeFormat**: 原生时区验证和格式化
- **Intl.DateTimeFormat.prototype.formatToParts**: 提取时区偏移量

## 13. 最佳实践总结

1. **始终使用 `resolveSystemTimezone()`**：不要直接读取环境变量或数据库
2. **数据库存储 UTC**：所有时间戳以 UTC 存储，仅在显示时转换
3. **使用 `date-fns-tz` 进行转换**：不要手动计算时区偏移
4. **验证用户输入的时区**：使用 `isValidIANATimezone()` 验证
5. **考虑缓存影响**：修改时区后最多 60 秒生效（缓存 TTL）
6. **测试跨时区场景**：使用固定时间戳测试不同时区的行为

## 14. 待深入探索的问题

1. 夏令时（DST）转换期间的行为
2. 多时区部署场景下的数据一致性
3. 历史数据查询的时区处理
4. 与其他第三方服务（如 Stripe）的时区协调
5. 性能优化：Intl API 的缓存策略

---

*文档生成时间：2026-01-29*
*基于 claude-code-hub 项目代码分析*
