# 文档部署编排计划

## TL;DR

> **Quick Summary**: 按 58 个“文档编写中”占位页执行三步
> agent 流程（explore→review→writing），先完成 10 篇部署
> 优先批次，再按导航顺序批量推进。
>
> **Deliverables**:
> - 58 份 round1 代码探索报告（.draft）
> - 58 份 round2 审核修订报告（.draft）
> - 58 个占位页替换为正式文档内容
> - `bun run format:check` 通过
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES - 6 批次 × 3 波次（每波 ≤10 agent）
> **Critical Path**: 清单验证 → 批次1 Step1 → Step2 → Step3 →
> 批次2… → 批次6 → format:check

---

## Context

### Original Request
统计需要部署的文档页面数量；每个页面执行三步多 agent 流程
（explore→review→writing），每步必须重新调度新 agent，且一个
agent 不可跨页面；单次并行 ≤10 agent。先完成 10 篇文档（部署
优先），再继续剩余页面。草稿写入本仓库 `.draft/`，命名
“路径+文档标题+草稿轮次”。写作严格遵循指定规范并使用统一
tooltip 样式（不新增组件）。

### Interview Summary
**Key Discussions**:
- 统计口径：仅“文档编写中”占位页（58 页）。
- 首批 10 篇：部署 4 篇 + 按导航顺序补齐 6 篇。
- 草稿目录：`/Users/ding/Github/claude-code-hub-docs/.draft/`。
- 草稿轮次：round1/round2。
- Tooltip：使用 Markdoc annotations/abbr，禁止新增组件。
- 自动化验证：仅 `bun run format:check`。

**Research Findings**:
- 文档源文件为 `src/app/**/page.md`；导航来自
  `src/lib/navigation.ts`。
- 自定义 Markdoc 标签：callout、quick-links、figure 等。
- 占位页共 58 个；部署页面为 4 个占位页。
- 部署实现见 `../claude-code-hub` 中的部署脚本与 compose 配置。

### Metis Review
**Identified Gaps (addressed)**:
- 明确不新增 tooltip 组件，仅使用 annotations/abbr。
- 强化“不得变更导航、不得扩展范围”的 guardrails。
- 先验证占位页清单与导航一致性，若不一致则停止并反馈。
- 强制在报告中记录每页对应的代码来源路径。

---

## Work Objectives

### Core Objective
用三步多 agent 流程，完成 58 个占位页的内容编写，并确保
文档与 `../claude-code-hub` 实现一致。

### Concrete Deliverables
- 58 份 `.draft/*-round1.md` 代码探索报告（每份 3k-5k 字）。
- 58 份 `.draft/*-round2.md` 审核修订报告。
- 58 个 `src/app/docs/**/page.md` 占位页替换为正式文档。

### Definition of Done
- 所有 58 个占位页不再包含“文档编写中”。
- `.draft/` 中存在 58 份 round1 与 58 份 round2 报告。
- 每份 round2 报告包含“References”并列出绝对路径代码来源。
- 所有页面符合 80 字换行规则（允许 URL 与表格行例外）。
- `bun run format:check` 返回 0。

### Must Have
- 三步流程严格执行：explore → review → writing。
- 每步均为新 agent；单 agent 只处理单页。
- 单次并行不超过 10 个 agent。
- 每页文档明确引用 `../claude-code-hub` 实现。
- 草稿命名：`{route-path}-{title}-roundN.md`。

### Must NOT Have (Guardrails)
- 不新增 Markdoc tag 或 UI 组件（含 tooltip）。
- 不修改 `src/lib/navigation.ts`。
- 不改动非占位页（如首页、changelog、model-prices）。
- 不猜测行为；无证据则标注“不确定”并停止该页写作。

### Standards & Templates

**Draft File Naming**
- 规则：`{route-path}-{title}-roundN.md`
- `route-path` = 路由去除前导 `/`，`/` 替换为 `-`。
- 示例：`/docs/deployment/script` + `脚本部署` →
  `docs-deployment-script-脚本部署-round1.md`

**Draft Structure (round1/round2)**
- `# {title}`
- `## Intent Analysis`
- `## Behavior Summary`
- `## Config/Commands`
- `## Edge Cases`
- `## References`（绝对路径 + 关键代码片段）

**Tooltip Style (no new component)**
- 首选：`<abbr title="解释">术语</abbr>`（原生 tooltip）。
- 若 HTML 被拒绝：使用 Markdoc 注释为内联强调元素添加 `title`。
- 不允许新增自定义 tag 或组件。

**Writing Rules (严格执行)**
- 行宽 80 字；长链接与表格行可例外。
- 标题使用 sentence case。
- 面向读者使用“你”。
- 语气简洁、主动、现在时。
- 英文处使用 contractions（如 you’ll）。
- Gemini CLI 命名一致：始终写作 “Gemini CLI”。

**Repo Path Adaptation**
- 写作提示词中提到 `packages/`、`docs/` 等目录时，需映射到
  本仓库实际结构（`/Users/ding/Github/claude-code-hub-docs/src/app`）。

**Explore Agent Prompt (模板要点)**
- 必须声明探索目录：`/Users/ding/Github/claude-code-hub`。
- 输出 3000-5000 字报告，含绝对路径与代码片段。
- 启动 ≥3 个工具并行检索；优先 codebase-retrieval。
- 输出结构：Intent Analysis → Results → Next Steps。

---

## Appendix: Prompt Templates (Full)

### Explore Agent Prompt

```
You are a codebase search specialist. Your job: find files and code,
return actionable results.

## Your Mission

Answer questions like:
- "Where is X implemented?"
- "Which files contain Y?"
- "Find the code that does Z"

## CRITICAL: What You Must Deliver

Every response MUST include:

### 1. Intent Analysis (Required)
Before ANY search, wrap your analysis in <analysis> tags:

<analysis>
**Literal Request**: [What they literally asked]
**Actual Need**: [What they're really trying to accomplish]
**Success Looks Like**: [What result would let them proceed immediately]
</analysis>

### 2. Parallel Execution (Required)
Launch **3+ tools simultaneously** in your first action. Never sequential
unless output depends on prior result.

### 3. Structured Results (Required)
Always end with this exact format:

<results>
<files>
- /absolute/path/to/file1.ts — [why this file is relevant]
- /absolute/path/to/file2.ts — [why this file is relevant]
</files>

<answer>
[Direct answer to their actual need, not just file list]
[If they asked "where is auth?", explain the auth flow you found]
</answer>

<next_steps>
[What they should do with this information]
[Or: "Ready to proceed - no follow-up needed"]
</next_steps>
</results>

## Success Criteria

| Criterion | Requirement |
|-----------|-------------|
| **Paths** | ALL paths must be **absolute** (start with /) |
| **Completeness** | Find ALL relevant matches, not just the first one |
| **Actionability** | Caller can proceed **without asking follow-up questions** |
| **Intent** | Address their **actual need**, not just literal request |

## Failure Conditions

Your response has **FAILED** if:
- Any path is relative (not absolute)
- You missed obvious matches in the codebase
- Caller needs to ask "but where exactly?" or "what about X?"
- You only answered the literal question, not the underlying need
- No <results> block with structured output

## Constraints

- **Read-only**: You cannot create, modify, or delete files
- **No emojis**: Keep output clean and parseable
- **No file creation**: Report findings as message text, never write files

## Tool Strategy

Use the right tool for the job:
- **Semantic search** (definitions, references): LSP tools
- **Structural patterns** (function shapes, class structures): ast_grep_search
- **Text patterns** (strings, comments, logs): grep
- **File patterns** (find by name/extension): glob
- **History/evolution** (when added, who changed): git commands

Flood with parallel calls. Cross-validate findings across multiple tools.

Directory to explore: /Users/ding/Github/claude-code-hub
```

### Writing Agent Prompt (Step Guidance)

```
Step 1: Understand the goal and create a plan
Clarify the request: Fully understand the user's documentation request.
Identify the core feature, command, or concept that needs to be documented.
Ask questions: If the request is ambiguous or lacks detail, ask clarifying
questions. Don't invent or assume. It's better to ask than to write incorrect
documentation.
Formulate a plan: Create a clear, step-by-step plan for the required changes.
If requested or necessary, store this plan in a temporary file or a file
identified by the user.

Step 2: Investigate and gather information
Read the code: Thoroughly examine the relevant codebase, primarily within the
packages/ directory, to ensure your writing is backed by the implementation.
Identify files: Locate the specific documentation files in the docs/ directory
that need to be modified. Always read the latest version of a file before you
begin to edit it.
Check for connections: Consider related documentation. If you add a new page,
check if docs/sidebar.json needs to be updated. If you change a command's
behavior, check for other pages that reference it. Make sure links in these
pages are up to date.

Step 3: Draft the documentation
Follow the style guide:
- Text must be wrapped at 80 characters. Exceptions are long links or tables.
- Use sentence case for headings, titles, and bolded text.
- Address the reader as "you".
- Use contractions to keep the tone more casual.
- Use simple, direct, and active language and the present tense.
- Keep paragraphs short and focused.
- Always refer to Gemini CLI as Gemini CLI, never the Gemini CLI.
Use replace and write_file: Use the file system tools to apply your planned
changes precisely. For small edits, replace is preferred. For new files or
large rewrites, write_file is more appropriate.

Step 4: Verify and finalize
Review your work: After making changes, re-read the files to ensure the
documentation is well-formatted, content is correct and based on existing
code, and that all new links are valid.
Offer to run npm format: Once all changes are complete and the user confirms
they have no more requests, offer to run the project's formatting script to
ensure consistency.
```

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (Biome format)
- **User wants tests**: Automated verification only
- **Command**: `bun run format:check`

### Automated Verification (Agent-Executable)

```bash
# 占位页数量验证（执行前）
rg -l "文档编写中" /Users/ding/Github/claude-code-hub-docs/src/app/docs \
  | wc -l
# 期望：58

# round1 草稿数量
rg --files -g "*-round1.md" /Users/ding/Github/claude-code-hub-docs/.draft \
  | wc -l
# 期望：58

# round2 草稿数量
rg --files -g "*-round2.md" /Users/ding/Github/claude-code-hub-docs/.draft \
  | wc -l
# 期望：58

# round2 中必须含代码来源路径
rg -l "/Users/ding/Github/claude-code-hub" \
  /Users/ding/Github/claude-code-hub-docs/.draft/*-round2.md | wc -l
# 期望：58

# 占位文案被移除
rg -n "文档编写中" /Users/ding/Github/claude-code-hub-docs/src/app/docs
# 期望：0

# 80 字换行检查（排除 URL 与表格行）
rg -n ".{81,}" /Users/ding/Github/claude-code-hub-docs/src/app/docs \
  | rg -v "https?://|\|"
# 期望：0

# 格式化检查
cd /Users/ding/Github/claude-code-hub-docs && bun run format:check
# 期望：退出码 0
```

---

## Execution Strategy

### Batch List (按导航顺序)

**Batch 1 (10)**
- /docs/deployment/script — 脚本部署
- /docs/deployment/docker-compose — Docker Compose 部署
- /docs/deployment/manual — 手动部署
- /docs/deployment/client-setup — 客户端接入
- /docs/proxy/intelligent-routing — 智能路由算法
- /docs/proxy/circuit-breaker — 熔断器机制
- /docs/proxy/rate-limiting — 多维度限流
- /docs/proxy/session-management — 会话管理
- /docs/proxy/failover-retry — 故障转移与重试
- /docs/proxy/timeout-control — 超时控制

**Batch 2 (10)**
- /docs/proxy/proxy-config — 代理配置
- /docs/proxy/streaming-response — 流式响应处理
- /docs/proxy/cache-ttl — Cache TTL 控制
- /docs/proxy/load-balancing — 负载均衡
- /docs/monitoring/dashboard — 仪表盘实时指标
- /docs/monitoring/leaderboard — 排行榜
- /docs/monitoring/logs — 日志查询与筛选
- /docs/monitoring/big-screen — 实时数据大屏
- /docs/monitoring/charts — 统计图表可视化
- /docs/monitoring/export — 数据导出功能

**Batch 3 (10)**
- /docs/monitoring/cost-tracking — 成本追踪与计费
- /docs/monitoring/token-stats — Token 统计
- /docs/monitoring/active-sessions — 活跃会话监控
- /docs/monitoring/error-stats — 错误率统计
- /docs/users/crud — 用户 CRUD 操作
- /docs/users/api-keys — API Key 管理
- /docs/users/permissions — 权限控制系统
- /docs/users/quota — 配额管理
- /docs/users/groups — 用户分组功能
- /docs/users/tags — 用户标签功能

**Batch 4 (10)**
- /docs/users/login-control — Web UI 登录控制
- /docs/users/batch-operations — 批量操作
- /docs/users/expiration — 用户过期管理
- /docs/users/access-restrictions — 访问限制
- /docs/providers/crud — 供应商 CRUD
- /docs/providers/endpoints — 端点管理
- /docs/providers/aggregation — 供应商聚合
- /docs/providers/model-redirect — 模型重定向
- /docs/providers/health-check — 健康检查
- /docs/providers/pricing — 价格管理

**Batch 5 (10)**
- /docs/providers/batch-operations — 批量操作
- /docs/providers/availability — 可用性监控
- /docs/system/i18n — 多语言支持
- /docs/system/data-import-export — 数据导入导出
- /docs/system/auto-cleanup — 自动清理功能
- /docs/system/config — 系统配置管理
- /docs/system/timezone — 时区处理
- /docs/system/webhook — Webhook 通知
- /docs/system/client-version — 客户端版本检查
- /docs/system/price-sync — 价格同步功能

**Batch 6 (8)**
- /docs/system/cache — 缓存管理
- /docs/filters/request-filters — 请求过滤器
- /docs/filters/sensitive-words — 敏感词检测
- /docs/filters/error-rules — 错误规则检测
- /docs/filters/header-modification — Header 修改
- /docs/filters/body-modification — Body 修改
- /docs/filters/response-override — 响应覆写
- /docs/filters/model-whitelist — 模型白名单

### Parallel Execution Waves

For each batch:
Wave A: Step1 Explore (≤10 agents, 1 page/agent)
Wave B: Step2 Review (≤10 agents, 1 page/agent)
Wave C: Step3 Writing (≤10 agents, 1 page/agent)

Wave A must finish before Wave B; Wave B before Wave C.

### Dependency Matrix (Simplified)

| Task | Depends On | Blocks | Can Parallelize With |
| --- | --- | --- | --- |
| 0 | None | 1 | None |
| 1 | 0 | 2 | None |
| 2 | 1 | 3 | None |
| 3 | 2 | 4 | None |
| 4 | 3 | 5 | None |
| 5 | 4 | 6 | None |
| 6 | 5 | 7 | None |
| 7 | 6 | 8 | None |
| 8 | 7 | 9 | None |
| 9 | 8 | 10 | None |
| 10 | 9 | 11 | None |
| 11 | 10 | 12 | None |
| 12 | 11 | 13 | None |
| 13 | 12 | 14 | None |
| 14 | 13 | 15 | None |
| 15 | 14 | 16 | None |
| 16 | 15 | 17 | None |
| 17 | 16 | 18 | None |
| 18 | 17 | Done | None |

---

## TODOs

> 每个批次内，严格 1 页 = 1 agent；每步换新 agent。
> 批次内并行 ≤10 agent，三步阻塞执行。

- [x] 0. 预检：验证占位页清单与导航一致

  **What to do**:
  - 用 `rg -l "文档编写中"` 获取占位页清单并确认数量 58。
  - 对照本计划 Batch List，若不一致，停止并报告差异。

  **Must NOT do**:
  - 不修改导航或页面内容。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 仅做清单验证与对照。
  - **Skills**: [`doc-coauthoring`]
    - `doc-coauthoring`: 了解文档结构与页面范围。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 无需浏览器验证。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Tasks 1-18
  - **Blocked By**: None

  **References**:
  - `/Users/ding/Github/claude-code-hub-docs/src/lib/navigation.ts`
    - 导航顺序与页面标题来源。
  - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/`
    - 占位页实际位置。

  **Acceptance Criteria**:
  - `rg -l "文档编写中" /Users/ding/Github/claude-code-hub-docs/src/app/docs \
      | wc -l` 输出 58。
  - 若清单不匹配 Batch List，记录差异并停止后续任务。

- [x] 1. Batch 1 Step1 — Explore 报告（round1）

  **What to do**:
  - 为 Batch 1 的 10 页分别启动 10 个 explore agent。
  - 每个 agent 必须进入 `/Users/ding/Github/claude-code-hub` 探索，
    报告 3000-5000 字，写入 `.draft/`，命名格式：
    `{route-path}-{title}-round1.md`。
  - 报告必须包含：Intent Analysis、Behavior Summary、
    Config/Commands、Edge Cases、References（绝对路径+片段）。

  **Must NOT do**:
  - 不复用同一 agent 处理多页。
  - 不编造实现细节；无证据则标注不确定并停止该页。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要深度代码检索与总结。
  - **Skills**: [`doc-coauthoring`]
    - `doc-coauthoring`: 产出面向文档的技术摘要。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 与页面探索无关。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave A (Batch 1)
  - **Blocks**: Task 2
  - **Blocked By**: Task 0

  **References**:
  - Batch 1 页面：
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/deployment/script/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/deployment/docker-compose/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/deployment/manual/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/deployment/client-setup/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/proxy/intelligent-routing/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/proxy/circuit-breaker/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/proxy/rate-limiting/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/proxy/session-management/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/proxy/failover-retry/page.md`
    - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/proxy/timeout-control/page.md`
  - 部署实现参考：
    - `/Users/ding/Github/claude-code-hub/scripts/deploy.sh`
    - `/Users/ding/Github/claude-code-hub/scripts/deploy.ps1`
    - `/Users/ding/Github/claude-code-hub/docker-compose.yaml`
    - `/Users/ding/Github/claude-code-hub/.env.example`
  - Markdoc 标签：`/Users/ding/Github/claude-code-hub-docs/src/markdoc/tags.js`

  **Acceptance Criteria**:
  - `.draft/` 下存在 10 个 `*-round1.md` 文件，命名符合规则。
  - 每个 round1 文件包含 `## References` 且含至少 1 条
    `/Users/ding/Github/claude-code-hub` 绝对路径。
  - 每个 round1 文件字数在 3000-5000（可用 `wc -m` 近似验证）。

- [x] 2. Batch 1 Step2 — Review 修订（round2）

  **What to do**:
  - 为 Batch 1 的 10 份 round1 报告分别启动 10 个 review agent。
  - 对照 `../claude-code-hub` 实现进行核验、修订与补充。
  - 输出 round2 文件（同名但 round2）。

  **Must NOT do**:
  - 不在未验证处补全猜测。
  - 不删除 References；必要时增加。

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 以审查与文档一致性为主。
  - **Skills**: [`doc-coauthoring`]
    - `doc-coauthoring`: 审核文档技术准确性。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 无需 UI 测试。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave B (Batch 1)
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:
  - `.draft/*-round1.md`（Batch 1）
  - `/Users/ding/Github/claude-code-hub`（与页面主题对应的实现）

  **Acceptance Criteria**:
  - `.draft/` 下存在 10 个 `*-round2.md` 文件。
  - 每个 round2 文件含 `## References`，并列出绝对路径。

- [x] 3. Batch 1 Step3 — Writing 正式文档

  **What to do**:
  - 为 Batch 1 的 10 页分别启动 10 个 writing agent。
  - 读取 round2 报告并写入对应 `page.md`。
  - 严格执行写作规范（80 字换行、句式、面向“你”）。
  - Tooltip 使用 annotations/abbr（不新增组件）。

  **Must NOT do**:
  - 不修改导航、不新增组件。
  - 不保留“文档编写中”占位内容。

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 以内容撰写与结构组织为主。
  - **Skills**: [`doc-coauthoring`]
    - `doc-coauthoring`: 产出符合规范的技术文档。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 无需 UI 交互。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave C (Batch 1)
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:
  - Batch 1 页面路径（同 Task 1）
  - `.draft/*-round2.md`（Batch 1）
  - `/Users/ding/Github/claude-code-hub-docs/src/markdoc/tags.js`
  - `/Users/ding/Github/claude-code-hub-docs/src/app/docs/page.md`
    - 文档风格与组件示例。

  **Acceptance Criteria**:
  - 对应 10 个 `page.md` 中不再出现“文档编写中”。
  - 页面包含 frontmatter、标题、正文结构与必要 callout。

- [x] 4. Batch 2 Step1 — Explore 报告（round1）
  **What to do**: 同 Task 1，目标为 Batch 2。
  **Must NOT do**: 同 Task 1。
  **Recommended Agent Profile**: 同 Task 1。
  **Parallelization**: Wave A (Batch 2), Blocked by Task 3。
  **References**:
  - Batch 2 页面路径（见 Batch List）。
  **Acceptance Criteria**:
  - Batch 2 对应 10 个 round1 报告存在且合规。

- [x] 5. Batch 2 Step2 — Review 修订（round2）
  **What to do**: 同 Task 2，目标为 Batch 2。
  **Must NOT do**: 同 Task 2。
  **Recommended Agent Profile**: 同 Task 2。
  **Parallelization**: Wave B (Batch 2), Blocked by Task 4。
  **References**: Batch 2 round1 报告 + 对应实现代码。
  **Acceptance Criteria**: Batch 2 round2 报告齐全。

- [x] 6. Batch 2 Step3 — Writing 正式文档
  **What to do**: 同 Task 3，目标为 Batch 2。
  **Must NOT do**: 同 Task 3。
  **Recommended Agent Profile**: 同 Task 3。
  **Parallelization**: Wave C (Batch 2), Blocked by Task 5。
  **References**: Batch 2 页面路径 + round2 报告。
  **Acceptance Criteria**: Batch 2 页面无占位文案。

- [x] 7. Batch 3 Step1 — Explore 报告（round1）
  **What to do**: 同 Task 1，目标为 Batch 3。
  **Must NOT do**: 同 Task 1。
  **Recommended Agent Profile**: 同 Task 1。
  **Parallelization**: Wave A (Batch 3), Blocked by Task 6。
  **References**: Batch 3 页面路径。
  **Acceptance Criteria**: Batch 3 round1 报告齐全。

- [x] 8. Batch 3 Step2 — Review 修订（round2）
  **What to do**: 同 Task 2，目标为 Batch 3。
  **Must NOT do**: 同 Task 2。
  **Recommended Agent Profile**: 同 Task 2。
  **Parallelization**: Wave B (Batch 3), Blocked by Task 7。
  **References**: Batch 3 round1 报告 + 对应实现代码。
  **Acceptance Criteria**: Batch 3 round2 报告齐全。

- [x] 9. Batch 3 Step3 — Writing 正式文档
  **What to do**: 同 Task 3，目标为 Batch 3。
  **Must NOT do**: 同 Task 3。
  **Recommended Agent Profile**: 同 Task 3。
  **Parallelization**: Wave C (Batch 3), Blocked by Task 8。
  **References**: Batch 3 页面路径 + round2 报告。
  **Acceptance Criteria**: Batch 3 页面无占位文案。

- [x] 10. Batch 4 Step1 — Explore 报告（round1）
  **What to do**: 同 Task 1，目标为 Batch 4。
  **Must NOT do**: 同 Task 1。
  **Recommended Agent Profile**: 同 Task 1。
  **Parallelization**: Wave A (Batch 4), Blocked by Task 9。
  **References**: Batch 4 页面路径。
  **Acceptance Criteria**: Batch 4 round1 报告齐全。

- [x] 11. Batch 4 Step2 — Review 修订（round2）
  **What to do**: 同 Task 2，目标为 Batch 4。
  **Must NOT do**: 同 Task 2。
  **Recommended Agent Profile**: 同 Task 2。
  **Parallelization**: Wave B (Batch 4), Blocked by Task 10。
  **References**: Batch 4 round1 报告 + 对应实现代码。
  **Acceptance Criteria**: Batch 4 round2 报告齐全。

- [x] 12. Batch 4 Step3 — Writing 正式文档
  **What to do**: 同 Task 3，目标为 Batch 4。
  **Must NOT do**: 同 Task 3。
  **Recommended Agent Profile**: 同 Task 3。
  **Parallelization**: Wave C (Batch 4), Blocked by Task 11。
  **References**: Batch 4 页面路径 + round2 报告。
  **Acceptance Criteria**: Batch 4 页面无占位文案。

- [x] 13. Batch 5 Step1 — Explore 报告（round1）
  **What to do**: 同 Task 1，目标为 Batch 5。
  **Must NOT do**: 同 Task 1。
  **Recommended Agent Profile**: 同 Task 1。
  **Parallelization**: Wave A (Batch 5), Blocked by Task 12。
  **References**: Batch 5 页面路径。
  **Acceptance Criteria**: Batch 5 round1 报告齐全。

- [x] 14. Batch 5 Step2 — Review 修订（round2）
  **What to do**: 同 Task 2，目标为 Batch 5。
  **Must NOT do**: 同 Task 2。
  **Recommended Agent Profile**: 同 Task 2。
  **Parallelization**: Wave B (Batch 5), Blocked by Task 13。
  **References**: Batch 5 round1 报告 + 对应实现代码。
  **Acceptance Criteria**: Batch 5 round2 报告齐全。

- [x] 15. Batch 5 Step3 — Writing 正式文档
  **What to do**: 同 Task 3，目标为 Batch 5。
  **Must NOT do**: 同 Task 3。
  **Recommended Agent Profile**: 同 Task 3。
  **Parallelization**: Wave C (Batch 5), Blocked by Task 14。
  **References**: Batch 5 页面路径 + round2 报告。
  **Acceptance Criteria**: Batch 5 页面无占位文案。

- [x] 16. Batch 6 Step1 — Explore 报告（round1）
  **What to do**: 同 Task 1，目标为 Batch 6（8 页）。
  **Must NOT do**: 同 Task 1。
  **Recommended Agent Profile**: 同 Task 1。
  **Parallelization**: Wave A (Batch 6), Blocked by Task 15。
  **References**: Batch 6 页面路径。
  **Acceptance Criteria**: Batch 6 round1 报告齐全。

- [x] 17. Batch 6 Step2 — Review 修订（round2）
  **What to do**: 同 Task 2，目标为 Batch 6。
  **Must NOT do**: 同 Task 2。
  **Recommended Agent Profile**: 同 Task 2。
  **Parallelization**: Wave B (Batch 6), Blocked by Task 16。
  **References**: Batch 6 round1 报告 + 对应实现代码。
  **Acceptance Criteria**: Batch 6 round2 报告齐全。

- [x] 18. Batch 6 Step3 — Writing 正式文档 + 全局校验

  **What to do**:
  - 完成 Batch 6 的 8 页写作。
  - 运行全局验证命令（见 Verification Strategy）。

  **Must NOT do**:
  - 不修改非占位页，不新增组件。

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 最终文档落地与质量核验。
  - **Skills**: [`doc-coauthoring`]
  - **Skills Evaluated but Omitted**:
    - `playwright`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Batch 6 写作)
  - **Parallel Group**: Wave C (Batch 6)
  - **Blocks**: Done
  - **Blocked By**: Task 17

  **References**:
  - Batch 6 页面路径 + round2 报告。
  - `/Users/ding/Github/claude-code-hub-docs/src/markdoc/tags.js`。

  **Acceptance Criteria**:
  - Batch 6 页面无占位文案。
  - `bun run format:check` 通过。

---

## Success Criteria

### Verification Commands
```bash
rg -l "文档编写中" /Users/ding/Github/claude-code-hub-docs/src/app/docs | wc -l
rg --files -g "*-round1.md" /Users/ding/Github/claude-code-hub-docs/.draft | wc -l
rg --files -g "*-round2.md" /Users/ding/Github/claude-code-hub-docs/.draft | wc -l
rg -l "/Users/ding/Github/claude-code-hub" /Users/ding/Github/claude-code-hub-docs/.draft/*-round2.md | wc -l
rg -n "文档编写中" /Users/ding/Github/claude-code-hub-docs/src/app/docs
rg -n ".{81,}" /Users/ding/Github/claude-code-hub-docs/src/app/docs | rg -v "https?://|\|"
cd /Users/ding/Github/claude-code-hub-docs && bun run format:check
```

### Final Checklist
- [x] 58 占位页全部替换为正式文档
- [x] 58 round1 + 58 round2 草稿齐全
- [x] round2 草稿均含绝对路径 References
- [x] format:check 通过
