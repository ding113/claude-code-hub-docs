---
dimensions:
  type:
    primary: getting-started
    detail: settings
  level: beginner
standard_title: 设置概览
language: zh
---

# 设置概览

系统设置模块提供了 Claude Code Hub 的全面配置能力，涵盖供应商管理、价格配置、安全策略、数据维护等核心功能。本页面将帮助您快速了解各设置子模块的作用，以便高效管理您的平台。

---

## 权限说明

{% callout type="warning" title="仅管理员可访问" %}
设置模块仅对具有 **admin** 角色的用户开放。普通用户访问设置页面时将被自动重定向至仪表盘。
{% /callout %}

---

## 设置模块导航

设置页面采用左侧导航栏 + 右侧内容区的布局结构。访问 `/settings` 时会自动跳转到第一个设置子页面（配置页面）。

以下是所有设置子模块的概览：

{% quick-links %}

{% quick-link title="系统配置" icon="presets" href="/docs/guide/settings/config" description="配置站点标题、货币显示、计费模型来源，以及自动清理策略等基础参数。" /%}

{% quick-link title="价格表管理" icon="theming" href="/docs/guide/settings/prices" description="管理 AI 模型的输入/输出 Token 定价，支持从 LiteLLM 同步或手动上传价格数据。" /%}

{% quick-link title="供应商管理" icon="plugins" href="/docs/guide/settings/providers" description="添加、编辑和管理 AI 服务供应商，配置权重、优先级、限流参数和代理设置。" /%}

{% quick-link title="敏感词过滤" icon="warning" href="/docs/guide/settings/sensitive-words" description="设置内容过滤规则，阻止包含敏感词的请求，支持精确匹配和正则表达式。" /%}

{% quick-link title="错误规则" icon="warning" href="/docs/guide/settings/error-rules" description="配置错误分类规则，控制哪些错误应触发重试或熔断器，包含规则测试工具。" /%}

{% quick-link title="客户端版本" icon="installation" href="/docs/guide/settings/client-versions" description="启用客户端版本检查功能，查看版本分布统计，向旧版客户端发送升级提醒。" /%}

{% quick-link title="数据管理" icon="presets" href="/docs/guide/settings/data" description="查看数据库状态、执行日志清理、导出和导入配置数据，进行数据备份与迁移。" /%}

{% quick-link title="日志配置" icon="lightbulb" href="/docs/guide/settings/logs" description="配置系统日志级别，控制日志输出的详细程度以便于调试和监控。" /%}

{% quick-link title="消息推送" icon="plugins" href="/docs/guide/settings/notifications" description="配置 Webhook 通知，包括熔断器告警、每日排行榜推送和成本预警功能。" /%}

{% /quick-links %}

---

## 各模块详细说明

### 系统配置 `/settings/config`

系统配置页面包含两个主要部分：

- **站点参数**：设置站点标题、是否允许全局用量查看、货币显示格式（USD/CNY）、计费模型来源
- **自动清理**：配置请求日志的自动清理策略，包括是否启用自动清理和数据保留天数

### 价格表管理 `/settings/prices`

价格表用于计算每次请求的成本。提供以下功能：

- 分页浏览和搜索模型价格
- 从 LiteLLM 一键同步最新价格数据
- 手动上传自定义价格 JSON 文件
- 编辑单个模型的定价信息

### 供应商管理 `/settings/providers`

这是最核心的设置页面之一，用于管理上游 AI 服务提供商：

- 添加新供应商（支持 Claude、Codex、Gemini、OpenAI Compatible 等类型）
- 配置供应商权重、优先级和分组标签
- 设置限流参数（RPM、并发数、成本系数）
- 配置代理服务器和模型重定向
- 测试供应商连接状态
- 查看供应商健康状态和熔断器状态
- 配置调度规则

### 敏感词过滤 `/settings/sensitive-words`

内容安全过滤功能，用于阻止包含敏感内容的请求：

- 添加敏感词规则
- 支持精确匹配（exact）和正则表达式（regex）两种匹配模式
- 启用/禁用单条规则
- 刷新缓存以立即生效

### 错误规则 `/settings/error-rules`

配置错误处理策略，帮助系统智能处理上游错误：

- 定义错误匹配规则（支持状态码、响应体正则等）
- 设置规则优先级
- 指定错误类别（如 rate_limit、auth_error、server_error 等）
- 控制是否应重试或触发熔断器
- 提供规则测试器验证配置效果

### 客户端版本 `/settings/client-versions`

管理客户端版本检查功能：

- 启用/禁用版本检查功能
- 查看客户端版本分布统计
- 向使用旧版本的用户推送升级提醒

### 数据管理 `/settings/data`

数据库维护和备份恢复功能：

- 查看数据库连接状态和表统计信息
- 手动清理过期日志数据
- 导出配置数据为 JSON 文件
- 导入配置数据（支持覆盖和合并模式）

### 日志配置 `/settings/logs`

配置系统日志输出：

- 设置日志级别（debug、info、warn、error）
- 控制日志详细程度以适应开发或生产环境需求

### 消息推送 `/settings/notifications`

配置外部通知集成（目前支持企业微信机器人 Webhook）：

- **熔断器告警**：当供应商触发熔断时发送通知
- **每日排行榜**：定时推送用户用量排行榜
- **成本预警**：当用户消费达到预设阈值时发送告警

每种通知都支持单独的 Webhook 地址和测试功能。

---

## 外部链接

设置导航栏还包含两个外部链接：

- **API 文档**：打开 Scalar UI 查看完整的 OpenAPI 文档（`/api/actions/scalar`）
- **反馈问题**：跳转到 GitHub Issues 页面提交问题或建议

---

## 下一步

根据您的需求，可以从以下页面开始配置：

1. **首次部署**：建议先完成 [供应商管理](/docs/guide/settings/providers) 添加至少一个可用的 AI 服务供应商
2. **成本控制**：配置 [价格表](/docs/guide/settings/prices) 以准确计算请求成本
3. **安全加固**：设置 [敏感词过滤](/docs/guide/settings/sensitive-words) 规则
4. **运维监控**：配置 [消息推送](/docs/guide/settings/notifications) 接收系统告警
