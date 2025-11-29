---
dimensions:
  type:
    primary: reference
    detail: guides
  level: intermediate
standard_title: 贡献指南
language: zh
---

# 贡献指南

感谢你对 Claude Code Hub 的关注！本指南帮助你快速上手项目开发，提交高质量的 Pull Request。 {% .lead %}

---

## 开发环境搭建

### 前置要求

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | 18+ | 推荐使用 LTS 版本 |
| Bun | 1.0+ | 包管理器和运行时 |
| PostgreSQL | 15+ | 数据库 |
| Redis | 7+ | 缓存和会话存储 |
| Docker | 24+ | 可选，用于容器化部署 |

### 克隆仓库

```bash
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub
```

### 安装依赖

项目使用 Bun 作为包管理器，相比 npm/yarn 具有更快的安装速度：

```bash
bun install
```

### 环境配置

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 配置必要的环境变量：

```bash
# 数据库连接
DSN=postgresql://user:password@localhost:5432/claude_code_hub

# Redis 连接
REDIS_URL=redis://localhost:6379

# 管理员令牌（用于后台管理）
ADMIN_TOKEN=your_secure_admin_token

# 应用密钥
APP_SECRET=your_app_secret_key
```

### 启动开发服务器

```bash
bun run dev
```

服务默认运行在 `http://localhost:3000`。

### Docker 方式启动

如果你更喜欢容器化开发环境：

```bash
docker compose up -d
```

这将启动完整的开发环境，包括 PostgreSQL 和 Redis。

---

## 分支命名规范

为保持项目整洁，请遵循以下分支命名规范：

### 分支类型

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feature/` | 新功能开发 | `feature/provider-weight-ui` |
| `fix/` | Bug 修复 | `fix/redis-timeout` |
| `hotfix/` | 紧急线上修复 | `hotfix/auth-bypass` |
| `docs/` | 文档更新 | `docs/api-reference` |
| `refactor/` | 代码重构 | `refactor/guard-pipeline` |
| `chore/` | 依赖更新、配置修改 | `chore/update-deps` |

### 命名规则

- 使用小写字母和连字符（kebab-case）
- 简短描述性的名称
- 可包含 Issue ID，如 `fix/123-redis-timeout`

### 创建分支示例

```bash
# 同步最新 dev 分支
git checkout dev
git pull origin dev

# 创建功能分支
git checkout -b feature/audit-log-export
```

{% callout type="warning" title="重要提示" %}
所有 PR 必须以 `dev` 分支为目标。`main` 分支仅用于发布，禁止直接合并或推送。
{% /callout %}

---

## 提交格式

项目遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，确保提交历史清晰可读。

### 提交类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能或重大增强 | `feat: add provider priority routing` |
| `fix` | Bug 修复 | `fix: handle redis timeout retry` |
| `docs` | 文档更新 | `docs: update API reference` |
| `style` | 代码格式调整（不影响功能） | `style: format with prettier` |
| `refactor` | 代码重构（不引入新功能） | `refactor: simplify guard pipeline` |
| `test` | 测试相关 | `test: add unit tests for rate limiter` |
| `chore` | 构建、配置或依赖更新 | `chore: upgrade next.js to 15.0` |
| `perf` | 性能优化 | `perf: optimize database queries` |

### 提交格式

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### 示例

```bash
# 简单提交
git commit -m "feat: add provider weight ui"

# 带范围的提交
git commit -m "fix(auth): handle expired token gracefully"

# 带详细说明的提交
git commit -m "feat(providers): add circuit breaker configuration

- Add per-provider failure threshold
- Add configurable open duration
- Add half-open success threshold

Closes #123"
```

### 最佳实践

1. **使用英文**: 提交信息使用英文，保持一致性
2. **简洁明了**: Subject 行不超过 50 个字符
3. **动词开头**: 使用祈使语气，如 "add"、"fix"、"update"
4. **关联 Issue**: 在 footer 中引用相关 Issue

---

## PR 流程

### 提交 PR 前检查

在创建 Pull Request 之前，请确保完成以下检查：

```bash
# 代码检查
bun run lint

# 类型检查
bun run typecheck

# 运行测试（如有改动运行逻辑）
bun run test

# 可选：验证 Docker 构建
docker compose build
```

### 创建 PR

1. **推送分支**:

```bash
git push origin feature/your-feature-name
```

2. **在 GitHub 创建 PR**:
   - 确保 base 分支是 `dev`
   - 填写清晰的标题和描述
   - 附上测试截图或日志（如适用）

### PR 模板

创建 PR 时，请按以下模板填写：

```markdown
## 变更描述

简要说明本次变更的内容和目的。

## 变更类型

- [ ] 新功能 (feat)
- [ ] Bug 修复 (fix)
- [ ] 文档更新 (docs)
- [ ] 代码重构 (refactor)
- [ ] 其他

## 测试方式

描述如何验证本次变更。

## 截图（如适用）

附上相关截图或录屏。

## 检查清单

- [ ] 目标分支为 `dev`
- [ ] 所有状态检查通过
- [ ] 代码遵循项目规范
- [ ] 已更新相关文档（如需要）
- [ ] 已关联相关 Issue（如有）
```

### PR 检查清单

| 检查项 | 说明 |
|--------|------|
| 目标分支 | 必须是 `dev` |
| CI 检查 | Docker Build Test 等必须通过 |
| 代码冲突 | 与 `dev` 分支无冲突 |
| Issue 关联 | 引用相关 Issue（如有） |

### 审查流程

1. **等待审查**: 维护者通常在 2 个工作日内回复
2. **响应反馈**: 根据审查意见进行修改
3. **推送更新**: 直接推送到同一分支，无需新建 PR
4. **合并**: 审查通过后，维护者会使用 "Squash and merge" 合并

{% callout title="保持分支更新" %}
如果 PR 分支落后于 `dev`，请执行 rebase 保持同步：

```bash
git fetch origin
git rebase origin/dev
git push -f origin feature/your-feature-name
```
{% /callout %}

---

## 代码风格

### ESLint 配置

项目使用 ESLint 进行代码检查，配置文件位于项目根目录。

主要规则：

- TypeScript 严格模式
- React Hooks 规则
- 导入排序

```bash
# 检查代码
bun run lint

# 自动修复
bun run lint --fix
```

### Prettier 配置

代码格式化使用 Prettier，确保一致的代码风格：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `tabWidth` | 2 | 缩进宽度 |
| `semi` | true | 使用分号 |
| `singleQuote` | true | 使用单引号 |
| `trailingComma` | all | 尾随逗号 |
| `printWidth` | 100 | 行宽限制 |

```bash
# 格式化代码
bun run format
```

### TypeScript 严格模式

项目启用 TypeScript 严格模式，包括：

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### 代码规范要点

1. **组件文件**: 使用 PascalCase，如 `ProviderCard.tsx`
2. **工具函数**: 使用 camelCase，如 `formatCurrency.ts`
3. **常量文件**: 使用 UPPER_SNAKE_CASE，如 `const MAX_RETRY_COUNT = 3`
4. **类型定义**: 接口使用 `I` 前缀或后缀 `Props`/`State`

### 文件组织

```
src/
├── app/                    # Next.js App Router
│   ├── v1/                 # 代理端点
│   ├── api/                # REST API
│   ├── dashboard/          # 管理后台页面
│   └── settings/           # 设置页面
├── actions/                # Server Actions
├── repository/             # 数据库查询
├── drizzle/                # Schema + 迁移
├── lib/                    # 共享工具
├── types/                  # TypeScript 类型
└── components/             # React 组件
```

### 编码规范

- **单一职责**: 每个函数/类只做一件事
- **DRY 原则**: 避免重复代码，提取公共逻辑
- **显式错误处理**: 不要忽略错误，正确处理或向上抛出
- **避免魔法数字**: 使用有意义的常量名

---

## 测试指南

### 测试命令

```bash
# 运行所有测试
bun run test

# 运行特定测试文件
bun test src/lib/rate-limit/__tests__/

# 监听模式
bun test --watch
```

### 测试范围

| 测试类型 | 范围 | 工具 |
|----------|------|------|
| 单元测试 | 工具函数、逻辑组件 | Vitest / Bun Test |
| 集成测试 | API 端点、数据库操作 | Vitest + Supertest |
| E2E 测试 | 完整用户流程 | Playwright |

### 测试覆盖率

项目目标覆盖率：**70%+**

重点测试区域：
- 格式转换器（Format Converters）
- 限流逻辑（Rate Limiting）
- 熔断器状态机（Circuit Breaker）
- 验证 Schema（Validation Schemas）

---

## 问题反馈

### 创建 Issue

在 GitHub Issues 中创建问题时，请：

1. **选择合适的标签**: `bug`、`feature`、`question`
2. **提供详细信息**:
   - 环境信息（OS、Docker/Node 版本）
   - 复现步骤
   - 预期结果 vs 实际结果
   - 错误日志或截图

3. **搜索已有 Issue**: 避免重复创建

### Issue 模板

```markdown
## 问题描述

简要描述遇到的问题。

## 复现步骤

1. 执行 XXX
2. 点击 XXX
3. 看到错误

## 预期行为

描述你期望发生的情况。

## 实际行为

描述实际发生的情况。

## 环境信息

- OS: macOS 14.0
- Node: v20.10.0
- Bun: 1.0.18
- Docker: 24.0.7

## 日志/截图

附上相关日志或截图。
```

### 联系方式

- **GitHub Issues**: 技术问题和功能请求
- **GitHub Discussions**: 一般讨论和问答
- **Telegram 群**: 实时交流（见 README）

---

## 行为准则

参与项目贡献时，请遵守以下准则：

1. **友好尊重**: 以友好、尊重和包容的方式沟通
2. **基于事实**: 讨论基于事实和数据，避免人身攻击
3. **多元包容**: 尊重不同背景与观点
4. **建设性反馈**: 提供建设性的批评和建议

{% callout title="响应时间" %}
维护者通常会在 2 个工作日内回复 Issue 和 PR。如遇紧急情况，可在 Issue 中 @Maintainer 或加入 Telegram 群说明。
{% /callout %}

---

## 致谢

感谢所有为 Claude Code Hub 做出贡献的开发者！你的参与让项目变得更好。

如有任何问题，欢迎通过 Issue 或社区渠道联系我们。
