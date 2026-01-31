---
title: 代理配置
nextjs:
  metadata:
    title: 代理配置
    description: Claude Code Hub 代理配置文档
---

# 代理配置

Claude Code Hub 提供完整的 HTTP/HTTPS/SOCKS 代理支持，让你可以在受限网络环境中
稳定连接上游 AI 供应商。无论是企业防火墙后的部署，还是需要通过特定出口访问
海外服务的场景，代理配置都能确保你的 AI 工具链畅通无阻。

## 为什么需要代理配置

在以下场景中，代理配置至关重要：

- **企业网络安全**：通过公司代理服务器路由所有 AI 供应商流量
- **地理分布访问**：从特定地区访问海外 AI 服务
- **隐私保护**：隐藏源 IP 地址，增强请求匿名性
- **合规要求**：满足组织网络策略和审计需求
- **连接可靠性**：代理故障时自动回退到直连

## 支持的代理类型

Claude Code Hub 支持多种代理协议：

| 协议 | URL 格式 | 认证支持 |
|------|----------|----------|
| HTTP | `http://host:port` | 用户名/密码 |
| HTTPS | `https://host:port` | 用户名/密码 |
| SOCKS5 | `socks5://host:port` | 用户名/密码 |
| SOCKS4 | `socks4://host:port` | 不支持 |

### 认证方式

代理认证通过 URL 嵌入方式配置：

```
http://username:password@proxy.example.com:8080
```

系统会自动解析 URL 中的凭据并传递给底层代理客户端。出于安全考虑，代理 URL
在日志中会被自动脱敏处理，密码部分显示为 `***`。

## 配置代理

### 为供应商配置代理

每个供应商可以独立配置代理设置：

1. 进入 **供应商管理** → 选择供应商 → **网络设置**
2. 在 **代理 URL** 字段输入代理地址
3. 可选：启用 **代理失败时回退到直连**
4. 点击 **测试代理连接** 验证配置

{% callout type="note" title="配置层级" %}
代理配置是供应商级别的，这意味着你可以为不同的 AI 供应商配置不同的代理。
例如，Claude API 走美国代理，Gemini 走新加坡代理。
{% /callout %}

### 配置示例

**基础 HTTP 代理**：

```
代理 URL: http://proxy.company.com:8080
回退到直连: 否
```

**带认证的代理**：

```
代理 URL: http://proxyuser:proxypass@proxy.company.com:8080
回退到直连: 是
```

**本地 SOCKS5 代理**（如 Shadowsocks）：

```
代理 URL: socks5://127.0.0.1:1080
回退到直连: 否
```

**IPv6 代理**：

```
代理 URL: http://[2001:db8::1]:8080
回退到直连: 是
```

## 回退机制

当启用 **代理失败时回退到直连** 选项后，如果代理连接失败，系统会自动尝试
直接连接目标供应商。

### 触发回退的错误类型

以下错误会触发回退机制：

- 错误消息包含 "proxy"
- `ECONNREFUSED` - 连接被拒绝
- `ENOTFOUND` - DNS 解析失败
- `ETIMEDOUT` - 连接超时

### 回退流程

```
请求 → 代理连接 → 失败？→ 是 → 检查回退选项 → 启用？→ 是 → 直连请求
                ↓                   ↓
              成功                未启用
                ↓                   ↓
            返回响应            返回 503 错误
```

{% callout type="warning" title="安全提醒" %}
回退到直连会绕过代理，可能违反企业安全策略。仅在确保合规的情况下启用此选项。
{% /callout %}

## HTTP/2 支持

Claude Code Hub 支持通过代理使用 HTTP/2 协议，但存在以下限制：

- **HTTP/HTTPS 代理**：完全支持 HTTP/2（通过 undici 的 `allowH2` 选项）
- **SOCKS 代理**：不支持 HTTP/2，自动降级到 HTTP/1.1

当系统检测到 SOCKS 代理且 HTTP/2 已启用时，会自动记录警告日志并强制使用
HTTP/1.1：

```
SOCKS proxy does not support HTTP/2, falling back to HTTP/1.1
```

## 连接池管理

为了优化性能，Claude Code Hub 使用代理连接池来复用连接：

### Agent Pool 特性

- **连接复用**：相同端点/代理组合复用连接
- **端点隔离**：不同端点使用独立连接池（避免 SSL 证书问题）
- **健康检查**：SSL 错误会自动标记代理为不健康
- **LRU 淘汰**：最大 100 个代理，5 分钟 TTL

### 连接池配置

连接池使用以下默认参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 最大代理数 | 100 | 同时缓存的代理数量 |
| 代理 TTL | 5 分钟 | 代理过期时间 |
| 连接空闲超时 | 1 分钟 | 空闲连接关闭时间 |
| 清理间隔 | 30 秒 | 过期代理检查频率 |

## 超时配置

代理连接使用全局超时配置，可通过环境变量调整：

```bash
# TCP 连接超时（默认：30 秒）
FETCH_CONNECT_TIMEOUT=30000

# 响应头超时（默认：600 秒）
FETCH_HEADERS_TIMEOUT=600000

# 响应体超时（默认：600 秒）
FETCH_BODY_TIMEOUT=600000
```

这些超时同时适用于代理连接和直连。

## 测试代理连接

在保存配置前，你可以测试代理连接是否正常：

1. 配置代理 URL 和回退选项
2. 点击 **测试代理连接** 按钮
3. 系统会尝试通过代理连接供应商的 API 端点
4. 结果显示连接状态、响应时间和使用的代理

测试结果包含以下信息：

- **连接状态**：成功或失败
- **HTTP 状态码**：供应商返回的状态码
- **响应时间**：连接耗时（毫秒）
- **是否使用代理**：验证代理是否生效
- **代理地址**：脱敏后的代理 URL

## 故障排查

### 代理连接失败

**症状**：请求返回 503 错误，日志显示代理连接错误

**排查步骤**：

1. 验证代理 URL 格式正确（包含协议、主机、端口）
2. 检查代理服务器是否可达（使用 `curl` 测试）
3. 确认认证凭据正确（注意特殊字符需要 URL 编码）
4. 查看系统日志获取详细错误信息

**常用测试命令**：

```bash
# 测试 HTTP 代理
curl -x http://proxy:port http://httpbin.org/ip

# 测试带认证的代理
curl -x http://user:pass@proxy:port http://httpbin.org/ip

# 测试 SOCKS5 代理
curl --socks5-hostname 127.0.0.1:1080 http://httpbin.org/ip
```

### 认证失败

**症状**：HTTP 407 Proxy Authentication Required

**解决方案**：

- 检查用户名和密码是否正确
- 确保密码中的特殊字符已 URL 编码（如 `@` → `%40`）
- 对于 SOCKS 代理，确认代理服务器支持用户名/密码认证

### SSL 证书错误

**症状**：连接失败并提示证书验证错误

**行为**：

- 系统自动将代理标记为不健康
- 下次请求会创建新的代理连接
- 错误详情记录在日志中

**解决方案**：

- 检查代理服务器的 SSL 证书是否有效
- 如果是企业自签名证书，联系 IT 部门配置信任
- 考虑使用 HTTP 代理代替 HTTPS 代理

### DNS 解析失败

**症状**：`ENOTFOUND` 错误

**排查**：

- 检查代理主机名拼写
- 验证 DNS 配置（尝试使用 IP 地址代替主机名）
- 确认代理服务器网络可达

### 协议不匹配

**症状**：HTTPS 供应商通过 HTTP 代理连接失败

**说明**：Claude Code Hub 使用 undici 处理代理连接，自动通过 CONNECT 方法
建立隧道。无需特殊配置，HTTP 代理可以透明地转发 HTTPS 流量。

### 并发请求问题

**症状**：高并发时出现连接错误

**排查**：

- 检查代理服务器的并发连接限制
- 查看 Agent Pool 统计信息（日志中）
- 考虑增加 `maxTotalAgents` 配置（需要修改源码）

## 日志与监控

### 代理相关日志

代理操作会记录以下日志（代理 URL 已脱敏）：

```
ProxyForwarder: Using proxy
  providerId: 123
  proxyUrl: http://user:***@proxy.com:8080
  fallbackToDirect: true
  http2Enabled: false
```

### 回退日志

当触发回退机制时：

```
ProxyForwarder: Falling back to direct connection
ProxyForwarder: Direct connection succeeded after proxy failure
```

### 错误日志

代理错误包含详细诊断信息：

```
ProxyForwarder: Proxy request failed
  providerId: 123
  error: connect ECONNREFUSED 192.168.1.1:8080
  fallbackToDirect: false
```

## 安全最佳实践

1. **使用 HTTPS 代理**：在可能的情况下优先使用 HTTPS 代理，加密代理流量
2. **限制回退选项**：仅在必要时启用回退到直连
3. **定期轮换凭据**：代理认证密码应定期更换
4. **监控异常流量**：通过日志审计代理使用情况
5. **网络隔离**：代理服务器应部署在安全网络区域

## 技术实现细节

### 核心组件

| 组件 | 文件路径 | 职责 |
|------|----------|------|
| Proxy Agent | `src/lib/proxy-agent.ts` | 代理客户端创建、URL 脱敏 |
| Agent Pool | `src/lib/proxy-agent/agent-pool.ts` | 连接池管理、健康检查 |
| 请求转发 | `src/app/v1/_lib/proxy/forwarder.ts` | 代理请求执行、回退逻辑 |

### 依赖库

- **undici**：Node.js HTTP 客户端，提供 ProxyAgent 和 HTTP/2 支持
- **fetch-socks**：SOCKS4/SOCKS5 代理支持

### 数据库字段

代理配置存储在供应商表中：

```sql
proxy_url VARCHAR(512)          -- 代理 URL
proxy_fallback_to_direct BOOLEAN DEFAULT FALSE  -- 回退选项
```

## 配置参考

### 最小配置

```json
{
  "proxyUrl": "http://proxy.company.com:8080",
  "proxyFallbackToDirect": false
}
```

### 完整配置示例

```json
{
  "proxyUrl": "http://user:pass@proxy.company.com:8080",
  "proxyFallbackToDirect": true
}
```

### 环境变量

代理功能无需特殊环境变量，但以下变量会影响代理行为：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FETCH_CONNECT_TIMEOUT` | 30000 | 连接超时（毫秒） |
| `FETCH_HEADERS_TIMEOUT` | 600000 | 响应头超时（毫秒） |
| `FETCH_BODY_TIMEOUT` | 600000 | 响应体超时（毫秒） |

## 限制与注意事项

1. **SOCKS 代理不支持 HTTP/2**：使用 SOCKS 代理时自动降级到 HTTP/1.1
2. **代理 URL 长度限制**：最大 512 字符
3. **IPv6 支持**：需要使用方括号格式（`[2001:db8::1]`）
4. **连接池大小**：默认最多 100 个并发代理连接
5. **无全局代理**：代理配置是供应商级别的，不支持全局代理设置

## 常见问题

**Q: 可以为所有供应商设置同一个代理吗？**

A: 目前代理配置是供应商级别的，你需要为每个供应商单独配置。未来版本可能
支持全局默认代理。

**Q: 代理配置更改后何时生效？**

A: 配置更改立即生效，无需重启服务。新请求会使用新的代理设置。

**Q: 如何验证代理是否真正生效？**

A: 查看请求日志中的 `usedProxy` 字段，或通过代理服务器的访问日志确认
请求来源。

**Q: 支持代理自动配置（PAC）吗？**

A: 目前不支持 PAC 文件，需要手动配置代理 URL。

**Q: 代理连接会影响性能吗？**

A: 会有轻微延迟（通常 < 10ms），但连接池会复用连接以减少开销。相比直连，
代理增加了网络跳数，但在受限网络中往往是唯一选择。
