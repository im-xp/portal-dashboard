# Conversation Tracking Implementation Plan

## Problem Statement

Team members struggle to track the progress of email conversations. Current pain points:
- Context switching to Gmail to understand conversation state
- No internal notes for handoffs between team members
- Activity history not visible (who claimed, when, what happened)
- No proactive alerts for stale tickets

## Phase 1: Quick Wins (This Branch)

### 1. Internal Notes Per Ticket
**Goal:** Enable team members to leave internal context for handoffs.

**Database:**
```sql
CREATE TABLE ticket_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_key TEXT NOT NULL REFERENCES email_tickets(ticket_key) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ticket_notes_ticket_key ON ticket_notes(ticket_key);
```

**API:**
- `GET /api/email/notes?ticket_key=X` - Fetch notes for a ticket
- `POST /api/email/notes` - Add a note `{ ticket_key, author, content }`

**UI:**
- Expandable notes section in ticket card
- "Add note" input field
- Display notes with author and timestamp

### 2. Activity Timeline in UI
**Goal:** Surface existing activity data (claims, responses) in a visible timeline.

**Database:**
```sql
CREATE TABLE ticket_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_key TEXT NOT NULL REFERENCES email_tickets(ticket_key) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'claimed', 'unclaimed', 'responded', 'reopened', 'customer_replied'
  actor TEXT, -- email of team member, or 'customer' for inbound
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ticket_activity_ticket_key ON ticket_activity(ticket_key);
```

**API:**
- `GET /api/email/activity?ticket_key=X` - Fetch activity for a ticket
- Activity logged automatically on claim/unclaim/respond actions

**UI:**
- Timeline component in expanded ticket view
- Icons for each action type
- Chronological order, newest first

### 3. Slack Morning Digest
**Goal:** Daily visibility into queue state at 8am.

**Implementation:**
- Vercel Cron job at 8am PT
- Fetches ticket stats from `/api/email/tickets`
- Posts formatted message to Slack channel

**Slack Message Format:**
```
📬 Email Queue Daily Digest

🔴 5 tickets need response
⚠️ 2 stale (>24h)
👤 Unclaimed: 3

Top stale:
• customer@example.com - "Re: Trip question" (36h)
• other@example.com - "Payment issue" (28h)
```

**Environment:**
- `SLACK_WEBHOOK_URL` - Incoming webhook URL

### 4. Slack Stale Alert
**Goal:** Real-time notification when tickets go stale.

**Implementation:**
- Check during sync: if ticket crosses 24h threshold, alert
- Alternative: Vercel Cron every hour checking for newly-stale tickets

**Slack Message Format:**
```
🚨 Stale Ticket Alert

customer@example.com hasn't received a response in 24+ hours
Subject: "Re: Trip dates question"
Claimed by: jon

→ View in Dashboard
```

## Phase 2: Enhanced Tracking (Future)

- Rolling AI summary (re-summarize on each message)
- Slack unclaim notification
- Filter by "my responses"

## Phase 3: Consider Later

- Full conversation view in dashboard (email body sync)
- MCP integration for Claude queries

## File Changes Summary

### New Files
- `supabase/migrations/004_ticket_notes.sql`
- `supabase/migrations/005_ticket_activity.sql`
- `src/app/api/email/notes/route.ts`
- `src/app/api/email/activity/route.ts`
- `src/app/api/cron/slack-digest/route.ts`
- `src/app/api/cron/slack-stale/route.ts`
- `src/components/email/TicketNotes.tsx`
- `src/components/email/TicketActivity.tsx`

### Modified Files
- `src/app/email-queue/page.tsx` - Add notes and activity UI
- `src/app/api/email/claim/route.ts` - Log activity on actions
- `src/app/api/email/sync/route.ts` - Log activity on customer replies, check stale
- `vercel.json` - Add cron schedules

---

## Setup Instructions

### 1. Run Database Migrations

```bash
# Via Supabase CLI
supabase db push

# Or run migrations manually in Supabase SQL Editor:
# - supabase/migrations/004_ticket_notes.sql
# - supabase/migrations/005_ticket_activity.sql
```

### 2. Configure Environment Variables

Add to `.env.local` and Vercel environment:

```bash
# Slack Integration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/xxx/xxx

# Cron Security (generate a random string)
CRON_SECRET=your-random-secret-string

# Optional: Dashboard URL (defaults to production)
NEXT_PUBLIC_APP_URL=https://dashboard.icelandeclipse.com
```

### 3. Set Up Slack Incoming Webhook

1. Go to https://api.slack.com/apps
2. Create app or select existing
3. Add "Incoming Webhooks" feature
4. Create webhook for your #support channel
5. Copy webhook URL to `SLACK_WEBHOOK_URL`

### 4. Test Locally

```bash
# Test Slack digest (manually)
curl -H "Authorization: Bearer your-cron-secret" \
  http://localhost:3000/api/cron/slack-digest

# Test Slack stale alert
curl -H "Authorization: Bearer your-cron-secret" \
  http://localhost:3000/api/cron/slack-stale
```

### 5. Vercel Cron Schedule

Crons are configured in `vercel.json`:
- **Daily Digest**: 8am PT (16:00 UTC) - `0 16 * * *`
- **Stale Check**: Every hour - `0 * * * *`

---

## Testing Checklist

- [ ] Notes panel appears when ticket expanded
- [ ] Can add notes to a ticket
- [ ] Notes persist and show author/timestamp
- [ ] Activity timeline shows claim/unclaim/respond actions
- [ ] Slack digest sends at scheduled time
- [ ] Slack stale alert triggers for >24h tickets
