# Email Queue Search Feature

## Overview

Add search functionality to the email queue dashboard allowing team members to find tickets by customer email and keywords from conversation content.

## Requirements

### In Scope
- Search by customer email (prefix match: "john" finds "john@gmail.com")
- Search by keywords in email subject, body, and AI summary (full-text search)
- Combine search with existing status filters (needs_response, resolved, etc.)
- Debounced search input in UI

### Out of Scope (Future Enhancement)
- Substring matching on emails (e.g., "@gmail" matching "john@gmail.com") - would require pg_trgm extension
- Search in internal ticket notes
- Highlighted match terms in results

## Technical Approach

### Search Strategy

| Field | Method | Why |
|-------|--------|-----|
| customer_email | Prefix match (`email ILIKE 'term%'`) | Uses existing B-tree index, covers "starts with" use case |
| subject, body, summary | PostgreSQL Full-Text Search (tsvector + GIN) | Fast keyword search at scale, relevance ranking |

### Why Full-Text Search over ILIKE

- **ILIKE `%term%`** cannot use indexes - always scans entire table
- **FTS with GIN index** is O(1) lookup regardless of table size
- At 10K+ tickets, FTS is 10-100x faster
- Built-in relevance ranking surfaces best matches first

## Database Migration

**File:** `supabase/migrations/011_search_indexes.sql`

```sql
-- Add tsvector column for full-text search on tickets
ALTER TABLE email_tickets
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(summary, '')), 'B')
) STORED;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_email_tickets_search
ON email_tickets USING GIN (search_vector);

-- Add tsvector column for message body search
ALTER TABLE email_messages
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(body, '')), 'B')
) STORED;

-- Create GIN index for message search
CREATE INDEX IF NOT EXISTS idx_email_messages_search
ON email_messages USING GIN (search_vector);
```

**Notes:**
- `GENERATED ALWAYS AS ... STORED` auto-updates the search vector when source columns change
- `setweight` prioritizes subject matches (A) over body/summary matches (B)
- GIN index enables sub-millisecond lookups

## API Changes

**File:** `src/app/api/email/tickets/route.ts`

Add `search` query parameter:

```typescript
export async function GET(request: NextRequest) {
  const filter = request.nextUrl.searchParams.get('filter') || 'needs_response';
  const search = request.nextUrl.searchParams.get('search')?.trim();
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100', 10);

  let query = supabase
    .from('email_tickets')
    .select('*')
    .order('last_inbound_ts', { ascending: false })
    .limit(limit);

  // Apply existing filter logic (needs_response, resolved, etc.)
  query = applyFilter(query, filter);

  // Apply search if provided (minimum 3 characters)
  if (search && search.length >= 3) {
    // Get ticket_keys that match the search
    const ticketKeys = await searchTickets(search);

    if (ticketKeys.length === 0) {
      return NextResponse.json({ tickets: [] });
    }

    query = query.in('ticket_key', ticketKeys);
  }

  const { data: tickets, error } = await query;
  // ... rest of existing logic
}

async function searchTickets(search: string): Promise<string[]> {
  const results = new Set<string>();

  // 1. Prefix match on customer_email (uses existing index)
  const { data: emailMatches } = await supabase
    .from('email_tickets')
    .select('ticket_key')
    .ilike('customer_email', `${search}%`);

  emailMatches?.forEach(t => results.add(t.ticket_key));

  // 2. Full-text search on ticket subject/summary
  const tsQuery = search.split(/\s+/).map(term => `${term}:*`).join(' & ');
  const { data: ticketFtsMatches } = await supabase
    .from('email_tickets')
    .select('ticket_key')
    .textSearch('search_vector', tsQuery);

  ticketFtsMatches?.forEach(t => results.add(t.ticket_key));

  // 3. Full-text search on message body/subject, get parent tickets
  const { data: messageFtsMatches } = await supabase
    .from('email_messages')
    .select('gmail_thread_id')
    .textSearch('search_vector', tsQuery);

  if (messageFtsMatches?.length) {
    const threadIds = messageFtsMatches.map(m => m.gmail_thread_id);
    const { data: ticketsFromMessages } = await supabase
      .from('email_tickets')
      .select('ticket_key')
      .in('gmail_thread_id', threadIds);

    ticketsFromMessages?.forEach(t => results.add(t.ticket_key));
  }

  return Array.from(results);
}
```

**Query format:** `tsQuery` uses `:*` suffix for prefix matching within FTS, so "ecli" matches "eclipse".

## UI Changes

**File:** `src/app/email-queue/page.tsx`

Add search input above filter buttons:

```
┌──────────────────────────────────────────────────────────┐
│ 🔍 [Search by customer or keyword...              ] [X]  │
├──────────────────────────────────────────────────────────┤
│ [Needs Response] [Followups] [Claimed] [Resolved] [All]  │
└──────────────────────────────────────────────────────────┘
```

### State Management

```typescript
const [search, setSearch] = useState('');
const [debouncedSearch, setDebouncedSearch] = useState('');

// Debounce search input (300ms)
useEffect(() => {
  const timer = setTimeout(() => setDebouncedSearch(search), 300);
  return () => clearTimeout(timer);
}, [search]);

// Fetch tickets when filter or search changes
useEffect(() => {
  fetchTickets(filter, debouncedSearch);
}, [filter, debouncedSearch]);
```

### Stats Behavior

The stats cards (Unclaimed, My Claims, Stale) should **always show total counts** regardless of search query. This provides consistent context about overall queue health.

- Stats are calculated from a separate fetch or the unfiltered ticket list
- Search only affects the ticket list display, not the stats
- Minimum search length: **3 characters** before search triggers

### Search Input Component

**File:** `src/components/email/SearchInput.tsx`

```typescript
interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search..."}
        className="w-full pl-10 pr-10 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
```

## File Changes Summary

| File | Action |
|------|--------|
| `supabase/migrations/011_search_indexes.sql` | CREATE - FTS columns and indexes |
| `src/app/api/email/tickets/route.ts` | MODIFY - Add search parameter and logic |
| `src/components/email/SearchInput.tsx` | CREATE - Reusable search input component |
| `src/app/email-queue/page.tsx` | MODIFY - Add search state and UI |

## Future Enhancements (Not in Scope)

### Substring Matching on Emails (pg_trgm)

If the team requests ability to search "@gmail" or "eclipse.com" within email addresses:

```sql
-- Enable trigram extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram index on customer_email
CREATE INDEX idx_email_tickets_customer_trgm
ON email_tickets USING GIN (customer_email gin_trgm_ops);
```

Then use `ILIKE '%term%'` which will be fast with the trigram index.

**Trigger:** Team requests searching by email domain or partial email matches.

## Verification

1. **Migration runs:** Apply migration in Supabase dashboard or via CLI
2. **Build passes:** `npm run build`
3. **Search by email prefix:** "john" returns tickets for john@example.com
4. **Search by keyword:** "iceland" returns tickets with "iceland" in subject/body
5. **Search + filter:** Search "john" with filter "resolved" returns only resolved john tickets
6. **Empty search:** Clearing search returns to normal filtered view
7. **No results:** Searching gibberish shows empty state gracefully
8. **Performance:** Search responds in <200ms

## Implementation Order

1. Create and run migration `011_search_indexes.sql`
2. Create `SearchInput.tsx` component
3. Update `/api/email/tickets/route.ts` with search logic
4. Update `email-queue/page.tsx` with search UI and state
5. Test end-to-end
