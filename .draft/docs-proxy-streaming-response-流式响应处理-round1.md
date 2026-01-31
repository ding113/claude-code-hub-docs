# Streaming Response Handling - Technical Exploration Draft

## Overview

The claude-code-hub project implements a sophisticated streaming response handling system that supports Server-Sent Events (SSE) for real-time AI model responses. This document explores the technical architecture, implementation details, and data flow for streaming responses within the proxy layer.

## Table of Contents

1. [SSE Protocol Implementation](#sse-protocol-implementation)
2. [Stream Detection and Routing](#stream-detection-and-routing)
3. [Chunk Processing and Buffer Management](#chunk-processing-and-buffer-management)
4. [Client-Server Streaming Flow](#client-server-streaming-flow)
5. [Format Transformation in Streams](#format-transformation-in-streams)
6. [Error Handling in Streaming Contexts](#error-handling-in-streaming-contexts)
7. [Idle Timeout and Stream Lifecycle](#idle-timeout-and-stream-lifecycle)
8. [Response Fixer Integration](#response-fixer-integration)

---

## SSE Protocol Implementation

### Core SSE Parsing Utilities

The project provides robust SSE parsing capabilities through `src/lib/utils/sse.ts`. This module handles the standard SSE format where events are delimited by double newlines and consist of `event:` and `data:` fields.

```typescript
// From src/lib/utils/sse.ts
export function parseSSEData(sseText: string): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = [];
  let eventName = "";
  let dataLines: string[] = [];

  const flushEvent = () => {
    // Support pure data: format without event: prefix (Gemini streaming)
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

  // ... parsing logic
}
```

The parser is designed to handle multiple SSE formats:
- Standard SSE with `event:` and `data:` fields
- Pure `data:` format (used by Gemini streaming responses)
- Multi-line data payloads
- Comment lines starting with `:`

### SSE Detection

The system uses strict detection to identify SSE streams, avoiding false positives from JSON that happens to contain "data:" substrings:

```typescript
// From src/lib/utils/sse.ts
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

### Multi-Provider SSE Support

The SSE collector in `src/lib/provider-testing/utils/sse-collector.ts` supports extracting text content from multiple provider formats:

- **Anthropic format**: `{"delta":{"text":"..."}}`
- **OpenAI format**: `{"choices":[{"delta":{"content":"..."}}]}`
- **Codex Response API**: `{"output":[{"content":[{"text":"..."}]}]}`

This multi-format support allows the system to work with various AI providers while maintaining a consistent internal representation.

---

## Stream Detection and Routing

### Content-Type Based Detection

The proxy layer detects streaming responses by examining the `Content-Type` header:

```typescript
// From src/app/v1/_lib/proxy/response-handler.ts
const contentType = fixedResponse.headers.get("content-type") || "";
const isSSE = contentType.includes("text/event-stream");

if (!isSSE) {
  return await ProxyResponseHandler.handleNonStream(session, fixedResponse);
}

return await ProxyResponseHandler.handleStream(session, fixedResponse);
```

This detection occurs in the `ProxyResponseHandler.dispatch` method, which serves as the entry point for response processing. The dispatcher routes responses to either `handleNonStream` or `handleStream` based on this detection.

### Response Handler Architecture

The `ProxyResponseHandler` class provides two primary handling paths:

1. **`handleNonStream`**: Processes complete JSON responses for non-streaming requests
2. **`handleStream`**: Manages SSE streaming responses with real-time processing

Both paths support format transformation when the provider's native format differs from the client's expected format.

---

## Chunk Processing and Buffer Management

### ChunkBuffer Implementation

The `ChunkBuffer` class in `src/app/v1/_lib/proxy/response-fixer/index.ts` provides efficient buffering for stream processing:

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

    // Handle cross-chunk CRLF: if previous chunk ended with CR,
    // check if current chunk starts with LF
    if (this.pendingCR) {
      this.processableEnd = chunk[0] === LF_BYTE ? prevTotal + 1 : prevTotal;
      this.pendingCR = false;
    }

    // Incrementally maintain "processable end" index
    // Avoids O(n^2) full scan on each chunk
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
      // Chunk ends with CR: wait for next chunk to confirm CRLF
      this.pendingCR = true;
    }
  }
}
```

Key features of the ChunkBuffer:
- **Incremental processing**: Only scans newly added chunks
- **CRLF handling**: Properly handles line endings split across chunks
- **Memory efficiency**: Periodically cleans up consumed chunks
- **DoS protection**: Maximum buffer size prevents unbounded memory growth

### Memory Safety

The buffer includes safety mechanisms to prevent memory exhaustion:

```typescript
// Safety protection: if upstream doesn't output newlines for a long time,
// buffer will grow continuously, potentially causing unbounded memory growth.
// After reaching the limit, degrade to passthrough mode.
if (buffer.length + chunk.length > maxBufferBytes) {
  passthrough = true;
  buffer.flushTo(controller);
  controller.enqueue(chunk);
  return;
}
```

When the buffer exceeds `maxBufferBytes` (default 1MB), the system switches to passthrough mode, forwarding chunks without processing to avoid memory issues.

---

## Client-Server Streaming Flow

### Request Flow Overview

1. **Client Request** → Proxy Handler
2. **Proxy Handler** → Forwarder (with retry logic)
3. **Forwarder** → Upstream Provider
4. **Provider Response** → Response Handler
5. **Response Handler** → Client (streaming) + Background Processing

### Stream Tee Pattern

A critical aspect of the streaming architecture is the use of the tee pattern to split the stream for concurrent client delivery and background processing:

```typescript
// From src/app/v1/_lib/proxy/response-handler.ts
// Use TransformStream wrapper to enable closing client stream on idle timeout
// Solves the issue where internalStream abort doesn't affect clientStream after tee()
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

The tee operation creates two independent streams:
- **`clientStream`**: Sent directly to the client for real-time display
- **`internalStream`**: Consumed by background tasks for statistics, cost calculation, and persistence

### Background Processing

The internal stream is processed asynchronously:

```typescript
const processingPromise = (async () => {
  const reader = internalStream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let usageForCost: UsageMetrics | null = null;
  let isFirstChunk = true;

  try {
    while (true) {
      // Check cancellation signal
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
        
        // Reset idle timer on each data receipt
        startIdleTimer();
        
        // Clear response timeout on first chunk
        if (isFirstChunk) {
          session.recordTtfb();
          isFirstChunk = false;
          // ... clear timeout
        }
      }
    }
    
    // Finalize: join chunks, extract usage, update database
    const allContent = flushAndJoin();
    await finalizeStream(allContent);
  } finally {
    // Resource cleanup
    clearIdleTimer();
    reader.releaseLock();
    AsyncTaskManager.cleanup(taskId);
  }
})();
```

### Async Task Management

Background processing is registered with the `AsyncTaskManager` to ensure proper lifecycle management:

```typescript
AsyncTaskManager.register(taskId, processingPromise, "stream-processing");
processingPromise.catch(async (error) => {
  logger.error("ResponseHandler: Uncaught error in stream processing", {
    taskId,
    messageId: messageContext.id,
    error,
  });
  // Persist failure to avoid orphan records
  await persistRequestFailure({ /* ... */ });
});
```

---

## Format Transformation in Streams

### Real-time Stream Transformation

When the provider's format differs from the client's expected format, the system applies transformations in real-time using `TransformStream`:

```typescript
// From src/app/v1/_lib/proxy/response-handler.ts
if (needsTransform && defaultRegistry.hasResponseTransformer(fromFormat, toFormat)) {
  const transformState: TransformState = {};
  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      try {
        const decoder = new TextDecoder();
        const text = decoder.decode(chunk, { stream: true });

        // Transform chunk using registry
        const transformedChunks = defaultRegistry.transformStreamResponse(
          session.context,
          fromFormat,
          toFormat,
          session.request.model || "",
          session.request.message,
          session.request.message,
          text,
          transformState
        );

        for (const transformedChunk of transformedChunks) {
          if (transformedChunk) {
            controller.enqueue(new TextEncoder().encode(transformedChunk));
          }
        }
      } catch (error) {
        logger.error("[ResponseHandler] Stream transform error:", error);
        // On error, pass original chunk
        controller.enqueue(chunk);
      }
    },
  });

  processedStream = response.body.pipeThrough(transformStream);
}
```

### Gemini Stream Transformation

Gemini responses require special handling due to their unique format:

```typescript
// Gemini stream transformation
let buffer = "";
const transformStream = new TransformStream<Uint8Array, Uint8Array>({
  transform(chunk, controller) {
    const decoder = new TextDecoder();
    const text = decoder.decode(chunk, { stream: true });
    buffer += text;

    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep last line as it might be incomplete

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("data:")) {
        const jsonStr = trimmedLine.slice(5).trim();
        if (!jsonStr) continue;
        try {
          const geminiResponse = JSON.parse(jsonStr) as GeminiResponse;
          const openAIChunk = GeminiAdapter.transformResponse(geminiResponse, true);
          const output = `data: ${JSON.stringify(openAIChunk)}\n\n`;
          controller.enqueue(new TextEncoder().encode(output));
        } catch {
          // Ignore parse errors
        }
      }
    }
  },
  flush(controller) {
    // Process any remaining buffer content
    if (buffer.trim().startsWith("data:")) {
      try {
        const jsonStr = buffer.trim().slice(5).trim();
        const geminiResponse = JSON.parse(jsonStr) as GeminiResponse;
        const openAIChunk = GeminiAdapter.transformResponse(geminiResponse, true);
        const output = `data: ${JSON.stringify(openAIChunk)}\n\n`;
        controller.enqueue(new TextEncoder().encode(output));
      } catch {}
    }
  },
});
```

The `flush` method ensures that any partial data remaining in the buffer when the stream ends is properly processed.

---

## Error Handling in Streaming Contexts

### Error Classification

The system classifies errors during streaming into distinct categories:

```typescript
// From src/app/v1/_lib/proxy/errors.ts
export enum ErrorCategory {
  PROVIDER_ERROR,           // Provider issues (4xx/5xx HTTP errors)
  SYSTEM_ERROR,             // System/network issues (fetch network exceptions)
  CLIENT_ABORT,             // Client-initiated abort
  NON_RETRYABLE_CLIENT_ERROR, // Client input errors
  RESOURCE_NOT_FOUND,       // Upstream 404 errors
}
```

### Streaming-Specific Error Handling

In streaming contexts, errors are handled differently depending on their source:

```typescript
// From src/app/v1/_lib/proxy/response-handler.ts
try {
  while (true) {
    // ... read loop
  }
} catch (error) {
  const err = error as Error;
  const clientAborted = session.clientAbortSignal?.aborted ?? false;
  const isResponseControllerAborted =
    sessionWithController.responseController?.signal.aborted ?? false;

  if (isClientAbortError(err)) {
    // Distinguish between different timeout sources
    const isResponseTimeout = isResponseControllerAborted && !clientAborted;
    const isIdleTimeout = err.message?.includes("streaming_idle");

    if (isResponseTimeout && !isIdleTimeout) {
      // Response timeout (first byte timeout): record in circuit breaker
      logger.error("ResponseHandler: Response timeout during stream body read", {
        taskId,
        providerId: provider.id,
        chunksCollected: chunks.length,
      });
      await recordFailure(provider.id, err);
      await persistRequestFailure({ /* ... */ });
    } else if (isIdleTimeout) {
      // Idle timeout: record in circuit breaker
      logger.error("ResponseHandler: Streaming idle timeout", {
        taskId,
        providerId: provider.id,
        chunksCollected: chunks.length,
      });
      await recordFailure(provider.id, err);
      await persistRequestFailure({ /* ... */ });
    } else if (!clientAborted) {
      // Upstream stream aborted unexpectedly
      logger.error("ResponseHandler: Upstream stream aborted unexpectedly", {
        taskId,
        providerId: provider.id,
        chunksCollected: chunks.length,
      });
      await persistRequestFailure({ /* ... */ });
    } else {
      // Client-initiated abort: normal log, don't throw
      logger.warn("ResponseHandler: Stream reading aborted by client", {
        taskId,
        providerId: provider.id,
        chunksCollected: chunks.length,
      });
    }
  }
}
```

### Client Disconnection Handling

When a client disconnects, the system performs cleanup:

```typescript
// From src/app/v1/_lib/proxy/response-handler.ts
if (session.clientAbortSignal) {
  session.clientAbortSignal.addEventListener("abort", () => {
    logger.debug("ResponseHandler: Client disconnected, cleaning up", {
      taskId,
      providerId: provider.id,
    });

    // 1. Clear idle timeout (prevent false triggers)
    if (idleTimeoutId) {
      clearTimeout(idleTimeoutId);
      idleTimeoutId = null;
    }

    // 2. Cancel background task
    AsyncTaskManager.cancel(taskId);
    abortController.abort();

    // Note: No need for streamController.error() (client already disconnected)
    // Note: No need for responseController.abort() (upstream will end naturally)
  });
}
```

### Orphan Record Prevention

A critical aspect of error handling is preventing "orphan records" - database entries that remain in an incomplete state. The system uses `persistRequestFailure` to ensure records are updated even when errors occur:

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

---

## Idle Timeout and Stream Lifecycle

### Streaming Idle Timeout

The streaming idle timeout mechanism monitors for stalls during stream processing:

```typescript
// From src/app/v1/_lib/proxy/response-handler.ts
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

    // 1. Close client stream
    try {
      if (streamController) {
        streamController.error(new Error("Streaming idle timeout"));
      }
    } catch (e) {
      logger.warn("ResponseHandler: Failed to close client stream", { error: e });
    }

    // 2. Abort upstream connection
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

    // 3. Abort background reading task
    abortController.abort(new Error("streaming_idle"));
  }, idleTimeoutMs);
};
```

### Idle Timer Lifecycle

The idle timer follows a specific lifecycle:

1. **Not started** during initial connection (avoid overlapping with first-byte timeout)
2. **Started** upon receiving the first chunk of data
3. **Reset** on each subsequent chunk receipt
4. **Cleared** when the stream completes or errors

This design ensures that the idle timeout only detects mid-stream stalls, not slow initial connections.

### Provider-Level Configuration

The idle timeout is configurable per provider via the `streamingIdleTimeoutMs` field:

```typescript
// From src/drizzle/schema.ts
streamingIdleTimeoutMs: integer('streaming_idle_timeout_ms').notNull().default(0),
```

A value of `0` disables the idle timeout for that provider.

---

## Response Fixer Integration

### Stream Processing with Response Fixer

The `ResponseFixer` provides real-time correction of malformed responses:

```typescript
// From src/app/v1/_lib/proxy/response-fixer/index.ts
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

      // Safety: switch to passthrough if buffer grows too large
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

      // Apply fixers in sequence
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
      // Process any remaining buffer content
      if (buffer.length > 0) {
        let data: Uint8Array = buffer.drain();
        // Apply fixers...
        controller.enqueue(data);
      }
      // Persist audit information
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

### Fixer Types

The response fixer supports three types of corrections:

1. **Encoding Fixer**: Corrects character encoding issues (e.g., GBK misinterpreted as UTF-8)
2. **SSE Fixer**: Repairs malformed SSE formatting
3. **JSON Fixer**: Fixes truncated JSON in SSE data lines

### Audit Trail

All fixer operations are recorded for debugging and monitoring:

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

---

## Node.js to Web Stream Conversion

### Safe Stream Conversion

The project includes a fault-tolerant conversion from Node.js streams to Web Streams:

```typescript
// From src/app/v1/_lib/proxy/forwarder.ts
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
          // Ignore if controller already closed
        }
      });

      nodeStream.on("end", () => {
        try {
          controller.close();
        } catch {
          // Ignore if already closed
        }
      });

      // Key: swallow error events to prevent "terminated" from bubbling
      nodeStream.on("error", (err) => {
        logger.warn("ProxyForwarder: Upstream stream error (gracefully closed)", {
          providerId,
          providerName,
          error: err.message,
        });
        try {
          controller.close();
        } catch {
          // Ignore if already closed
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

This conversion is critical for handling responses from the undici HTTP client, which returns Node.js streams that must be converted to Web Streams for the proxy response.

---

## Summary

The streaming response handling system in claude-code-hub demonstrates sophisticated engineering for real-time AI model proxying:

1. **Protocol Compliance**: Full SSE protocol support with multi-provider format compatibility
2. **Performance**: Efficient chunk buffering with O(1) incremental processing
3. **Reliability**: Comprehensive error handling with orphan record prevention
4. **Observability**: Detailed audit trails for debugging and monitoring
5. **Safety**: Memory bounds, idle timeouts, and circuit breaker integration
6. **Flexibility**: Real-time format transformation between provider and client formats

The architecture successfully balances low-latency client delivery with reliable background processing, ensuring that streaming responses are both fast and correctly tracked for billing and analytics purposes.

---

## File References

- `src/lib/utils/sse.ts` - Core SSE parsing utilities
- `src/lib/provider-testing/utils/sse-collector.ts` - Multi-provider SSE text extraction
- `src/app/v1/_lib/proxy/response-handler.ts` - Main response handling logic
- `src/app/v1/_lib/proxy/response-fixer/index.ts` - Response fixing with ChunkBuffer
- `src/app/v1/_lib/proxy/forwarder.ts` - Request forwarding and stream conversion
- `src/app/v1/_lib/proxy/errors.ts` - Error classification and handling
- `src/repository/message-write-buffer.ts` - Async database write buffering

---

*This exploration draft is based on the actual implementation in the claude-code-hub project as of the analysis date.*
