export const navigation = [
  // ============ 入门文档 ============
  {
    title: '快速开始',
    links: [
      { title: '项目介绍', href: '/' },
      { title: '一键部署', href: '/docs/deploy-script' },
      { title: 'Docker Compose 部署', href: '/docs/deploy-docker' },
      { title: '手动部署', href: '/docs/deploy-manual' },
      { title: '客户端接入', href: '/docs/client-setup' },
    ],
  },
  {
    title: 'Dashboard 功能',
    links: [
      { title: '仪表盘', href: '/docs/guide/dashboard' },
      { title: '使用日志', href: '/docs/guide/logs' },
      { title: '活跃 Session', href: '/docs/guide/sessions' },
      { title: '排行榜', href: '/docs/guide/leaderboard' },
      { title: '可用性监控', href: '/docs/guide/availability' },
      { title: '限流监控', href: '/docs/guide/rate-limits' },
      { title: '用户管理', href: '/docs/guide/users' },
      { title: '用户权限与分组', href: '/docs/guide/permissions-groups' },
      { title: '限额管理', href: '/docs/guide/quota-management' },
      { title: '用户配额', href: '/docs/guide/quotas-users' },
      { title: '供应商配额', href: '/docs/guide/quotas-providers' },
    ],
  },
  {
    title: '系统设置',
    links: [
      { title: '设置概览', href: '/docs/guide/settings' },
      { title: '配置', href: '/docs/guide/settings-config' },
      { title: '价格表', href: '/docs/guide/settings-prices' },
      { title: '供应商管理', href: '/docs/guide/settings-providers' },
      { title: '敏感词', href: '/docs/guide/settings-sensitive-words' },
      { title: '请求过滤器', href: '/docs/guide/settings-request-filters' },
      { title: '错误规则', href: '/docs/guide/settings-error-rules' },
      { title: '客户端升级提醒', href: '/docs/guide/settings-client-versions' },
      { title: '数据管理', href: '/docs/guide/settings-data' },
      { title: '会话绑定清理', href: '/docs/guide/session-binding-cleanup' },
      { title: '日志设置', href: '/docs/guide/settings-logs' },
      { title: '消息推送', href: '/docs/guide/settings-notifications' },
    ],
  },
  {
    title: '其他',
    links: [
      { title: '使用文档页面', href: '/docs/guide/usage-doc' },
      { title: '常见问题', href: '/docs/faq' },
      { title: '故障排查', href: '/docs/troubleshooting' },
    ],
  },

  // ============ 参考文档 ============
  {
    title: '参考文档',
    links: [
      { title: '环境变量参考', href: '/docs/reference/env-variables' },
      { title: 'API 兼容层', href: '/docs/reference/api-compatibility' },
      { title: '供应商类型详解', href: '/docs/reference/provider-types' },
      { title: '供应商字段详解', href: '/docs/reference/provider-fields' },
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
      { title: '请求处理流程', href: '/docs/developer/request-flow' },
      { title: '贡献指南', href: '/docs/developer/contributing' },
      { title: '扩展开发', href: '/docs/developer/extending' },
      { title: '国际化指南', href: '/docs/developer/i18n' },
      { title: '更新日志', href: '/docs/changelog' },
    ],
  },
]
