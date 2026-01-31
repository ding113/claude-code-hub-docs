---
title: 流式响应处理
description: 了解 Claude Code Hub 如何处理 AI 供应商的 Server-Sent Events (SSE) 流式响应，包括块缓冲、错误处理和响应整流。
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 流式响应处理
language: zh
---

# 流式响应处理

Claude Code Hub 实现了一套完善的流式响应处理系统，支持 Server-Sent Events (SSE) 协议，用于实时传输 AI 模型的流式输出。本文档详细介绍流式响应的技术架构、实现细节和数据流。

## 概述

当你通过 Claude Code Hub 向 AI 供应商发起流式请求时，系统会：

1. 基于 `Content-Type` 头检测流式响应
2. 将响应路由到相应的处理器
3. 管理块缓冲以实现高效处理
4. 将流拆分为客户端交付和后台处理两个并发路径
5. 优雅地处理错误，避免产生孤儿数据库记录

## SSE 协议实现

### 核心 SSE 解析器

系统通过 `src/lib/utils/sse.ts` 提供健壮的 SSE 解析能力。该模块处理标准的 SSE 格式，事件通过双换行符分隔，由 `event:` 和 `data:` 字段组成。

```typescript
// src/lib/utils/sse.ts
export function parseSSEData(sseText: string): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = [];
  let eventName = "";
  let dataLines: string[] = [];

  const flushEvent = () => {
    // 修改：支持没有 event: 前缀的纯 data: 格式（Gemini 流式响应）
    // 如果没有 eventName，使用默认值 "message"
    if (dataLines.length === 0) {
      eventName = "";
      dataLines = [];
      return;
    }

    const dataStr = dataLines.join("\n");
    try {
      const data = JSON.parse(dataStr);
      events.push({ event: eventName || "message", data });
    } catch {
      events.push({ event: eventName || "message", data: dataStr });
    }
    eventName = "";
    dataLines = [];
  };

  const lines = sseText.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) {
      flushEvent();
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.substring(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      let value = line.substring(5);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    }
  }
  flushEvent();
  return events;
}
```

解析器支持多种 SSE 格式：

- 标准 SSE，包含 `event:` 和 `data:` 字段
- 纯 `data:` 格式（Gemini 流式响应使用）
- 多行数据负载
- 以 `:` 开头的注释行

### SSE 检测

系统使用严格的检测逻辑识别 SSE 流，避免将包含 "data:" 子串的 JSON 误判为 SSE：

```typescript
// src/lib/utils/sse.ts
export function isSSEText(text: string): boolean {
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i !== text.length && text.charCodeAt(i) !== 10) continue;
    const line = text.slice(start, i).trim();
    start = i + 1;
    if (!line) continue;
    if (line.startsWith(":")) continue;
    return line.startsWith("event:") || line.startsWith("data:");
  }
  return false;
}
```

### 多供应商 SSE 支持

`src/lib/provider-testing/utils/sse-collector.ts` 中的 SSE 收集器支持从多种供应商格式中提取文本内容：

- **Anthropic 格式**: `{"delta":{"text":"..."}}`
- **OpenAI 格式**: `{"choices":[{"delta":{"content":"..."}}]}`
- **Codex Response API**: `{"output":[{"content":[{"text":"..."}]}]}`
- **Gemini 格式**: `{"candidates":[{"content":{"parts":[{"text":"..."}]}}]}`

这种多格式支持使系统能够与各种 AI 供应商配合工作，同时保持一致的内部表示。

## 流检测与路由

### 基于 Content-Type 的检测

代理层通过检查 `Content-Type` 响应头来检测流式响应：

```typescript
// src/app/v1/_lib/proxy/response-handler.ts
const contentType = fixedResponse.headers.get("content-type") || "";
const isSSE = contentType.includes("text/event-stream");

if (!isSSE) {
  return await ProxyResponseHandler.handleNonStream(session, fixedResponse);
}

return await ProxyResponseHandler.handleStream(session, fixedResponse);
```

此检测发生在 `ProxyResponseHandler.dispatch` 方法中，作为响应处理的入口点。分发器根据检测结果将响应路由到 `handleNonStream` 或 `handleStream`。

### 响应处理器架构

`ProxyResponseHandler` 类提供两种主要的处理路径：

1. **`handleNonStream`**: 处理非流式请求的完整 JSON 响应
2. **`handleStream`**: 管理 SSE 流式响应，支持实时处理

两条路径都支持在供应商原生格式与客户端期望格式不同时进行格式转换。

## 块处理与缓冲区管理

### ChunkBuffer 实现

`ChunkBuffer` 类位于 `src/app/v1/_lib/proxy/response-fixer/index.ts`，为流处理提供高效的缓冲：

```typescript
class ChunkBuffer {
  private readonly chunks: Uint8Array[] = [];
  private head = 0;
  private headOffset = 0;
  private total = 0;
  private processableEnd = 0;
  private pendingCR = false;

  get length(): number {
    return this.total;
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    const prevTotal = this.total;
    this.chunks.push(chunk);
    this.total += chunk.length;

    // 处理跨 chunk 的 CRLF：如果上一块以 CR 结尾，检查本块首字节是否为 LF
    if (this.pendingCR) {
      this.processableEnd = chunk[0] === LF_BYTE ? prevTotal + 1 : prevTotal;
      this.pendingCR = false;
    }

    // 仅扫描新增 chunk，增量维护"可处理末尾"索引，避免 O(n^2) 全量扫描
    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i];
      if (b === LF_BYTE) {
        this.processableEnd = prevTotal + i + 1;
        continue;
      }
      if (b !== CR_BYTE) continue;

      if (i + 1 < chunk.length) {
        if (chunk[i + 1] !== LF_BYTE) {
          this.processableEnd = prevTotal + i + 1;
        }
        continue;
      }
      // chunk 尾部 CR：等待下一块确认是否为 CRLF
      this.pendingCR = true;
    }
  }
}
```

ChunkBuffer 的关键特性：

- **增量处理**: 仅扫描新添加的块
- **CRLF 处理**: 正确处理跨块的分隔符
- **内存效率**: 定期清理已消费的块（当 head > 64 时清理）
- **DoS 防护**: 最大缓冲区大小防止无界内存增长

### 内存安全

缓冲区包含安全机制以防止内存耗尽：

```typescript
// 安全保护：如果上游长时间不输出换行，buffer 会持续增长，可能导致内存无界增长。
// 达到上限后降级为透传（不再进行 SSE/JSON 修复），避免 DoS 风险。
if (buffer.length + chunk.length > maxBufferBytes) {
  passthrough = true;
  buffer.flushTo(controller);
  controller.enqueue(chunk);
  return;
}
```

当缓冲区超过 `maxBufferBytes`（默认 1MB）时，系统切换到透传模式，直接转发块而不进行处理，以避免内存问题。

## 客户端-服务端流式流程

### 请求流程概览

1. **客户端请求** → 代理处理器
2. **代理处理器** → 转发器（带重试逻辑）
3. **转发器** → 上游供应商
4. **供应商响应** → 响应处理器
5. **响应处理器** → 客户端（流式）+ 后台处理

### 流 Tee 模式

流式架构的关键方面是使用 tee 模式将流拆分为客户端交付和后台处理两个并发路径：

```typescript
// src/app/v1/_lib/proxy/response-handler.ts
// 使用 TransformStream 包装流，以便在 idle timeout 时能关闭客户端流
// 解决 tee() 后 internalStream abort 不影响 clientStream 的问题
let streamController: TransformStreamDefaultController<Uint8Array> | null = null;
const controllableStream = processedStream.pipeThrough(
  new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  })
);

const [clientStream, internalStream] = controllableStream.tee();
```

tee 操作创建两个独立的流：

- **`clientStream`**: 直接发送给客户端进行实时显示
- **`internalStream`**: 由后台任务消费，用于统计、费用计算和持久化

### 后台处理

内部流被异步处理：

```typescript
const processingPromise = (async () => {
  const reader = internalStream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let usageForCost: UsageMetrics | null = null;
  let isFirstChunk = true;

  try {
    while (true) {
      // 检查取消信号
      if (session.clientAbortSignal?.aborted || abortController.signal.aborted) {
        logger.info("ResponseHandler: Stream processing cancelled", {
          taskId,
          providerId: provider.id,
          chunksCollected: chunks.length,
        });
        break;
      }

      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(decoder.decode(value, { stream: true }));

        // 每次收到数据后重置空闲计时器
        startIdleTimer();

        // 第一块数据时清除响应超时
        if (isFirstChunk) {
          session.recordTtfb();
          isFirstChunk = false;
        }
      }
    }

    // 完成：合并块，提取用量，更新数据库
    const allContent = flushAndJoin();
    await finalizeStream(allContent);
  } finally {
    // 资源清理
    clearIdleTimer();
    reader.releaseLock();
    AsyncTaskManager.cleanup(taskId);
  }
})();
```

### 异步任务管理

后台处理向 `AsyncTaskManager` 注册以确保正确的生命周期管理：

```typescript
AsyncTaskManager.register(taskId, processingPromise, "stream-processing");
processingPromise.catch(async (error) => {
  logger.error("ResponseHandler: Uncaught error in stream processing", {
    taskId,
    messageId: messageContext.id,
    error,
  });
  // 持久化失败以避免孤儿记录
  await persistRequestFailure({ /* ... */ });
});
```

## 流式上下文中的错误处理

### 错误分类

系统将流式过程中的错误分为不同类别：

```typescript
// src/app/v1/_lib/proxy/errors.ts
export enum ErrorCategory {
  PROVIDER_ERROR,           // 供应商问题（所有 4xx/5xx HTTP 错误）→ 计入熔断器 + 直接切换
  SYSTEM_ERROR,             // 系统/网络问题（fetch 网络异常）→ 不计入熔断器 + 先重试1次
  CLIENT_ABORT,             // 客户端主动中断 → 不计入熔断器 + 不重试 + 直接返回
  NON_RETRYABLE_CLIENT_ERROR, // 客户端输入错误 → 不计入熔断器 + 不重试 + 直接返回
  RESOURCE_NOT_FOUND,       // 上游 404 错误 → 不计入熔断器 + 直接切换供应商
}
```

### 流式特定错误处理

在流式上下文中，根据错误来源不同采用不同的处理方式：

```typescript
// src/app/v1/_lib/proxy/response-handler.ts
try {
  while (true) {
    // ... 读取循环
  }
} catch (error) {
  const err = error as Error;
  const clientAborted = session.clientAbortSignal?.aborted ?? false;
  const isResponseControllerAborted =
    sessionWithController.responseController?.signal.aborted ?? false;

  if (isClientAbortError(err)) {
    // 区分不同超时来源
    const isResponseTimeout = isResponseControllerAborted && !clientAborted;
    const isIdleTimeout = err.message?.includes("streaming_idle");

    if (isResponseTimeout && !isIdleTimeout) {
      // 响应超时（首字节超时）：计入熔断器
      logger.error("ResponseHandler: Response timeout during stream body read", {
        taskId,
        providerId: provider.id,
        chunksCollected: chunks.length,
      });
      await recordFailure(provider.id, err);
      await persistRequestFailure({ /* ... */ });
    } else if (isIdleTimeout) {
      // 空闲超时：计入熔断器
      logger.error("ResponseHandler: Streaming idle timeout", {
        taskId,
        providerId: provider.id,
        chunksCollected: chunks.length,
      });
      await recordFailure(provider.id, err);
      await persistRequestFailure({ /* ... */ });
    } else if (!clientAborted) {
      // 上游流意外中断
      logger.error("ResponseHandler: Upstream stream aborted unexpectedly", {
        taskId,
        providerId: provider.id,
        chunksCollected: chunks.length,
      });
      await persistRequestFailure({ /* ... */ });
    } else {
      // 客户端主动中断：正常日志，不抛出
      logger.warn("ResponseHandler: Stream reading aborted by client", {
        taskId,
        providerId: provider.id,
        chunksCollected: chunks.length,
      });
    }
  }
}
```

### 客户端断开处理

当客户端断开连接时，系统执行清理：

```typescript
// src/app/v1/_lib/proxy/response-handler.ts
if (session.clientAbortSignal) {
  session.clientAbortSignal.addEventListener("abort", () => {
    logger.debug("ResponseHandler: Client disconnected, cleaning up", {
      taskId,
      providerId: provider.id,
    });

    // 1. 清除空闲超时（防止误触发）
    if (idleTimeoutId) {
      clearTimeout(idleTimeoutId);
      idleTimeoutId = null;
    }

    // 2. 取消后台任务
    AsyncTaskManager.cancel(taskId);
    abortController.abort();
  });
}
```

### 孤儿记录预防

错误处理的关键方面是防止"孤儿记录"——保持不完整状态的数据库条目。系统使用 `persistRequestFailure` 确保即使发生错误也会更新记录：

```typescript
async function persistRequestFailure({
  session,
  messageContext,
  statusCode,
  error,
  taskId,
  phase,
}: PersistFailureParams): Promise<void> {
  if (!messageContext) return;

  try {
    const duration = Date.now() - session.startTime;
    await updateMessageRequestDuration(messageContext.id, duration);
    await updateMessageRequestDetails(messageContext.id, {
      statusCode: statusCode,
      providerChain: session.getProviderChain(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    const tracker = ProxyStatusTracker.getInstance();
    tracker.endRequest(messageContext.user.id, messageContext.id);
  } catch (persistError) {
    logger.error("ResponseHandler: Failed to persist request failure", {
      taskId,
      messageId: messageContext.id,
      persistError,
    });
  }
}
```

## 空闲超时与流生命周期

### 流式空闲超时

流式空闲超时机制监控流处理过程中的停滞：

```typescript
// src/app/v1/_lib/proxy/response-handler.ts
const idleTimeoutMs =
  provider.streamingIdleTimeoutMs > 0 ? provider.streamingIdleTimeoutMs : Infinity;

const startIdleTimer = () => {
  if (idleTimeoutMs === Infinity) return;
  clearIdleTimer();
  idleTimeoutId = setTimeout(() => {
    logger.warn("ResponseHandler: Streaming idle timeout triggered", {
      taskId,
      providerId: provider.id,
      idleTimeoutMs,
      chunksCollected: chunks.length,
    });

    // 1. 关闭客户端流
    try {
      if (streamController) {
        streamController.error(new Error("Streaming idle timeout"));
      }
    } catch (e) {
      logger.warn("ResponseHandler: Failed to close client stream", { error: e });
    }

    // 2. 终止上游连接
    try {
      const sessionWithController = session as typeof session & {
        responseController?: AbortController;
      };
      if (sessionWithController.responseController) {
        sessionWithController.responseController.abort(new Error("streaming_idle"));
      }
    } catch (e) {
      logger.warn("ResponseHandler: Failed to abort upstream connection", { error: e });
    }

    // 3. 终止后台读取任务
    abortController.abort(new Error("streaming_idle"));
  }, idleTimeoutMs);
};
```

### 空闲计时器生命周期

空闲计时器遵循特定的生命周期：

1. **初始连接期间不启动**（避免与首字节超时重叠）
2. **收到第一块数据时启动**
3. **每次后续收到数据时重置**
4. **流完成或出错时清除**

此设计确保空闲超时仅检测流中段的停滞，而非缓慢的初始连接。

### 供应商级配置

空闲超时通过 `streamingIdleTimeoutMs` 字段按供应商配置：

```typescript
// src/drizzle/schema.ts
streamingIdleTimeoutMs: integer('streaming_idle_timeout_ms').notNull().default(0),
```

值为 `0` 时禁用该供应商的空闲超时。配置非 0 值时，最小必须为 60 秒。

## 响应整流集成

### 带响应整流的流处理

`ResponseFixer` 提供实时纠正畸形响应的功能：

```typescript
// src/app/v1/_lib/proxy/response-fixer/index.ts
private static processStream(
  session: ProxySession,
  response: Response,
  config: ResponseFixerConfig
): Response {
  const encodingFixer = config.fixEncoding ? new EncodingFixer() : null;
  const sseFixer = config.fixSseFormat ? new SseFixer() : null;
  const jsonFixer = config.fixTruncatedJson
    ? new JsonFixer({ maxDepth: config.maxJsonDepth, maxSize: config.maxFixSize })
    : null;

  const buffer = new ChunkBuffer();
  let passthrough = false;
  const maxBufferBytes = config.maxFixSize;

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      audit.totalBytesProcessed += chunk.length;

      if (passthrough) {
        controller.enqueue(chunk);
        return;
      }

      // 安全：如果缓冲区增长过大则切换到透传
      if (buffer.length + chunk.length > maxBufferBytes) {
        passthrough = true;
        buffer.flushTo(controller);
        controller.enqueue(chunk);
        return;
      }

      buffer.push(chunk);

      const end = buffer.findProcessableEnd();
      if (end <= 0) return;

      const toProcess = buffer.take(end);
      let data: Uint8Array = toProcess;

      // 按顺序应用整流器
      if (encodingFixer) {
        const res = encodingFixer.fix(data);
        if (res.applied) {
          applied.encoding.applied = true;
          data = res.data;
        }
      }

      if (sseFixer) {
        const res = sseFixer.fix(data);
        if (res.applied) {
          applied.sse.applied = true;
          data = res.data;
        }
      }

      if (jsonFixer) {
        const res = ResponseFixer.fixSseJsonLines(data, jsonFixer);
        if (res.applied) {
          applied.json.applied = true;
          data = res.data;
        }
      }

      controller.enqueue(data);
    },
    flush(controller) {
      // 处理缓冲区中剩余的内容
      if (buffer.length > 0) {
        let data: Uint8Array = buffer.drain();
        // 应用整流器...
        controller.enqueue(data);
      }
      // 持久化审计信息
      if (audit.hit) {
        session.addSpecialSetting(audit);
        persistSpecialSettings(session);
      }
    },
  });

  return new Response(response.body?.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
```

### 整流器类型

响应整流器支持三种纠正类型：

1. **编码整流器 (EncodingFixer)**: 纠正字符编码问题（如 GBK 被误识别为 UTF-8）
2. **SSE 整流器 (SseFixer)**: 修复畸形的 SSE 格式
   - 补齐 `data:` 前缀
   - 统一换行符为 LF
   - 修复大小写错误（如 `Data:` → `data:`）
   - 修复 `data :`（data 与冒号间有空格）
3. **JSON 整流器 (JsonFixer)**: 修复 SSE 数据行中截断的 JSON
   - 补齐未闭合的括号/引号
   - 移除尾随逗号
   - 必要时补 null

### 审计追踪

所有整流器操作都被记录用于调试和监控：

```typescript
type ResponseFixerApplied = {
  encoding: { applied: boolean; details?: string };
  sse: { applied: boolean; details?: string };
  json: { applied: boolean; details?: string };
};

const audit: ResponseFixerSpecialSetting = {
  type: "response_fixer",
  scope: "response",
  hit: false,
  fixersApplied: [],
  totalBytesProcessed: 0,
  processingTimeMs: 0,
};
```

整流结果通过 `persistSpecialSettings` 持久化到 Redis 和数据库。

## Node.js 流到 Web Stream 转换

### 安全流转换

项目包含从 Node.js 流到 Web Streams 的容错转换：

```typescript
// src/app/v1/_lib/proxy/forwarder.ts
private static nodeStreamToWebStreamSafe(
  nodeStream: Readable,
  providerId: number,
  providerName: string
): ReadableStream<Uint8Array> {
  let chunkCount = 0;
  let totalBytes = 0;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
        chunkCount++;
        totalBytes += chunk.length;
        try {
          const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          controller.enqueue(buf);
        } catch {
          // 如果 controller 已关闭则忽略
        }
      });

      nodeStream.on("end", () => {
        try {
          controller.close();
        } catch {
          // 如果已关闭则忽略
        }
      });

      // 关键：吞掉错误事件，避免 "terminated" 冒泡
      nodeStream.on("error", (err) => {
        logger.warn("ProxyForwarder: Upstream stream error (gracefully closed)", {
          providerId,
          providerName,
          error: err.message,
        });
        try {
          controller.close();
        } catch {
          // 如果已关闭则忽略
        }
      });
    },

    cancel(reason) {
      try {
        nodeStream.destroy(
          reason instanceof Error ? reason : reason ? new Error(String(reason)) : undefined
        );
      } catch {
        // ignore
      }
    },
  });
}
```

此转换对于处理 undici HTTP 客户端返回的 Node.js 流至关重要，这些流必须转换为 Web Streams 才能用于代理响应。

### 使用 undici 绕过自动解压

为避免 undici fetch 的自动解压导致的 "TypeError: terminated" 错误，项目使用 `fetchWithoutAutoDecode` 方法：

```typescript
// 始终使用容错流处理以减少 "TypeError: terminated" 错误
const useErrorTolerantFetch = true;

let response: Response;
if (useErrorTolerantFetch) {
  response = await ProxyForwarder.fetchWithoutAutoDecode(
    proxyUrl,
    init,
    provider.id,
    provider.name,
    session
  );
} else {
  response = await fetch(proxyUrl, init);
}
```

`fetchWithoutAutoDecode` 使用 undici 的 `request` API 获取原始流，手动处理 gzip 解压，并通过 `nodeStreamToWebStreamSafe` 实现容错转换。

## 总结

Claude Code Hub 的流式响应处理系统展示了用于实时 AI 模型代理的复杂工程：

1. **协议合规**: 完整的 SSE 协议支持，兼容多供应商格式
2. **性能**: 高效的块缓冲，增量处理复杂度为 O(1)
3. **可靠性**: 全面的错误处理，防止孤儿记录
4. **可观测性**: 详细的审计追踪，便于调试和监控
5. **安全性**: 内存边界、空闲超时和熔断器集成
6. **灵活性**: 供应商与客户端格式间的实时格式转换

该架构成功平衡了低延迟客户端交付与可靠的后台处理，确保流式响应既快速又能正确追踪用于计费和分析。

## 文件参考

- `src/lib/utils/sse.ts` - 核心 SSE 解析工具
- `src/lib/provider-testing/utils/sse-collector.ts` - 多供应商 SSE 文本提取
- `src/app/v1/_lib/proxy/response-handler.ts` - 主响应处理逻辑
- `src/app/v1/_lib/proxy/response-fixer/index.ts` - 响应整流与 ChunkBuffer
- `src/app/v1/_lib/proxy/response-fixer/sse-fixer.ts` - SSE 格式整流器
- `src/app/v1/_lib/proxy/forwarder.ts` - 请求转发与流转换
- `src/app/v1/_lib/proxy/errors.ts` - 错误分类与处理
- `src/lib/async-task-manager.ts` - 异步数据库写入缓冲
- `src/drizzle/schema.ts` - 数据库模式定义（含 streamingIdleTimeoutMs）
