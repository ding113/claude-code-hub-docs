---
dimensions:
  type:
    primary: getting-started
    detail: settings
  level: intermediate
standard_title: 消息推送
language: zh
---

# 消息推送

消息推送（Notifications）用于把 Claude Code Hub 的关键事件通过机器人/Webhook 推送到团队协作工具，帮助团队及时发现异常、回顾用量与控制成本。

当前版本内置多平台渲染器与多目标推送体系，支持：

- 企业微信（WeChat Work）
- 飞书（Feishu / Lark）
- 钉钉（DingTalk）
- Telegram（Bot API）
- 自定义 Webhook（JSON 模板 + 占位符变量）

{% callout type="note" title="访问权限" %}
消息推送配置页面仅对管理员开放（`admin`）。普通用户将被自动重定向到仪表盘首页。
{% /callout %}

{% callout type="warning" title="运行环境与依赖" %}
消息推送依赖 **Redis + Bull Queue**（用于调度定时任务与异步发送），因此：

- **生产环境**：只要配置了 `REDIS_URL` 且 Redis 可用，定时任务（排行榜/成本预警）会按计划触发，熔断器告警也会在事件发生时异步推送。
- **开发环境**：由于 Bull 与 Turbopack 在开发模式下不兼容，系统会禁用通知队列；此时不会自动调度/发送通知。你仍可以使用 Target 的「测试」按钮验证连通性与渲染效果。
{% /callout %}

---

## 页面结构

消息推送页面（`/settings/notifications`）由三部分组成：

1. **通知总开关**：控制整个通知系统是否启用
2. **推送目标（Targets）**：维护“要推送到哪里”（平台类型、URL/凭据、代理等）
3. **通知类型（Bindings）**：维护“推送什么、推送给哪些 Targets”（并可对每个绑定做高级配置）

---

## 核心概念：Targets 与 Bindings

### 推送目标（Targets）

Target 表示一个“具体的推送目的地”。例如：

- 一个企业微信群机器人
- 一个飞书群机器人
- 一个钉钉机器人（可选签名密钥）
- 一个 Telegram Bot + Chat
- 一个自定义 Webhook URL（你自己控制的接收端）

每个 Target 还支持：

- **启用/禁用**：禁用后即使绑定了也不会推送
- **测试**：可发送测试消息并记录最近一次测试结果/耗时
- **代理发送（可选）**：为该 Target 单独配置 HTTP/SOCKS 代理，并可设置失败时是否回退直连

### 通知绑定（Bindings）

Binding 表示“某一类通知要推送到哪些 Targets”。同一类通知可以绑定多个 Targets，实现多平台同时推送。

每个绑定支持：

- **启用/禁用**：只禁用该类型对该 Target 的推送，不影响 Target 本身
- **高级配置**：
  - `scheduleCron` / `scheduleTimezone`：用于定时类通知的覆盖（详见下文）
  - `templateOverride`：仅对 **自定义 Webhook** 生效，用于覆盖该绑定的模板

---

## 推荐配置流程

1. 在「推送目标」中先创建 1 个或多个 Target（建议先创建一个用于测试的群机器人）
2. 打开「通知总开关」
3. 在每个「通知类型」卡片中：
   - 打开该类型通知开关
   - 选择要绑定的 Targets
   - 如有需要，配置定时参数（排行榜/成本预警）与高级配置
   - 点击「保存绑定」

{% callout type="note" title="哪些配置需要“保存”？" %}
通知总开关与各通知类型的参数（如发送时间、Top N、阈值等）会在界面操作时即时保存；Target 的新增/编辑也会即时保存。

只有“绑定列表（Bindings）”需要点击「保存绑定」按钮提交。
{% /callout %}

---

## 通知类型说明

### 熔断器告警（circuit_breaker）

当某个供应商触发熔断保护（进入 OPEN 状态）时，系统会发送告警消息，便于管理员快速定位供应商故障/限流/鉴权异常等问题。

实现特性（与系统实现一致）：

- **多目标推送**：可同时绑定多个 Targets
- **重复告警抑制**：在 Redis 可用时，同一供应商 5 分钟内不会重复推送同类告警
- **无需定时配置**：该通知为事件触发型，不依赖 Cron

### 每日排行榜（daily_leaderboard）

每日排行榜会在指定时间生成“昨日用量 Top N”并推送，适用于团队用量回顾与成本分摊参考。

可配置项（界面字段）：

- 发送时间（`HH:mm`，默认 `09:00`）
- Top N（1–20，默认 5）

调度规则（默认行为）：

- 默认使用系统设置的发送时间生成每日 Cron
- 默认时区：`Asia/Shanghai`

高级配置：

- 在绑定的高级配置中可设置 `scheduleCron` / `scheduleTimezone` 覆盖默认调度（对每个 Target 单独生效）

### 成本预警（cost_alert）

成本预警会按固定间隔扫描用户/供应商的消费情况，当达到阈值时推送提醒。

可配置项（界面字段）：

- 阈值（50%–100%，默认 80%）
- 检查间隔（分钟，10–1440，默认 60）

调度规则（默认行为）：

- 默认按 `*/{interval} * * * *` 调度
- 默认时区：`Asia/Shanghai`

高级配置：

- 在绑定的高级配置中可设置 `scheduleCron` / `scheduleTimezone` 覆盖默认调度（对每个 Target 单独生效）

---

## 推送目标类型与参数

### 企业微信（wechat）

- 必填：Webhook URL（企业微信群机器人提供）
- 发送格式：企业微信 markdown 消息
- 成功判定：企业微信返回 `errcode: 0` 视为成功，否则按重试策略处理

### 飞书（feishu）

- 必填：Webhook URL（飞书群机器人提供）
- 发送格式：飞书交互式卡片（Interactive Card）
- 成功判定：飞书返回 `code: 0` 视为成功

### 钉钉（dingtalk）

- 必填：Webhook URL（钉钉群机器人提供）
- 可选：签名密钥（Secret）
  - 若配置 Secret，系统会按钉钉签名规则为请求 URL 自动附加 `timestamp` 与 `sign` 参数
- 发送格式：钉钉 markdown 消息
- 成功判定：钉钉返回 `errcode: 0` 视为成功

### Telegram（telegram）

Telegram 不使用群机器人 webhook URL，而是通过 Bot API 发送消息：

- 必填：Bot Token
- 必填：Chat ID
- 发送接口：`sendMessage`
- 文本格式：HTML（`parse_mode=HTML`），并默认关闭网页预览

### 自定义 Webhook（custom）

当你需要对接任意平台（例如 Teams、Slack、自建告警系统）或希望完全控制请求体结构时，可以使用 Custom 类型：

- 必填：Webhook URL
- 必填：JSON 模板（必须是 JSON 对象）
- 可选：自定义 Headers（JSON 对象，value 必须是 string）

成功判定：

- Custom Webhook 只要求 HTTP 状态码为 2xx；响应体不会被解析或校验。

---

## 自定义模板与占位符（Custom）

自定义 Webhook 的请求体由“模板 JSON”渲染得到，模板中的占位符会被替换为实际数据。

### 占位符分类

- 通用占位符：`{{title}}`、`{{timestamp}}`、`{{timestamp_local}}`、`{{level}}`、`{{sections}}` 等
- 类型占位符：
  - 熔断器：`{{provider_name}}`、`{{provider_id}}`、`{{failure_count}}`、`{{retry_at}}`…
  - 排行榜：`{{date}}`、`{{entries_json}}`、`{{total_requests}}`、`{{total_cost}}`…
  - 成本预警：`{{target_type}}`、`{{target_name}}`、`{{current_cost}}`、`{{quota_limit}}`、`{{usage_percent}}`…

{% callout type="note" title="不需要记忆占位符" %}
在管理后台中编辑模板时，右侧会列出当前通知类型可用的占位符，并支持一键插入。
{% /callout %}

### 模板覆盖（Binding 级别）

Custom Target 支持两级模板：

- **Target 级模板**：该 Target 的默认模板
- **Binding 级模板覆盖**：仅对某一种通知类型 + 某一个 Target 生效，用于做差异化渲染

---

## 升级迁移（旧版单 Webhook 模式）

早期版本曾使用“每个通知类型配置一个 webhook URL”的旧模式（legacy mode）。升级到新版本后：

- 系统默认使用 **Targets + Bindings** 新模式
- 如果检测到旧配置，仪表盘会出现迁移向导，帮助你一键将旧 URL 迁移为新的 Targets 与 Bindings

迁移完成后，统一在 `/settings/notifications` 页面维护所有推送配置即可。
