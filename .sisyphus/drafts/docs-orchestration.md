# Draft: 文档部署编排

## Requirements (confirmed)
- 统计需要部署的文档页面数量。
- 每个文档页面按三步独立编排：
  1) explore agent 进入 `/Users/ding/Github/claude-code-hub` 探索，输出 3000-5000 字报告到本项目 `.draft/`，命名为“路径+文档标题+草稿轮次”。
  2) review agent 对草稿逐条对照项目实现，纠错、补充、删改、润色。
  3) writing agent 基于草稿与页面路径撰写正式文档并写入页面。
- 三步必须由不同 agent 完成；一个 agent 不可跨步骤或跨页面。
- 单次并行调度最多 10 个 agent。
- 先完成 10 篇文档；每步一轮并行（共 3 轮）完成 3 步，再继续剩余文档。
- 文档必须依据 `../claude-code-hub` 实际代码实现，不得编造。
- 文档表达：清晰、严谨、由浅入深，善用富文本/内联组件；注释统一 tooltip 样式。
- 统计口径：仅统计“文档编写中”的占位页。
- 首批 10 篇：部署优先。
- 草稿目录：本仓库根目录 `.draft/`。
- 写作规范：严格采用你给的规范（80 字换行、句式、命名等）。
- 首批 10 篇剩余 6 篇：按 navigation 顺序补齐。
- 草稿轮次格式：round1/round2。
- Tooltip：不新增组件，使用 Markdoc annotations/abbr 方案。
- 自动化验证：仅运行格式化检查（`bun run format:check`）。

## Technical Decisions
- 未决定：文档页面的统计口径与优先级排序规则。

## Research Findings
- 文档站点采用 Markdoc；页面源文件为 `src/app/**/page.md`。
- 导航与可见页面来自 `src/lib/navigation.ts`。
- 搜索/时间戳构建基于 `src/app/**/page.md` 的全量扫描；sitemap 基于 navigation 生成。
- 统计线索：`src/lib/navigation.ts` 含 62 个导航条目；`src/app/**/page.md` 共 61 个；`/docs/model-prices` 为 `page.tsx`。
- “文档编写中”占位页数量：58 个（均为 `page.md`）。
- 部署页面占位：
  - `src/app/docs/deployment/script/page.md`
  - `src/app/docs/deployment/docker-compose/page.md`
  - `src/app/docs/deployment/manual/page.md`
  - `src/app/docs/deployment/client-setup/page.md`
- 可用的 Markdoc 组件/标签（示例）：`callout`、`quick-links`、`figure` 等。
- Markdoc 官方无内置 tooltip；若需 tooltip 需自定义 tag 或使用注释/abbr 方案。

## Deployment Implementation Notes (source: ../claude-code-hub)
- 一键部署脚本：`scripts/deploy.sh`（Linux/macOS）、`scripts/deploy.ps1`（Windows）。
- Docker Compose 生产配置：`docker-compose.yaml`；开发配置：`dev/docker-compose.yaml`。
- 手动部署：`bun install` → `bun run build` → `bun run start`。
- 关键环境变量与安全提示：`ADMIN_TOKEN`、`AUTO_MIGRATE`、`ENABLE_SECURE_COOKIES` 等。

## Open Questions
- “需要部署的文档页面”统计口径：
  - 全部 `src/app/**/page.md`？
  - 仅 `navigation` 中列出的页面？
  - 仅包含“文档编写中”的占位页？

## Scope Boundaries
- INCLUDE: 统计页面数量、按三步多 agent 编排、批量并行调度策略、产出草稿与正式文档。
- EXCLUDE: 由我直接撰写或修改正式文档内容。
