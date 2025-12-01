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

消息推送功能允许管理员配置 Webhook 通知，将系统关键事件实时推送到企业微信等即时通讯工具，帮助团队及时响应异常情况和了解使用状况。

{% callout type="note" title="访问权限" %}
消息推送配置页面仅对管理员开放。普通用户将被自动重定向到仪表盘首页。
{% /callout %}

---

## 页面入口

在管理后台侧边栏中，点击「设置」，然后选择左侧导航栏中的「消息推送」菜单项即可进入配置页面。

---

## 功能概述

Claude Code Hub 支持三种类型的消息推送通知：

| 通知类型 | 触发时机 | 用途 |
|----------|----------|------|
| **熔断器告警** | 供应商触发熔断保护时 | 及时发现供应商异常，快速响应 |
| **每日排行榜** | 每天定时推送 | 了解团队用量分布，便于成本分摊 |
| **成本预警** | 用户消费达到配额阈值时 | 预防超额消费，控制成本 |

每种通知支持独立的 Webhook 地址配置和测试功能。

---

## 全局开关

页面顶部的「通知总开关」控制整个消息推送系统的启用状态。

- **开启**：各类通知按其独立配置正常运行
- **关闭**：所有消息推送功能暂停，已配置的定时任务将被移除

{% callout type="warning" title="保存生效" %}
修改任何配置后，必须点击页面底部的「保存设置」按钮才能生效。系统会自动重新调度所有定时任务。
{% /callout %}

---

## 熔断器告警

当供应商因连续错误触发熔断器进入 OPEN 状态时，系统会立即发送告警消息。

### 配置项

| 配置项 | 说明 |
|--------|------|
| **启用熔断器告警** | 是否开启此类通知 |
| **Webhook URL** | 企业微信机器人 Webhook 地址 |

### 推送内容示例

```markdown
## 供应商熔断告警

> 供应商 **Anthropic 官方** (ID: 1) 已触发熔断保护

**详细信息**
失败次数: 5 次
预计恢复: 2025-01-15 14:30:00
最后错误: `rate_limit_exceeded: You have exceeded your rate limit`

---
2025-01-15 14:00:00 · 熔断器将在预计时间后自动恢复
```

### 使用场景

- 供应商 API 出现故障或限流
- 网络连接问题导致连续请求失败
- API Key 额度耗尽或过期

---

## 每日排行榜

系统在每天指定时间自动统计前一天的用户消费数据，并推送 Top N 排行榜。

### 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **启用每日排行榜** | 是否开启此类通知 | 关闭 |
| **Webhook URL** | 企业微信机器人 Webhook 地址 | - |
| **发送时间** | 每天推送的时间点（HH:mm 格式） | 09:00 |
| **显示前 N 名** | 排行榜展示的用户数量（1-20） | 5 |

### 推送内容示例

```markdown
## 今日用户消费排行榜

> 统计日期: **2025-01-14**

**排名情况**

🥇 **张三** (ID: 1)
消费 $12.3456 · 请求 1,234 次 · Token 2.45M

🥈 **李四** (ID: 2)
消费 $8.7654 · 请求 987 次 · Token 1.87M

🥉 **王五** (ID: 3)
消费 $5.4321 · 请求 654 次 · Token 1.23M

---
**今日总览**
总请求 5,678 次 · 总消费 $45.6789

2025-01-15 09:00:00
```

### 使用场景

- 团队每日用量回顾
- 成本分摊参考
- 使用情况监控

---

## 成本预警

当用户或供应商的消费金额达到配置的配额百分比阈值时，系统会发送预警通知。

### 配置项

| 配置项 | 说明 | 默认值 | 范围 |
|--------|------|--------|------|
| **启用成本预警** | 是否开启此类通知 | 关闭 | - |
| **Webhook URL** | 企业微信机器人 Webhook 地址 | - | - |
| **预警阈值** | 触发告警的配额使用百分比 | 80% | 50%-100% |
| **检查间隔** | 系统检查消费情况的频率（分钟） | 60 | 10-1440 |

### 推送内容示例

```markdown
## 成本预警提醒

> 用户 **张三** 的消费已达到预警阈值

**消费详情**
当前消费: $8.5000
配额限制: $10.0000
使用比例: **85.0%** 🟡
剩余额度: $1.5000
统计周期: 本周

---
2025-01-15 10:30:00 · 请注意控制消费
```

### 使用场景

- 防止用户超额使用
- 供应商配额即将耗尽提醒
- 预算控制预警

{% callout type="note" title="检查间隔说明" %}
检查间隔决定了系统扫描消费数据的频率。较短的间隔（如 10 分钟）可以更及时地发现超额情况，但会增加系统负载。建议根据团队规模和预算敏感度设置合适的间隔。
{% /callout %}

---

## Webhook 配置指南

Claude Code Hub 的消息推送基于标准 Webhook 协议实现，**理论上可以对接任何支持 Webhook 的平台**，企业微信只是其中一个开箱即用的示例。

{% callout type="note" title="平台兼容性" %}
只要目标平台能够接收 HTTP POST 请求并返回符合预期格式的响应，就可以与 Claude Code Hub 对接。对于不兼容格式的平台，可以通过中间层（如 Cloudflare Worker）进行格式转换。
{% /callout %}

---

### 请求格式说明

Claude Code Hub 发送的 Webhook 请求采用以下格式：

**HTTP 请求：**

```http
POST <webhook_url>
Content-Type: application/json

{
  "msgtype": "markdown",
  "markdown": {
    "content": "消息内容（Markdown 格式）"
  }
}
```

**期望响应：**

系统根据响应判断推送是否成功：

| 响应格式 | 行为 |
|----------|------|
| `{"errcode": 0, "errmsg": "ok"}` | 成功，不重试 |
| `{"errcode": 非0}` | 失败，触发重试 |
| HTTP 状态码 4xx/5xx | 失败，触发重试 |

---

### 企业微信（开箱即用）

企业微信机器人原生支持 Claude Code Hub 的消息格式，无需额外配置。

**配置步骤：**

1. 在企业微信群中点击右上角「...」，选择「添加群机器人」
2. 创建机器人后，复制 Webhook URL
3. 将 URL 粘贴到对应的配置项中

**URL 格式示例：**

```
https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

### 飞书（需格式转换）

飞书的 Webhook 格式与企业微信不同，需要通过中间层转换。可参考下方「自定义适配器」章节。

---

### 钉钉（需格式转换）

钉钉的 Webhook 格式也需要转换。可参考下方「自定义适配器」章节。

---

### Telegram（通过 Cloudflare Worker）

Telegram 需要调用 Bot API 发送消息，可以使用 Cloudflare Worker 作为适配层。

**部署步骤：**

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 创建新 Worker
2. 粘贴以下代码
3. 设置环境变量
4. 将 Worker URL 配置为 Claude Code Hub 的 Webhook 地址

**环境变量：**

| 变量 | 说明 |
|------|------|
| `WEBHOOK_SECRET` | 自定义密钥，用于验证请求来源 |
| `BOT_TOKEN` | Telegram Bot Token（从 @BotFather 获取） |
| `CHAT_ID` | 目标聊天/群组 ID |

**Worker 代码（wrangler.toml + worker.js）：**

```js
// worker.js - Telegram 适配器
export default {
  async fetch(request, env) {
    try {
      // 验证请求方法
      if (request.method !== 'POST') {
        return jsonResponse({ errcode: 405, errmsg: 'Method not allowed' }, 200);
      }

      // 从 URL 参数验证密钥
      const url = new URL(request.url);
      const secret = url.searchParams.get('secret');

      if (secret !== env.WEBHOOK_SECRET) {
        return jsonResponse({ errcode: 401, errmsg: 'Unauthorized' }, 200);
      }

      // 解析请求体（企业微信格式）
      const body = await request.json();
      const content = body.markdown?.content || body.text;

      if (!content) {
        return jsonResponse({ errcode: 400, errmsg: 'Missing content' }, 200);
      }

      // 发送到 Telegram
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.CHAT_ID,
            text: content,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          })
        }
      );

      const result = await telegramResponse.json();

      if (result.ok) {
        // ✅ Telegram 成功 - 返回成功响应（不会重试）
        console.log('✅ Message sent successfully');
        return jsonResponse({ errcode: 0, errmsg: 'ok' }, 200);
      } else {
        // ❌ Telegram 失败 - 返回错误响应（触发 CCH 重试）
        console.error('❌ Telegram API error:', result.description);
        return jsonResponse({
          errcode: result.error_code || 1,
          errmsg: `Telegram error: ${result.description || 'Unknown error'}`
        }, 200);
      }

    } catch (error) {
      // ❌ Worker 异常 - 返回错误响应（触发 CCH 重试）
      console.error('❌ Worker error:', error);
      return jsonResponse({
        errcode: 500,
        errmsg: error.message || 'Internal error'
      }, 200);
    }
  }
};

// 辅助函数：返回 JSON 响应
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**Webhook URL 格式：**

```
https://your-worker.your-subdomain.workers.dev?secret=your_webhook_secret
```

{% callout type="warning" title="安全提示" %}
请务必设置 `WEBHOOK_SECRET` 并在 URL 中携带，防止未授权请求触发通知。
{% /callout %}

---

### 自定义适配器开发

对于其他平台，可以参考以下适配器模板：

```js
// 通用适配器模板
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return jsonResponse({ errcode: 405, errmsg: 'Method not allowed' });
    }

    try {
      // 1. 验证请求（可选但推荐）
      const url = new URL(request.url);
      if (url.searchParams.get('secret') !== env.SECRET) {
        return jsonResponse({ errcode: 401, errmsg: 'Unauthorized' });
      }

      // 2. 解析 CCH 发送的消息
      const body = await request.json();
      const content = body.markdown?.content || body.text;

      // 3. 转换为目标平台格式并发送
      // ... 根据目标平台 API 实现 ...

      // 4. 返回结果
      return jsonResponse({ errcode: 0, errmsg: 'ok' });

    } catch (error) {
      return jsonResponse({ errcode: 500, errmsg: error.message });
    }
  }
};

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**适配器部署选项：**

| 平台 | 优势 | 免费额度 |
|------|------|----------|
| Cloudflare Workers | 全球边缘节点，延迟低 | 10 万次/天 |
| Vercel Edge Functions | 与 Vercel 生态集成 | 100 万次/月 |
| AWS Lambda | 功能强大，生态丰富 | 100 万次/月 |
| 自建服务 | 完全可控 | 取决于服务器 |

---

### 安全限制

系统内置了 SSRF（服务端请求伪造）防护机制，以下地址会被拒绝：

- `localhost` 和 `127.0.0.1`
- 私有 IP 范围（10.x.x.x、172.16-31.x.x、192.168.x.x）
- IPv6 本地地址
- 危险端口（22、3306、5432、6379 等）

---

## 测试推送功能

每种通知类型都提供了「测试连接」按钮，用于验证 Webhook 配置是否正确。

### 测试流程

1. 填写对应的 Webhook URL
2. 点击「测试连接」按钮
3. 系统会发送一条测试消息到指定的 Webhook

### 测试消息内容

测试成功时，企业微信会收到如下消息：

```markdown
**测试消息**

企业微信机器人连接成功！
```

### 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| **测试失败** | Webhook URL 格式错误 | 检查 URL 是否完整复制 |
| **请求超时** | 网络连接问题 | 检查服务器网络配置 |
| **403 错误** | 机器人被禁用或 Key 失效 | 重新创建机器人 |
| **不允许访问** | URL 指向内部网络 | 使用公网可访问的地址 |

---

## 消息格式说明

所有推送消息均采用 Markdown 格式，主要包含以下元素：

- **标题**：使用 `##` 二级标题，配合图标标识消息类型
- **引用块**：使用 `>` 高亮关键信息
- **粗体**：使用 `**文字**` 强调重要内容
- **代码块**：使用 `` `代码` `` 展示错误信息
- **分隔线**：使用 `---` 分隔正文和时间戳

{% callout type="note" title="格式兼容性" %}
消息格式针对企业微信机器人优化。如果使用其他支持 Markdown 的 Webhook 服务，显示效果可能略有差异。
{% /callout %}

---

## 运行环境要求

### 生产环境

消息推送的定时任务仅在**生产环境**运行。在开发模式下，定时任务调度功能被禁用，以避免误发通知。

### 依赖服务

消息推送功能依赖以下服务：

| 服务 | 用途 | 必需性 |
|------|------|--------|
| **Redis** | 任务队列管理 | 必需 |
| **PostgreSQL** | 存储配置和统计数据 | 必需 |

{% callout type="warning" title="Redis 配置" %}
如果 Redis 连接失败，通知任务将无法正常调度。请确保 `.env` 文件中的 `REDIS_URL` 配置正确。
{% /callout %}

---

## 任务调度机制

### 定时任务

系统使用 Bull 队列管理定时任务：

- **每日排行榜**：按配置的发送时间每天执行一次
- **成本预警**：按配置的检查间隔周期性执行

### 重试策略

任务执行失败时，系统会自动重试：

- 最大重试次数：3 次
- 重试间隔：指数退避（1 分钟 → 2 分钟 → 4 分钟）

### 任务清理

- 成功任务：保留最近 100 条记录
- 失败任务：保留最近 50 条记录

---

## 最佳实践

1. **为不同通知创建独立机器人**：便于管理和识别消息来源
2. **合理设置预警阈值**：建议 70%-80%，留出缓冲空间
3. **定期检查 Webhook 有效性**：使用测试功能验证配置
4. **结合限流配置使用**：成本预警配合用户限额，实现多层防护
5. **关注熔断告警**：及时处理供应商异常，避免影响服务可用性

---

## 相关功能

- [设置概览](/docs/guide/settings) - 系统设置模块总览
- [供应商管理](/docs/guide/settings-providers) - 配置供应商熔断器参数
- [用户管理](/docs/guide/users) - 设置用户消费限额
- [限流监控](/docs/guide/rate-limits) - 查看限流事件统计
