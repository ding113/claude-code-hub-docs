
## Final Documentation: User Expiration Management

### Date: 2026-01-29

### Document Statistics
- **File**: `/Users/ding/Github/claude-code-hub-docs/src/app/docs/users/expiration/page.md`
- **Character Count**: ~12,318 characters
- **Chinese Word Estimate**: ~2,000-2,500 words
- **Lines**: 549

### Content Structure

The final documentation covers:

1. **Introduction** - Core functionality overview with callout
2. **Expiration States** - Four states table (Active, Expiring Soon, Expired, Disabled)
3. **User vs Key Expiration** - Dual-level expiration control explanation
4. **Lazy Expiration** - API request-time checking mechanism
5. **Date Handling** - End-of-day boundary time handling (23:59:59.999)
6. **Database Schema** - Users and keys table structure with index
7. **Validation Rules** - Zod schema validation with 10-year limit
8. **Server Actions** - renewUser, validateExpiresAt, markUserExpired
9. **Status Filtering** - Six filter options with SQL conditions
10. **UI Operations** - Quick renew options and optimistic updates
11. **Timezone Handling** - Three-format date parsing
12. **API Error Response** - user_expired error format
13. **Best Practices** - Policy recommendations and SQL queries
14. **Related Documentation** - Links to other docs

### Markdoc Components Used

- `{% callout type="note" title="..." %}` - Core functionality highlight
- `{% table %}` - Four expiration states, quick renew options
- Code blocks with `typescript` and `json` syntax highlighting
- Standard frontmatter with dimensions metadata

### Key Code Snippets Included

1. EXPIRING_SOON_MS constant (72 hours)
2. Lazy expiration check in auth-guard.ts
3. End-of-day time handling in quick-renew-dialog.tsx
4. Database schema with composite index
5. Zod validation schema with superRefine
6. renewUser server action
7. validateExpiresAt helper function
8. markUserExpired repository function
9. Status filter SQL conditions
10. Optimistic update with rollback
11. parseDateInputAsTimezone with three format handling
12. API error response JSON

### Style Compliance

- ✅ Sentence case headings
- ✅ Direct address to reader ("你")
- ✅ Contractions used where appropriate
- ✅ Text wrapped at reasonable length
- ✅ No emojis
- ✅ No HTML tags
- ✅ No format conversion features mentioned
- ✅ Chinese comments preserved in code snippets
- ✅ Line numbers and file paths from verified round2 draft

### Verification Notes

All content verified against round2 draft at:
`/Users/ding/Github/claude-code-hub-docs/.draft/docs-users-expiration-用户过期管理-round2.md`

All code snippets reference actual claude-code-hub source files with accurate line numbers as verified in the round2 review process.
