# Sensitive Words Detection - Round 2 Verified Draft

## Verification Summary

**Review Date**: 2026-01-29
**Reviewer**: Round 2 Review Agent
**Status**: All claims verified against actual codebase

### Files Verified
| File | Exists | Lines Match | Content Verified |
|------|--------|-------------|------------------|
| `src/lib/sensitive-word-detector.ts` | Yes | 190 lines | Yes |
| `src/app/v1/_lib/proxy/sensitive-word-guard.ts` | Yes | 149 lines | Yes |
| `src/lib/message-extractor.ts` | Yes | 173 lines | Yes |
| `src/repository/sensitive-words.ts` | Yes | 128 lines | Yes |
| `src/actions/sensitive-words.ts` | Yes | 262 lines | Yes |
| `src/drizzle/schema.ts` (lines 539-552) | Yes | Correct | Yes |
| `src/app/v1/_lib/proxy/guard-pipeline.ts` | Yes | 204 lines | Yes |
| `drizzle/0003_outstanding_centennial.sql` | Yes | 14 lines | Yes |

### Admin UI Components Verified
- `page.tsx` - Main admin page
- `add-word-dialog.tsx` - Add word dialog
- `edit-word-dialog.tsx` - Edit word dialog
- `word-list-table.tsx` - Words table
- `refresh-cache-button.tsx` - Cache refresh button
- `sensitive-words-skeleton.tsx` - Loading skeleton

### i18n Files Verified (5 languages)
- `messages/zh-CN/settings/sensitiveWords.json`
- `messages/zh-TW/settings/sensitiveWords.json`
- `messages/en/settings/sensitiveWords.json`
- `messages/ja/settings/sensitiveWords.json`
- `messages/ru/settings/sensitiveWords.json`

---

## Intent Analysis

### What is Sensitive Word Detection?

The sensitive word detection system in claude-code-hub is a content moderation feature designed to intercept AI API requests containing prohibited or sensitive content before they reach upstream LLM providers. This system acts as a protective layer that:

1. **Prevents forwarding** of requests containing sensitive words to upstream providers
2. **Avoids billing** for blocked requests (cost is set to "0" for intercepted requests)
3. **Logs blocked requests** for audit and monitoring purposes with detailed match information
4. **Returns clear error messages** to users explaining why their request was blocked

### Purpose and Design Philosophy

The system is intentionally designed with simplicity and performance in mind. Unlike complex content moderation systems that might use machine learning or sophisticated algorithms like DFA (Deterministic Finite Automaton), Trie trees, or Aho-Corasick algorithms, this implementation prioritizes:

- **Maintainability**: Simple, easy-to-understand code
- **Performance**: Fast detection for typical use cases (< 1000 words)
- **Reliability**: Fail-safe behavior that doesn't block legitimate requests
- **Flexibility**: Three different match types to handle various scenarios

### Position in Request Pipeline

Sensitive word detection occurs early in the request processing pipeline, specifically:

- **After authentication**: Only authenticated requests are checked
- **Before client guard**: Prevents further processing for blocked requests
- **Before rate limiting**: Prevents rate limit consumption for blocked requests
- **Before provider selection**: No upstream provider is contacted for blocked requests
- **Before billing**: Blocked requests are not charged

This positioning ensures that blocked requests consume minimal system resources.

---

## Behavior Summary

### Detection Flow

```
1. Request Received (POST /v1/messages)
        |
2. ProxyHandler.handleProxyRequest()
        |
3. GuardPipeline.run() - CHAT_PIPELINE order:
   - auth -> sensitive -> client -> model -> version -> probe -> session
   - warmup -> requestFilter -> rateLimit -> provider -> providerRequestFilter
   - messageContext
        |
4. ProxySensitiveWordGuard.ensure(session)
   |-- Skip if cache is empty (fast path)
   |-- extractTextFromMessages() - Extracts text from:
   |     * system field (string or array)
   |     * messages array (role='user' only)
   |     * input field (Response API format)
   |-- sensitiveWordDetector.detect(text) for each text
   |     |-- Contains match (O(n*m)) - fastest, checked first
   |     |-- Exact match (Set lookup O(1))
   |     +-- Regex match (RegExp.exec) - slowest, checked last
   +-- If matched:
        * Log warning with match details
        * Log to database (async, non-blocking)
        * Return 400 error response
        |
5. If blocked: Return error response immediately
   If passed: Continue to next guard (client, model, etc.)
```

### Three-Tier Matching Strategy

The system uses a three-tier matching strategy optimized for different use cases:

#### 1. Contains Match (Substring Matching)
- **Algorithm**: `String.prototype.includes()`
- **Complexity**: O(n*m) where n=number of words, m=text length
- **Data Structure**: `string[]` (array)
- **Use Case**: General keyword filtering where the word can appear anywhere in the text
- **Example**: Word "spam" matches "This is spam content"

#### 2. Exact Match
- **Algorithm**: `Set.prototype.has()`
- **Complexity**: O(1) average case
- **Data Structure**: `Set<string>`
- **Use Case**: Matching complete phrases or words exactly
- **Example**: Word "exact phrase" only matches "exact phrase", not "this exact phrase here"

#### 3. Regex Match
- **Algorithm**: `RegExp.prototype.exec()`
- **Complexity**: Varies by pattern complexity
- **Data Structure**: `Array<{pattern: RegExp, word: string}>`
- **Use Case**: Complex patterns, character variations, obfuscation detection
- **Example**: Pattern `b[a@4]d[wW]o[rR]d` matches variations like "badword", "b@dword", "b4dWord"

### Detection Order

The system checks matches in order of performance:

1. **Contains matching first** - Fastest for common cases
2. **Exact matching second** - O(1) lookup
3. **Regex matching last** - Most flexible but slowest

This order ensures that the most common and fastest checks happen first, with early exit on the first match.

### Text Extraction

The system extracts text from multiple sources in the request:

**File**: `src/lib/message-extractor.ts` (lines 149-172)

```typescript
export function extractTextFromMessages(message: Record<string, unknown>): string[] {
  const texts: string[] = [];

  // 1. Extract system prompts
  if ("system" in message) {
    const systemTexts = extractSystemText(message.system);
    texts.push(...systemTexts);
  }

  // 2. Extract user messages (Request API format)
  if ("messages" in message && Array.isArray(message.messages)) {
    const messageTexts = extractMessagesText(message.messages);
    texts.push(...messageTexts);
  }

  // 3. Extract input (Response API format)
  if ("input" in message && Array.isArray(message.input)) {
    const inputTexts = extractInputText(message.input);
    texts.push(...inputTexts);
  }

  // Filter empty strings
  return texts.filter((t) => t.length > 0);
}
```

Key behaviors:
- Only extracts text from `role='user'` messages (not assistant responses)
- Supports both Anthropic Messages API and OpenAI-compatible formats
- Handles text blocks with `type`/`content` fields
- Filters out empty strings

### Response When Blocked

When a sensitive word is detected, the system:

1. **Logs a warning** with user ID, key ID, session ID, and match details
2. **Records to database** asynchronously (doesn't block response)
3. **Returns a 400 error** with detailed message including:
   - The matched sensitive word
   - The matched text (with context)
   - The match type (contains/exact/regex)
   - Instructions to modify and retry

**File**: `src/app/v1/_lib/proxy/sensitive-word-guard.ts` (lines 121-147)

```typescript
private static buildErrorMessage(result: {
  word?: string;
  matchType?: string;
  matchedText?: string;
}): string {
  const parts: string[] = [];

  parts.push(`请求包含敏感词："${result.word}"`);

  if (result.matchedText && result.matchedText !== result.word) {
    parts.push(`匹配内容："${result.matchedText}"`);
  }

  if (result.matchType) {
    const typeLabels: Record<string, string> = {
      contains: "包含匹配",
      exact: "精确匹配",
      regex: "正则匹配",
    };
    const typeLabel = typeLabels[result.matchType] || result.matchType;
    parts.push(`匹配类型：${typeLabel}`);
  }

  parts.push("请修改后重试。");

  return parts.join("，");
}
```

---

## Config/Commands

### Database Schema

**File**: `src/drizzle/schema.ts` (lines 539-552)

```typescript
// Sensitive Words table
export const sensitiveWords = pgTable('sensitive_words', {
  id: serial('id').primaryKey(),
  word: varchar('word', { length: 255 }).notNull(),
  matchType: varchar('match_type', { length: 20 }).notNull().default('contains'),
  description: text('description'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // Optimized index for enabled status and match type queries
  sensitiveWordsEnabledIdx: index('idx_sensitive_words_enabled').on(table.isEnabled, table.matchType),
  // Basic index
  sensitiveWordsCreatedAtIdx: index('idx_sensitive_words_created_at').on(table.createdAt),
}));
```

**Migration File**: `drizzle/0003_outstanding_centennial.sql`

```sql
CREATE TABLE "sensitive_words" (
    "id" serial PRIMARY KEY NOT NULL,
    "word" varchar(255) NOT NULL,
    "match_type" varchar(20) DEFAULT 'contains' NOT NULL,
    "description" text,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE "message_request" ADD COLUMN "blocked_by" varchar(50);
ALTER TABLE "message_request" ADD COLUMN "blocked_reason" text;

CREATE INDEX "idx_sensitive_words_enabled" ON "sensitive_words" USING btree ("is_enabled","match_type");
CREATE INDEX "idx_sensitive_words_created_at" ON "sensitive_words" USING btree ("created_at");
```

### Repository Layer

**File**: `src/repository/sensitive-words.ts`

The repository provides CRUD operations:

```typescript
// Get all enabled words (for cache loading)
export async function getActiveSensitiveWords(): Promise<SensitiveWord[]>

// Get all words including disabled (for admin UI)
export async function getAllSensitiveWords(): Promise<SensitiveWord[]>

// Create a new sensitive word
export async function createSensitiveWord(data: {
  word: string;
  matchType: "contains" | "exact" | "regex";
  description?: string;
}): Promise<SensitiveWord>

// Update an existing word
export async function updateSensitiveWord(
  id: number,
  data: Partial<{
    word: string;
    matchType: string;
    description: string;
    isEnabled: boolean;
  }>
): Promise<SensitiveWord | null>

// Delete a word
export async function deleteSensitiveWord(id: number): Promise<boolean>
```

### Server Actions

**File**: `src/actions/sensitive-words.ts`

Server actions handle admin operations with validation:

```typescript
// List all words (admin only)
export async function listSensitiveWords(): Promise<repo.SensitiveWord[]>

// Create word with validation (admin only)
export async function createSensitiveWordAction(data: {
  word: string;
  matchType: "contains" | "exact" | "regex";
  description?: string;
}): Promise<ActionResult<repo.SensitiveWord>>

// Update word (admin only)
export async function updateSensitiveWordAction(
  id: number,
  updates: Partial<{
    word: string;
    matchType: string;
    description: string;
    isEnabled: boolean;
  }>
): Promise<ActionResult<repo.SensitiveWord>>

// Delete word (admin only)
export async function deleteSensitiveWordAction(id: number): Promise<ActionResult>

// Refresh cache manually (admin only)
export async function refreshCacheAction(): Promise<
  ActionResult<{ stats: ReturnType<typeof sensitiveWordDetector.getStats> }>
>

// Get cache statistics (admin only)
export async function getCacheStats()
```

### Admin UI Components

**Main Page**: `src/app/[locale]/settings/sensitive-words/page.tsx`

Features:
- List all sensitive words in a table
- Add new words via dialog
- Edit existing words
- Toggle enable/disable status
- Delete words
- Refresh cache with statistics display

**Add Word Dialog**: `src/app/[locale]/settings/sensitive-words/_components/add-word-dialog.tsx`

Form fields:
- **Word** (required): The sensitive word or pattern
- **Match Type** (required): 
  - "contains" - Substring match
  - "exact" - Whole phrase match
  - "regex" - Regular expression pattern
- **Description** (optional): Administrative notes

**Word List Table**: `src/app/[locale]/settings/sensitive-words/_components/word-list-table.tsx`

Columns:
- Word (displayed in monospace font)
- Match Type (with color-coded badges)
- Description
- Status (enable/disable toggle)
- Created At (formatted with timezone)
- Actions (edit, delete)

### Cache Management

**File**: `src/lib/sensitive-word-detector.ts` (lines 36-93)

The cache system:

1. **Loads on demand**: Words are loaded from database when `reload()` is called
2. **Hot reload**: Cache can be refreshed without restarting the application
3. **Fail-safe**: If reload fails, existing cache is preserved
4. **Concurrency protection**: `isLoading` flag prevents concurrent reloads
5. **Case normalization**: All words converted to lowercase for case-insensitive matching

```typescript
async reload(): Promise<void> {
  if (this.isLoading) {
    logger.warn("[SensitiveWordCache] Reload already in progress, skipping");
    return;
  }

  this.isLoading = true;

  try {
    logger.info("[SensitiveWordCache] Reloading sensitive words from database...");

    const words = await getActiveSensitiveWords();

    // Clear old cache
    this.contains = [];
    this.exact.clear();
    this.regex = [];

    // Group by type
    for (const word of words) {
      const lowerWord = word.word.toLowerCase();

      switch (word.matchType) {
        case "contains":
          this.contains.push(lowerWord);
          break;

        case "exact":
          this.exact.add(lowerWord);
          break;

        case "regex":
          try {
            const pattern = new RegExp(word.word, "i");
            this.regex.push({ pattern, word: word.word });
          } catch (error) {
            logger.error(`[SensitiveWordCache] Invalid regex pattern: ${word.word}`, error);
          }
          break;

        default:
          logger.warn(`[SensitiveWordCache] Unknown match type: ${word.matchType}`);
      }
    }

    this.lastReloadTime = Date.now();

    logger.info(
      `[SensitiveWordCache] Loaded ${words.length} sensitive words: ` +
        `contains=${this.contains.length}, exact=${this.exact.size}, regex=${this.regex.length}`
    );
  } catch (error) {
    logger.error("[SensitiveWordCache] Failed to reload sensitive words:", error);
    // Keep existing cache on failure
  } finally {
    this.isLoading = false;
  }
}
```

### Cache Statistics

The system provides cache statistics via `getStats()`:

```typescript
getStats() {
  return {
    containsCount: this.contains.length,
    exactCount: this.exact.size,
    regexCount: this.regex.length,
    totalCount: this.contains.length + this.exact.size + this.regex.length,
    lastReloadTime: this.lastReloadTime,
    isLoading: this.isLoading,
  };
}
```

This is displayed in the admin UI on the refresh cache button.

---

## Edge Cases and Special Behaviors

### 1. Case Insensitivity

All matching is case-insensitive:

```typescript
const lowerText = text.toLowerCase();
const lowerWord = word.word.toLowerCase();
```

This means:
- "Spam", "SPAM", and "spam" are all equivalent
- Regex patterns use the "i" flag for case-insensitive matching

### 2. Empty Cache Behavior

If the cache is empty (no sensitive words configured), the system bypasses detection entirely:

```typescript
// Fast path: if cache is empty, allow immediately
if (sensitiveWordDetector.isEmpty()) {
  return null;
}
```

This provides a performance optimization when the feature is not in use.

### 3. Detection Failure Handling

If detection throws an error, the system fails open (allows the request):

```typescript
try {
  // ... detection logic ...
} catch (error) {
  logger.error("[SensitiveWordGuard] Detection error:", error);
  return null; // Degrade: allow on detection failure
}
```

This ensures that bugs in the detection system don't block all requests.

### 4. Regex Validation

Invalid regex patterns are handled gracefully:

```typescript
case "regex":
  try {
    const pattern = new RegExp(word.word, "i");
    this.regex.push({ pattern, word: word.word });
  } catch (error) {
    logger.error(`[SensitiveWordCache] Invalid regex pattern: ${word.word}`, error);
  }
  break;
```

Invalid patterns are logged and skipped, not loaded into cache.

### 5. Database Logging Failure

If logging a blocked request to the database fails, the block still occurs:

```typescript
// Log to database (async, non-blocking)
void ProxySensitiveWordGuard.logBlockedRequest(session, result);
```

The `void` keyword ensures the promise is not awaited, so database failures don't affect the response.

### 6. Text Extraction Edge Cases

The message extractor handles various formats:

- **String content**: `"content": "hello world"`
- **Array content**: `"content": [{"type": "text", "text": "hello"}]`
- **System prompts**: Can be string or array
- **Empty/null values**: Filtered out
- **Non-user roles**: Only `role='user'` messages are checked

### 7. Match Context Extraction

For contains matches, the system extracts context around the match:

```typescript
private extractMatchedText(text: string, word: string): string {
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(word.toLowerCase());

  if (index === -1) {
    return text.substring(0, 50); // Fallback: first 50 chars
  }

  // Extract 20 chars before and after
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + word.length + 20);
  const snippet = text.substring(start, end);

  return start > 0 ? `...${snippet}` : snippet;
}
```

This helps administrators understand what triggered the match.

### 8. Concurrent Reload Protection

The cache prevents concurrent reloads:

```typescript
if (this.isLoading) {
  logger.warn("[SensitiveWordCache] Reload already in progress, skipping");
  return;
}
```

This prevents race conditions when multiple admins modify words simultaneously.

### 9. No Fuzzy Matching

The system does NOT implement:
- Edit distance (Levenshtein distance)
- Phonetic matching (Soundex, Metaphone)
- Semantic similarity
- ML-based detection

Users must define explicit patterns (or use regex for variations).

### 10. Word Boundary Considerations

The "contains" match type matches substrings anywhere:

- Word "cat" matches "category" (may be unintended)
- Word "the" matches "then", "there", "other" (likely unintended)

To match whole words only, use regex with word boundaries:
- Pattern: `\bword\b` (matches "word" but not "sword" or "wording")

### 11. Unicode and Internationalization

The system uses JavaScript's built-in string methods which handle Unicode:

- Case folding works for basic multilingual plane characters
- No special normalization (NFC/NFKC) is applied
- Emoji and special characters are preserved

### 12. Performance Limits

There are no explicit limits on:
- Text length (limited by Node.js/V8 string max length)
- Number of sensitive words (limited by available memory)
- Regex pattern complexity

However, the linear scan for "contains" matching means performance degrades with:
- Very large text (O(m) per word)
- Many contains-type words (O(n) words)

### 13. count_tokens Requests Exemption

The `COUNT_TOKENS_PIPELINE` does NOT include sensitive word detection:

```typescript
export const COUNT_TOKENS_PIPELINE: GuardConfig = {
  // Minimal chain for count_tokens: no session, no sensitive, no rate limit, no message logging
  steps: [
    "auth",
    "client",
    "model",
    "version",
    "probe",
    "requestFilter",
    "provider",
    "providerRequestFilter",
  ],
};
```

This is intentional - token counting should work even for content that would be blocked.

### 14. Blocked Request Database Records

Blocked requests are recorded with special values:

```typescript
await db.insert(messageRequest).values({
  providerId: 0, // Special value: indicates blocked
  userId: session.authState.user.id,
  key: session.authState.apiKey,
  model: session.request.model ?? undefined,
  sessionId: session.sessionId ?? undefined,
  statusCode: 400,
  costUsd: "0", // No charge
  blockedBy: "sensitive_word",
  blockedReason: JSON.stringify({
    word: result.word,
    matchType: result.matchType,
    matchedText: result.matchedText,
  }),
  errorMessage: `请求包含敏感词："${result.word}"`,
});
```

These records can be identified by `provider_id = 0` and `blocked_by = 'sensitive_word'`.

---

## References

### Core Implementation Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/lib/sensitive-word-detector.ts` | Core detection engine with caching | 190 |
| `src/app/v1/_lib/proxy/sensitive-word-guard.ts` | Proxy guard integrating detection | 149 |
| `src/lib/message-extractor.ts` | Text extraction from messages | 173 |
| `src/repository/sensitive-words.ts` | Database repository for CRUD | 128 |
| `src/actions/sensitive-words.ts` | Server actions for admin UI | 262 |
| `src/drizzle/schema.ts` | Database schema definition | Lines 539-552 |
| `src/app/v1/_lib/proxy/guard-pipeline.ts` | Pipeline configuration | 204 |

### Admin UI Files

| File | Purpose |
|------|---------|
| `src/app/[locale]/settings/sensitive-words/page.tsx` | Main admin page |
| `src/app/[locale]/settings/sensitive-words/_components/add-word-dialog.tsx` | Add word dialog |
| `src/app/[locale]/settings/sensitive-words/_components/edit-word-dialog.tsx` | Edit word dialog |
| `src/app/[locale]/settings/sensitive-words/_components/word-list-table.tsx` | Words table |
| `src/app/[locale]/settings/sensitive-words/_components/refresh-cache-button.tsx` | Cache refresh button |
| `src/app/[locale]/settings/sensitive-words/_components/sensitive-words-skeleton.tsx` | Loading skeleton |

### Database Files

| File | Purpose |
|------|---------|
| `drizzle/0003_outstanding_centennial.sql` | Migration creating sensitive_words table |

### i18n Files

| File | Language |
|------|----------|
| `messages/zh-CN/settings/sensitiveWords.json` | Chinese (Simplified) |
| `messages/zh-TW/settings/sensitiveWords.json` | Chinese (Traditional) |
| `messages/en/settings/sensitiveWords.json` | English |
| `messages/ja/settings/sensitiveWords.json` | Japanese |
| `messages/ru/settings/sensitiveWords.json` | Russian |

### Key Code Snippets

**Detection Logic** (lines 101-145 in sensitive-word-detector.ts):

```typescript
detect(text: string): DetectionResult {
  if (!text || text.length === 0) {
    return { matched: false };
  }

  const lowerText = text.toLowerCase();
  const trimmedText = lowerText.trim();

  // 1. Contains match (fastest, O(n*m))
  for (const word of this.contains) {
    if (lowerText.includes(word)) {
      return {
        matched: true,
        word,
        matchType: "contains",
        matchedText: this.extractMatchedText(text, word),
      };
    }
  }

  // 2. Exact match (Set lookup, O(1))
  if (this.exact.has(trimmedText)) {
    return {
      matched: true,
      word: trimmedText,
      matchType: "exact",
      matchedText: text.trim(),
    };
  }

  // 3. Regex match (slowest but most flexible)
  for (const { pattern, word } of this.regex) {
    const match = pattern.exec(text);
    if (match) {
      return {
        matched: true,
        word,
        matchType: "regex",
        matchedText: match[0],
      };
    }
  }

  return { matched: false };
}
```

**Guard Pipeline Position** (lines 172-189 in guard-pipeline.ts):

```typescript
export const CHAT_PIPELINE: GuardConfig = {
  // Full guard chain for normal chat requests
  steps: [
    "auth",
    "sensitive",  // Sensitive word check happens 2nd (after auth)
    "client",
    "model",
    "version",
    "probe",
    "session",
    "warmup",
    "requestFilter",
    "rateLimit",
    "provider",
    "providerRequestFilter",
    "messageContext",
  ],
};
```

**Database Schema** (lines 539-552 in schema.ts):

```typescript
// Sensitive Words table
export const sensitiveWords = pgTable('sensitive_words', {
  id: serial('id').primaryKey(),
  word: varchar('word', { length: 255 }).notNull(),
  matchType: varchar('match_type', { length: 20 }).notNull().default('contains'),
  description: text('description'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // Optimized index for enabled status and match type queries
  sensitiveWordsEnabledIdx: index('idx_sensitive_words_enabled').on(table.isEnabled, table.matchType),
  // Basic index
  sensitiveWordsCreatedAtIdx: index('idx_sensitive_words_created_at').on(table.createdAt),
}));
```

---

## Summary

The claude-code-hub sensitive word detection system is a pragmatic, performance-focused content moderation solution that prioritizes simplicity and reliability over sophisticated algorithms. It uses a three-tier matching strategy (contains/exact/regex) with optimized detection order, in-memory caching with hot reload capability, and comprehensive admin UI for management. The system is designed to fail safely, handle edge cases gracefully, and integrate seamlessly into the request processing pipeline.

**Key Takeaways:**
1. Simple but effective - no DFA/Trie/Aho-Corasick, just optimized string operations
2. Three match types for different use cases
3. Early detection in pipeline (after auth, before client/model guards)
4. No billing for blocked requests
5. Comprehensive logging and audit trail
6. Admin UI with real-time cache management
7. Fail-safe behavior throughout

---

## Round 2 Corrections Made

1. **Line number correction**: Detection logic ends at line 145, not 144 (minor)
2. **Pipeline position clarification**: Sensitive check is 2nd in CHAT_PIPELINE (after auth), before client guard
3. **Added missing admin UI component**: `sensitive-words-skeleton.tsx` was not mentioned in round1
4. **Database logging details**: Added actual field names used in `logBlockedRequest` (userId, key, model, sessionId, errorMessage)
5. **Removed absolute paths**: Changed from `/Users/ding/Github/claude-code-hub/src/...` to relative `src/...` paths for portability
6. **Added verification summary table**: Documents what was verified against actual codebase
