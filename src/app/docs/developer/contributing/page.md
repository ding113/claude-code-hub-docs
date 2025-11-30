---
title: 贡献指南
description: 参与 Claude Code Hub 开源项目的完整指南，包括开发环境搭建、分支策略、代码规范、提交格式和 PR 流程
---

# 贡献指南

欢迎参与 Claude Code Hub 开源项目！本文档将帮助您了解如何按照项目规范提交高质量的 Pull Request（PR），成为社区贡献者的一员。

---

## 概述

Claude Code Hub 是一个面向团队的 AI API 代理平台，支持统一管理多家供应商、智能分流和现代化运维工具。我们欢迎各种形式的贡献：

- 报告 Bug 和提出功能建议
- 改进文档和翻译
- 提交代码修复和新功能
- 参与代码审查和讨论

{% callout type="note" title="社区交流" %}
有任何问题或想法？欢迎通过以下渠道参与讨论：
- **GitHub Issues/Discussions**：首选沟通方式
- **Telegram 群**：[加入交流群](https://t.me/ygxz_group)

维护者通常会在 **2 个工作日内** 回复。
{% /callout %}

---

## 行为准则

为了营造积极、包容的社区氛围，所有参与者需遵守以下行为准则（参考 [Contributor Covenant 2.1](https://www.contributor-covenant.org/)）：

- **友好尊重**：保持耐心和包容的沟通方式
- **尊重多元**：尊重不同背景和观点的贡献者
- **基于事实**：讨论以数据和事实为依据，避免人身攻击
- **建设性反馈**：提出问题时同时思考可能的解决方案

{% callout type="error" title="零容忍" %}
任何形式的歧视、骚扰或攻击性言论都是不可接受的，将导致参与资格被取消。
{% /callout %}

---

## 开发环境搭建

### 环境要求

| 工具 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 20+ | 运行时环境 |
| Bun | 1.3+ | 包管理器和运行时 |
| Docker | 最新版 | 容器化运行（可选） |
| Git | 2.x | 版本控制 |

### 快速开始

**1. 克隆仓库并安装依赖：**

```bash
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub
bun install
```

**2. 配置环境变量：**

```bash
cp .env.example .env
```

编辑 `.env` 文件，至少需要配置：

```bash
# 后台登录令牌（开发环境可使用简单值）
ADMIN_TOKEN=dev-token-12345

# 数据库连接（本地开发）
DSN=postgres://postgres:postgres@localhost:5432/claude_code_hub

# Redis 连接（本地开发）
REDIS_URL=redis://localhost:6379
```

**3. 启动开发服务器：**

```bash
bun run dev
```

服务默认运行在 `http://localhost:13500`。

### Docker 开发环境

如需完整的容器化开发体验，可使用 `dev/` 目录中的工具：

```bash
cd dev
make dev      # 一键启动 PostgreSQL + Redis + 开发服务器
make db       # 仅启动数据库和 Redis
make logs     # 查看所有服务日志
make clean    # 清理环境
```

---

## 分支策略

项目采用双分支模型管理代码：

```
main (稳定版本) ← dev (开发分支) ← feature/* / fix/* (功能/修复分支)
```

### 分支说明

| 分支 | 用途 | 保护级别 |
|------|------|----------|
| `main` | 生产版本，仅用于发布 | 严格保护，禁止直接推送 |
| `dev` | 开发集成分支，所有 PR 的目标 | 保护，需要 CI 通过 |
| `feature/*` | 新功能开发 | 无保护 |
| `fix/*` | Bug 修复 | 无保护 |
| `hotfix/*` | 紧急修复（仍需先合入 dev） | 无保护 |
| `chore/*` | 文档、依赖更新等 | 无保护 |

{% callout type="warning" title="重要规则" %}
**所有 PR 必须以 `dev` 分支为目标！**

`main` 分支仅用于版本发布，禁止直接合并或推送。
{% /callout %}

### 分支命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 新功能 | `feature/<简短描述>` | `feature/provider-weight-ui` |
| Bug 修复 | `fix/<issue-id-或-范围>` | `fix/redis-timeout` |
| 紧急修复 | `hotfix/<范围>` | `hotfix/auth-bypass` |
| 杂项 | `chore/<范围>` | `chore/update-deps` |

---

## 代码规范

### TypeScript 规范

项目使用 TypeScript 严格模式，遵循以下规范：

- **缩进**：2 空格
- **引号**：单引号
- **尾随逗号**：强制使用
- **类型安全**：避免使用 `any`，必要时添加注释说明

### ESLint 配置

项目使用 Next.js 推荐的 ESLint 配置：

```javascript
// eslint.config.mjs 核心配置
extends: ["next/core-web-vitals", "next/typescript", "prettier"]
```

**运行检查：**

```bash
bun run lint
```

### Prettier 格式化

代码格式由 Prettier 统一管理：

```bash
# 检查格式
bun run format:check

# 自动修复格式
bun run format
```

### 代码风格要点

| 方面 | 规范 |
|------|------|
| 文件命名 | 参考 `src/` 下同类模块的命名方式 |
| 组件样式 | Tailwind CSS 类名与 JSX 同行 |
| 工具函数 | 单一职责，避免重复（DRY） |
| 文档风格 | 参考 README 中的语气和表情符号使用 |

---

## 提交规范

### Conventional Commits

所有提交消息必须遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<类型>: <简短描述>

[可选的详细说明]

[可选的关联 Issue]
```

### 提交类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `feat` | 新功能或重大增强 | `feat: add provider priority routing` |
| `fix` | Bug 修复 | `fix: handle redis timeout retry` |
| `chore` | 构建、配置、文档 | `chore: update dependencies` |
| `refactor` | 重构（不改变功能） | `refactor: extract session manager` |
| `test` | 测试相关 | `test: add unit tests for rate limiter` |
| `docs` | 文档更新 | `docs: update deployment guide` |
| `style` | 代码格式（不影响逻辑） | `style: fix eslint warnings` |
| `perf` | 性能优化 | `perf: optimize provider selection` |

### 提交消息示例

**良好的提交消息：**

```bash
feat: add weighted load balancing for providers

- Implement weighted random selection algorithm
- Add priority-based failover logic
- Update provider configuration UI

Closes #123
```

**应避免的提交消息：**

```bash
# 太模糊
fix: bug fix

# 没有类型前缀
update code

# 混合多个变更
feat: add feature and fix bug and update docs
```

---

## PR 流程

### 开发工作流

**1. 同步最新代码：**

```bash
git checkout dev
git pull origin dev
```

**2. 创建功能分支：**

```bash
git checkout -b feature/your-feature-name
```

**3. 开发并提交：**

```bash
# 进行开发...

# 运行检查
bun run lint
bun run typecheck
bun run format:check

# 提交变更
git add .
git commit -m "feat: add your feature description"
```

**4. 推送并创建 PR：**

```bash
git push origin feature/your-feature-name
```

然后在 GitHub 上创建指向 `dev` 分支的 Pull Request。

### PR 检查清单

创建 PR 前，请确认以下事项：

- [ ] **目标分支**：PR 的 base 分支是 `dev`
- [ ] **CI 检查**：所有状态检查已通过（Code Quality Check、Docker Build Test）
- [ ] **无冲突**：与目标分支无合并冲突
- [ ] **关联 Issue**：如有相关 Issue，请在 PR 中引用
- [ ] **变更说明**：提供清晰的变更摘要和测试说明
- [ ] **截图/日志**：UI 变更附上截图，逻辑变更附上测试日志

### CI/CD 检查

每个 PR 会自动触发以下检查：

| 检查项 | 说明 |
|--------|------|
| **Code Quality Check** | TypeScript 类型检查、代码格式检查、迁移文件验证 |
| **Docker Build Test** | 验证 Docker 镜像可正常构建 |

{% callout type="note" title="本地验证" %}
提交前建议在本地运行以下命令，确保 CI 能够通过：

```bash
bun run typecheck        # 类型检查
bun run format:check     # 格式检查
docker compose build     # 构建测试（可选）
```
{% /callout %}

### Review 流程

1. **等待审查**：维护者会在 2 个工作日内进行 Review
2. **处理反馈**：根据反馈修改后，直接推送到同一分支
3. **合并方式**：采用 **Squash and merge** 保持干净的提交历史

### PR 过期处理

如果 PR 长时间未合并导致与 `dev` 分支产生差异：

```bash
git fetch origin
git rebase origin/dev
git push --force-with-lease
```

---

## Issue 报告

### Bug 报告

提交 Bug 时，请包含以下信息：

1. **环境信息**
   - 操作系统和版本
   - Docker/Node.js/Bun 版本
   - Claude Code Hub 版本

2. **复现步骤**
   - 详细的操作步骤
   - 相关配置（脱敏后）

3. **预期结果 vs 实际结果**
   - 您期望发生什么
   - 实际发生了什么

4. **日志和截图**
   - 相关错误日志
   - 问题界面截图

### 功能请求

提交功能建议时，请说明：

- **使用场景**：为什么需要这个功能
- **期望行为**：功能应该如何工作
- **替代方案**：是否考虑过其他解决方式

{% callout type="note" title="避免重复" %}
提交 Issue 前，请先搜索是否已有类似的讨论，避免创建重复的 Issue。
{% /callout %}

---

## 开发命令参考

### 常用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动开发服务器（端口 13500） |
| `bun run build` | 构建生产版本 |
| `bun run lint` | 运行 ESLint 检查 |
| `bun run typecheck` | 运行 TypeScript 类型检查 |
| `bun run format` | 格式化代码 |
| `bun run format:check` | 检查代码格式 |

### 数据库命令

| 命令 | 说明 |
|------|------|
| `bun run db:generate` | 生成数据库迁移文件 |
| `bun run db:migrate` | 执行数据库迁移 |
| `bun run db:push` | 推送 schema 变更（开发用） |
| `bun run db:studio` | 启动 Drizzle Studio（数据库 GUI） |
| `bun run validate:migrations` | 验证迁移文件 |

### Docker 命令

```bash
# 构建镜像
docker compose build

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f app

# 停止服务
docker compose down
```

---

## 联系方式

| 渠道 | 地址 | 用途 |
|------|------|------|
| GitHub Issues | [ding113/claude-code-hub/issues](https://github.com/ding113/claude-code-hub/issues) | Bug 报告、功能请求 |
| GitHub Discussions | [ding113/claude-code-hub/discussions](https://github.com/ding113/claude-code-hub/discussions) | 问题讨论、想法交流 |
| Telegram 群 | [t.me/ygxz_group](https://t.me/ygxz_group) | 实时交流、紧急问题 |

---

## 感谢

感谢每一位为 Claude Code Hub 做出贡献的开发者！您的参与让这个项目变得更好。

无论是提交代码、报告 Bug、改进文档，还是参与讨论，每一份贡献都是宝贵的。

{% callout type="note" title="成为贡献者" %}
一旦您的 PR 被合并，您将自动成为项目贡献者，并出现在 GitHub 的贡献者列表中。
{% /callout %}
