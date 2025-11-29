---
dimensions:
  type:
    primary: reference
    detail: changelog
  level: beginner
standard_title: 更新日志
language: zh
---

# 更新日志

本页面记录 Claude Code Hub 的所有重要版本变更，按时间倒序排列。 {% .lead %}

---

## 版本格式说明

本项目遵循 [语义化版本](https://semver.org/zh-CN/) 规范：

- **主版本号**：不兼容的 API 变更
- **次版本号**：向后兼容的新功能
- **修订号**：向后兼容的问题修复

**变更类型**：

| 类型 | 说明 |
| --- | --- |
| **Added** | 新增功能 |
| **Changed** | 功能变更或改进 |
| **Fixed** | Bug 修复 |
| **Deprecated** | 即将废弃的功能 |
| **Removed** | 已移除的功能 |
| **Security** | 安全相关修复 |

---

## [Unreleased] - 开发中

以下是正在开发中的功能，将在下个版本发布。

### 新功能 (Added)

- **供应商可用性监控仪表盘** - 实时健康状态、指标和热力图可视化展示 (#216)
- **智能熔断器探测** - 可配置探测间隔，加速供应商恢复 (#216)
- **增强供应商测试** - 三层验证和预设模板，支持中转服务验证 (#216)
- **实时监控大屏** - 实时指标、24小时趋势、供应商状态槽位和活动流 (#184)
- **深色模式支持** - 仪表盘和设置页面新增主题切换器 (#171)
- **MCP 协议透传** - 支持将工具调用转发至第三方 AI 服务 (#193)
- **API 测试改进** - 流式响应检测和增强的错误解析 (#199)
- **可配置 API 测试超时** - 通过 `API_TEST_TIMEOUT_MS` 环境变量配置 (#199)

### 改进 (Changed)

- **供应商页面性能优化** - 修复 N+1 查询和 SQL 全表扫描问题 (#216)
- **增强错误解析** - 支持中转服务的嵌套错误结构解析 (#216)
- **流式空闲超时调整** - 从 1-120 秒调整为 60-600 秒（0 表示禁用）(#216)
- **供应商 User-Agent** - 添加供应商特定的 User-Agent 头，避免 Cloudflare 检测 (#210)
- **供应商对话框宽度** - 增加对话框宽度，防止长模型重定向名称出现横向滚动条 (#210)
- **数据仪表盘优化** - 全面优化和改进数据仪表盘 (#183)
- **默认供应商超时** - 更新默认超时为无限制，提高兼容性 (#199)
- **流式静默超时** - 从 10 秒调整为 300 秒 (#199)
- **使用记录状态码颜色** - 改进状态码颜色显示，提高可见性 (#199)
- **供应商响应模型标签** - 优化响应模型标签显示 (#199)

### 修复 (Fixed)

- 修复 API action 适配器传参方式，使用位置参数替代对象 (#232)
- 修复可用性监控在选择 15 分钟时间范围时的 Invalid Date 错误 (#231)
- 修复数据库迁移重复枚举类型创建错误 (#181)
- 修复响应处理器的错误处理和状态码，改进用户管理页面体验 (#179)
- 修复排行榜 Tab 切换无限循环问题 (#178)
- 修复 CI 失败：Prettier 格式化和主题切换器 React Hooks ESLint 错误 (#173)
- 修复 Gemini 模型重定向不正确问题 (#199)
- 修复模型重定向信息未保存到数据库问题 (#199)
- 修复供应商多标签匹配问题 (#199)
- 修复错误规则正则匹配和缓存刷新问题 (#199)
- 修复代理降级 "Body has already been read" 错误 (#199)
- 修复 ErrorRuleDetector 懒加载竞态条件 (#199)
- 修复 Anthropic API 测试发送重复认证头问题 (#199)
- 修复 Codex API 测试请求体格式问题 (#199)
- 修复 Pino 日志时间戳配置位置 (#199)
- 修复数据导入跨版本兼容性和错误提示 (#199)

{% callout type="note" title="开发版本" %}
开发中的功能可通过 `dev` 分支体验。部署时选择 `dev` 分支即可获取最新功能。
{% /callout %}

---

## 如何升级

### Docker Compose 升级

```bash
# 拉取最新镜像并重启
docker compose pull && docker compose up -d

# 查看更新后的日志
docker compose logs -f app
```

### 一键部署脚本升级

重新运行部署脚本，会自动检测并升级：

```bash
./deploy.sh
```

{% callout type="warning" title="升级前备份" %}
建议在升级前备份数据库：
```bash
docker compose exec postgres pg_dump -U postgres claude_code_hub > backup.sql
```
{% /callout %}

---

## 版本兼容性

### 数据库迁移

- 升级时会自动执行数据库迁移（`AUTO_MIGRATE=true`）
- 生产环境建议手动检查迁移内容后执行
- 迁移脚本位于 `drizzle/` 目录

### 配置变更

新版本可能引入新的环境变量或变更默认值：

- 查看 `.env.example` 了解新增配置
- 查看 CHANGELOG 中的 **Changed** 部分了解行为变更

### API 兼容性

- 次版本升级保持 API 向后兼容
- 主版本升级可能包含不兼容变更，请查看 **Breaking Changes**

---

## 反馈与贡献

- **发现 Bug**：[提交 Issue](https://github.com/ding113/claude-code-hub/issues/new)
- **功能建议**：[参与讨论](https://github.com/ding113/claude-code-hub/discussions)
- **贡献代码**：[阅读贡献指南](https://github.com/ding113/claude-code-hub/blob/main/CONTRIBUTING.md)
