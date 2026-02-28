---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 数据导入导出
language: zh
---

# 数据导入导出

Claude Code Hub 提供完整的数据导入导出功能，支持数据库备份恢复、价格表同步和批量数据操作。该系统采用分布式锁、事务保护和全面验证等企业级安全机制，确保数据操作的完整性。

{% callout type="note" title="核心功能" %}
- **数据库备份恢复**：完整的 PostgreSQL 备份导出和导入
- **价格表管理**：JSON/TOML 格式支持，云端同步
- **批量操作**：用户、密钥、供应商的批量更新
- **安全机制**：分布式锁、事务保护、自动清理
{% /callout %}

## 数据库备份导出

### 导出接口

**端点**：`GET /api/admin/database/export?mode=full|excludeLogs|ledgerOnly`

系统使用 `pg_dump` 创建 PostgreSQL 自定义格式（压缩）备份。

| 参数 | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `mode` | enum | `full` | 导出模式：`full`（完整导出）、`excludeLogs`（排除请求日志表数据）、`ledgerOnly`（仅导出 usage_ledger 计费账本，v0.6.0+） |

**文件命名规则**：
```text
backup_2025-01-29T10-30-00.dump           // 完整导出
backup_2025-01-29T10-30-00_no-logs.dump   // excludeLogs 模式
backup_2025-01-29T10-30-00_ledger-only.dump  // ledgerOnly 模式（v0.6.0+）
```

{% callout type="warning" title="权限要求" %}
数据库导出功能仅限 `admin` 角色用户使用。系统使用分布式锁防止并发备份操作。
{% /callout %}

### 导出特性

- **流式响应**：支持大型数据库的流式传输
- **日志排除**：可选择排除 `message_request` 表数据，保留表结构
- **计费账本导出**（v0.6.0+）：使用 `mode=ledgerOnly` 仅导出 `usage_ledger` 计费数据，不包含决策日志，备份文件更小且不影响计费和限额功能
- **分布式锁**：Redis 分布式锁防止并发操作，锁超时 5 分钟

{% callout type="warning" %}
v0.6.0 引入了 `usage_ledger` 计费账本系统，将计费数据从日志中解耦。使用 v0.6.0+ 导出的数据库备份将不再兼容旧版本。
{% /callout %}

## 数据库备份导入

### 导入接口

**端点**：`POST /api/admin/database/import`

| 参数 | 类型 | 说明 |
|-----|------|------|
| `file` | File | `.dump` 格式备份文件，最大 500MB |
| `cleanFirst` | boolean | 是否先清空现有数据 |
| `skipLogs` | boolean | 是否跳过日志表数据导入 |

### 导入模式

**合并模式** (`cleanFirst=false`)：
- 导入数据不清空现有数据
- 适用于增量恢复

**覆盖模式** (`cleanFirst=true`)：
- 使用 `--clean --if-exists --no-owner` 参数
- 先删除现有对象再创建
- 适用于完整恢复

### 进度反馈

导入过程通过 Server-Sent Events (SSE) 实时推送进度：

```typescript
interface ImportProgressEvent {
  type: "progress" | "complete" | "error";
  message: string;
  exitCode?: number;
}
```

{% callout type="note" title="自动迁移" %}
导入成功后，系统自动执行数据库迁移 (`runMigrations()`) 以同步 schema 变更。
{% /callout %}

### 错误处理

系统智能分类恢复错误：

**可忽略错误**（不影响导入成功）：
- 对象已存在
- 重复主键
- 重复键值
- 角色不存在

**致命错误**（导致导入失败）：
- 连接失败
- 认证失败
- 权限拒绝
- 数据库不存在
- 内存不足
- 磁盘已满

## 价格表导入

### 支持格式

| 格式 | 说明 |
|-----|------|
| JSON | 内部价格表格式 |
| TOML | 云端价格表格式 |

系统自动检测格式：先尝试 JSON 解析，失败后尝试 TOML 解析。

### 导入方式

1. **手动上传**：通过 Web UI 上传价格表文件
2. **手动同步**：管理员触发从云端同步
3. **自动同步**：后台服务定期同步云端价格表

### 冲突处理

- 默认保留手动设置的价格
- 可通过 `overwriteManual` 参数指定覆盖特定手动价格
- 系统追踪价格来源（`litellm` 或 `manual`）

## 批量操作

### 供应商批量操作

**最大批量**：500 个供应商

| 操作 | 说明 |
|-----|------|
| `batchUpdateProviders` | 批量更新启用状态、优先级、权重、成本倍率、分组标签 |
| `batchDeleteProviders` | 批量软删除供应商 |
| `batchResetProviderCircuits` | 批量重置熔断器状态 |

### 用户批量操作

**最大批量**：500 个用户

可更新字段：
- `note`：备注
- `tags`：标签
- `rpm`：每分钟请求限制
- `dailyQuota`：每日配额
- `limit5hUsd`：5小时消费限额
- `limitWeeklyUsd`：周消费限额
- `limitMonthlyUsd`：月消费限额

### 密钥批量操作

**最大批量**：500 个密钥

可更新字段：
- `providerGroup`：供应商分组
- `limit5hUsd`：5小时消费限额
- `limitDailyUsd`：日消费限额
- `limitWeeklyUsd`：周消费限额
- `limitMonthlyUsd`：月消费限额
- `canLoginWebUi`：是否允许登录 Web UI
- `isEnabled`：是否启用

{% callout type="warning" title="安全验证" %}
批量禁用密钥时，系统会验证每个用户至少保留一个可用密钥。违反此规则的操作将被拒绝，事务回滚。
{% /callout %}

## 并发控制

### 分布式锁

系统使用 Redis 分布式锁防止并发备份操作：

| 配置 | 值 |
|-----|-----|
| 锁键名 | `database:backup:lock` |
| 锁超时 | 5 分钟 |

**锁策略**：
1. 优先使用 Redis 分布式锁（支持多实例部署）
2. Redis 不可用时降级为内存锁（单实例安全）
3. 使用 Lua 脚本确保原子性 SET NX PX 操作

### 并发冲突响应

当其他管理员正在执行备份操作时，返回 HTTP 409：

```json
{
  "error": "其他管理员正在执行备份操作，请稍后重试",
  "details": "为确保数据一致性，同一时间只能执行一个备份操作"
}
```

## 临时文件管理

系统自动管理导入过程中的临时文件：

| 配置 | 默认值 |
|-----|-------|
| 清理间隔 | 1 小时 |
| 最大保留时间 | 6 小时 |
| 文件路径 | `/tmp/database_${purpose}_${timestamp}_${random}.dump` |

**请求取消处理**：
- 用户关闭浏览器时触发清理
- 自动删除临时文件
- 释放分布式锁

## 环境配置

### 数据库连接

```bash
# PostgreSQL 连接字符串
DSN=postgresql://user:password@host:port/database
```

解析后的配置：

| 字段 | 默认值 |
|-----|-------|
| `host` | localhost |
| `port` | 5432 |
| `user` | postgres |
| `database` | postgres |

## 最佳实践

### 备份策略

1. **定期备份**：建议每日执行完整备份
2. **日志分离**：生产环境建议使用 `excludeLogs=true` 减小备份体积
3. **异地存储**：将备份文件存储到独立存储系统

### 恢复策略

1. **测试恢复**：定期在测试环境验证备份可恢复性
2. **合并优先**：非必要情况下使用合并模式，避免数据丢失
3. **监控进度**：通过 SSE 事件监控恢复进度

### 批量操作

1. **分批执行**：超过 500 条记录时分批处理
2. **事务保护**：批量操作自动使用事务，失败时完整回滚
3. **验证优先**：操作前验证数据完整性约束

## 相关文档

- [系统设置](/docs/system/settings) - 了解系统配置选项
- [用户管理](/docs/user-management) - 了解用户和密钥管理
- [供应商管理](/docs/provider-management) - 了解供应商配置
