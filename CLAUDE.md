# Iceland Dashboard - Claude Code Context

## Supabase Database Access

### Quick Commands

```bash
# Run SQL directly (requires DATABASE_URL in .env.local)
psql $DATABASE_URL -c "YOUR SQL HERE"

# Truncate all email tables (full reset)
psql $DATABASE_URL -c "TRUNCATE email_messages, email_tickets, thread_ticket_mapping, ticket_activity CASCADE;"

# Check table counts
psql $DATABASE_URL -c "SELECT 'messages' as t, count(*) FROM email_messages UNION ALL SELECT 'tickets', count(*) FROM email_tickets;"
```

### Setup DATABASE_URL

Use the **Session Pooler** format (works on IPv4 networks):
```
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-1-us-east-2.pooler.supabase.com:5432/postgres
```

Note: Direct connection (`db.xxx.supabase.co`) is IPv6-only. The pooler prefix (`aws-1` vs `aws-0`) varies by project - run `npx supabase inspect db db-stats --debug 2>&1 | grep pooler` to find yours.

### Why Not REST API?

The anon key has RLS restrictions - DELETE operations return data but don't actually delete rows. Use either:
- Direct psql with DATABASE_URL (recommended)
- Service role key (add `SUPABASE_SERVICE_ROLE_KEY` to .env.local)

### Supabase CLI

Project is linked. Useful commands:
```bash
npx supabase projects list     # Show linked project
npx supabase db dump           # Export schema/data
npx supabase db push           # Push migrations
```

## Email Sync System

### Key Files
- `/src/app/api/email/sync/route.ts` - Main sync logic
- `/src/lib/gmail.ts` - Gmail API helpers, body extraction
- `/src/components/email/ThreadMessages.tsx` - UI with client-side quote stripping

### Sync Window
Currently set to `newer_than:30d` in sync/route.ts. Change this value to adjust how far back emails are fetched.

### HTML Email Processing
`htmlToText()` in gmail.ts converts HTML emails to plain text while preserving paragraph structure. This is critical for quote detection which relies on line breaks to find "On [date]... wrote:" patterns.

### Database Tables
- `email_messages` - Raw messages from Gmail
- `email_tickets` - Tickets (one per customer per thread)
- `thread_ticket_mapping` - Links threads to tickets (for subject changes)
- `ticket_activity` - Activity log
- `email_sync_state` - Last sync timestamp
