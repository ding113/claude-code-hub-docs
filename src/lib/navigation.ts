export const navigation = [
  // ============ 快速开始 ============
  {
    title: '快速开始',
    links: [
      { title: '项目介绍', href: '/' },
      { title: '脚本部署', href: '/docs/deployment/script' },
      { title: 'Docker Compose 部署', href: '/docs/deployment/docker-compose' },
      { title: '手动部署', href: '/docs/deployment/manual' },
      { title: '客户端接入', href: '/docs/deployment/client-setup' },
    ],
  },

  // ============ 监控与统计 ============
  {
    title: '监控与统计',
    links: [
      { title: '仪表盘', href: '/docs/monitoring/dashboard' },
      { title: '使用日志', href: '/docs/monitoring/logs' },
      { title: '活跃会话', href: '/docs/monitoring/active-sessions' },
      { title: '排行榜', href: '/docs/monitoring/leaderboard' },
      { title: '统计图表', href: '/docs/monitoring/charts' },
      { title: 'Token 统计', href: '/docs/monitoring/token-stats' },
      { title: '错误率统计', href: '/docs/monitoring/error-stats' },
      { title: '成本追踪', href: '/docs/monitoring/cost-tracking' },
      { title: '数据导出', href: '/docs/monitoring/export' },
      { title: '数据大屏', href: '/docs/monitoring/big-screen' },
    ],
  },

  // ============ 用户管理 ============
  {
    title: '用户管理',
    links: [
      { title: '用户 CRUD', href: '/docs/users/crud' },
      { title: 'API Key 管理', href: '/docs/users/api-keys' },
      { title: '用户分组', href: '/docs/users/groups' },
      { title: '权限控制', href: '/docs/users/permissions' },
      { title: '配额管理', href: '/docs/users/quota' },
      { title: '用户标签', href: '/docs/users/tags' },
      { title: '过期管理', href: '/docs/users/expiration' },
      { title: '访问限制', href: '/docs/users/access-restrictions' },
      { title: 'Web UI 登录控制', href: '/docs/users/login-control' },
      { title: '批量操作', href: '/docs/users/batch-operations' },
    ],
  },

  // ============ 供应商管理 ============
  {
    title: '供应商管理',
    links: [
      { title: '供应商 CRUD', href: '/docs/providers/crud' },
      { title: '端点管理', href: '/docs/providers/endpoints' },
      { title: '价格管理', href: '/docs/providers/pricing' },
      { title: '模型重定向', href: '/docs/providers/model-redirect' },
      { title: '健康检查', href: '/docs/providers/health-check' },
      { title: '可用性监控', href: '/docs/providers/availability' },
      { title: '供应商聚合', href: '/docs/providers/aggregation' },
      { title: '批量操作', href: '/docs/providers/batch-operations' },
    ],
  },

  // ============ 代理功能 ============
  {
    title: '代理功能',
    links: [
      { title: '代理配置', href: '/docs/proxy/proxy-config' },
      { title: '智能路由', href: '/docs/proxy/intelligent-routing' },
      { title: '负载均衡', href: '/docs/proxy/load-balancing' },
      { title: '故障转移与重试', href: '/docs/proxy/failover-retry' },
      { title: '熔断器', href: '/docs/proxy/circuit-breaker' },
      { title: '限流', href: '/docs/proxy/rate-limiting' },
      { title: '超时控制', href: '/docs/proxy/timeout-control' },
      { title: '缓存 TTL', href: '/docs/proxy/cache-ttl' },
      { title: '会话管理', href: '/docs/proxy/session-management' },
      { title: '流式响应', href: '/docs/proxy/streaming-response' },
    ],
  },

  // ============ 过滤器 ============
  {
    title: '过滤器',
    links: [
      { title: '敏感词过滤', href: '/docs/filters/sensitive-words' },
      { title: '请求过滤器', href: '/docs/filters/request-filters' },
      { title: '错误规则', href: '/docs/filters/error-rules' },
      { title: '模型白名单', href: '/docs/filters/model-whitelist' },
      { title: '请求头修改', href: '/docs/filters/header-modification' },
      { title: '请求体修改', href: '/docs/filters/body-modification' },
      { title: '响应覆盖', href: '/docs/filters/response-override' },
    ],
  },

  // ============ 系统设置 ============
  {
    title: '系统设置',
    links: [
      { title: '系统配置', href: '/docs/system/config' },
      { title: '价格同步', href: '/docs/system/price-sync' },
      { title: '缓存管理', href: '/docs/system/cache' },
      { title: '时区设置', href: '/docs/system/timezone' },
      { title: '多语言支持', href: '/docs/system/i18n' },
      { title: 'Webhook 通知', href: '/docs/system/webhook' },
      { title: '客户端版本检查', href: '/docs/system/client-version' },
      { title: '数据导入导出', href: '/docs/system/data-import-export' },
      { title: '自动清理', href: '/docs/system/auto-cleanup' },
    ],
  },

  // ============ 参考文档 ============
  {
    title: '参考文档',
    links: [
      { title: '环境变量', href: '/docs/reference/env-variables' },
      { title: 'API 兼容层', href: '/docs/reference/api-compatibility' },
      { title: '供应商类型', href: '/docs/reference/provider-types' },
      { title: '供应商字段', href: '/docs/reference/provider-fields' },
      { title: '智能调度详解', href: '/docs/reference/intelligent-routing' },
      { title: '熔断器配置', href: '/docs/reference/circuit-breaker' },
      { title: '限流规则详解', href: '/docs/reference/rate-limiting' },
      { title: 'Redis 架构', href: '/docs/reference/redis-architecture' },
      { title: 'Server Actions API', href: '/docs/reference/server-actions' },
      { title: '数据库 Schema', href: '/docs/reference/database-schema' },
    ],
  },

  // ============ 开发文档 ============
  {
    title: '开发文档',
    links: [
      { title: '系统架构', href: '/docs/developer/architecture' },
      { title: '代码结构', href: '/docs/developer/code-structure' },
      { title: '贡献指南', href: '/docs/developer/contributing' },
      { title: '扩展开发', href: '/docs/developer/extending' },
      { title: '国际化指南', href: '/docs/developer/i18n' },
      { title: '更新日志', href: '/docs/changelog' },
    ],
  },

  // ============ 其他 ============
  {
    title: '其他',
    links: [
      { title: '常见问题', href: '/docs/faq' },
      { title: '故障排查', href: '/docs/troubleshooting' },
    ],
  },
]
