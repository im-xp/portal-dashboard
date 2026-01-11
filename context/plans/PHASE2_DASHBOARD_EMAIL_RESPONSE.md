# Conversation Tracking Phase 2: Dashboard Email Response

## Current Status

| Phase | Status | Description |
|-------|--------|-------------|
| 2a | ✅ Complete | Google OAuth Login - NextAuth with domain allowlist |
| 2b | ✅ Complete | Thread-Ticket Mapping - Link new threads to original tickets |
| 2c | ✅ Complete | Compose & Send UI - Reply from dashboard |
| 2d | ✅ Complete | Activity Logging - Wire up audit trail |

### Phase 2a Deliverables (Complete)
- NextAuth with Google OAuth (`src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`)
- Domain allowlist: `@im-xp.com`, `@icelandeclipse.com`
- Sign-in/error pages (`src/app/auth/signin/page.tsx`, `src/app/auth/error/page.tsx`)
- Route protection middleware (`src/middleware.ts`)
- UserMenu in Sidebar and MobileNav
- Email-queue page uses session instead of dropdown
- Users table migration (`supabase/migrations/006_users.sql`) - **MUST be applied to Supabase**

### Phase 2b Deliverables (Complete)
- `supabase/migrations/007_thread_mapping.sql` - Maps spawned threads to parent tickets
- `src/app/api/email/sync/route.ts` - Checks thread_ticket_mapping before creating new tickets

### Phase 2c Deliverables (Complete)
- `src/app/api/email/send/route.ts` - Send endpoint using user's OAuth tokens
  - Token refresh if expired (checks token_expires_at)
  - Inserts into thread_ticket_mapping when subject changes
  - Stores sent message in email_messages
  - Updates ticket status to awaiting_customer
- `src/components/email/ComposeResponse.tsx` - Compose UI component
  - Subject field with "new thread" warning when changed
  - Plain text body textarea
  - Send button with loading state
- Updated `src/app/email-queue/page.tsx` - Reply button for claimed tickets

### Phase 2d Deliverables (Complete)
Activity logging wired up across all routes:
- `src/app/api/email/claim/route.ts` - Logs: claimed, unclaimed, responded, reopened
- `src/app/api/email/send/route.ts` - Logs: responded
- `src/app/api/email/sync/route.ts` - Logs: created, customer_replied, responded (outbound detected via sync)
- `src/components/email/TicketActivity.tsx` - Displays activity timeline UI
- `src/app/api/email/activity/route.ts` - Activity fetch endpoint

---

## Background

This is an email queue dashboard for managing customer support. The system syncs emails from a shared Gmail inbox (`theportalsupport@icelandeclipse.com`) and creates tickets for team members to claim and respond to.

**Current workflow problem:**
1. Marketing sends email blast to many customers (Subject: "January Sale!")
2. Multiple customers reply to the blast → each creates a ticket in the dashboard
3. Team member claims a ticket and responds, but **changes the subject** to create a private 1:1 thread (Subject: "Re: Your order inquiry")
4. **Problem:** Gmail creates a NEW thread when subject changes. System loses the link between the response and original ticket.

**Current auth:** None. Team members selected via localStorage dropdown from hardcoded list. No real login.

**Current ticket keying:** `hash(gmail_thread_id + customer_email)` - breaks when thread_id changes.

---

## Codebase Context

**Key existing files:**
- `src/app/email-queue/page.tsx` - Main UI, displays tickets, claim buttons
- `src/app/api/email/sync/route.ts` - Cron job syncing Gmail → Supabase
- `src/app/api/email/claim/route.ts` - Claim/unclaim tickets
- `src/lib/gmail.ts` - Gmail API client (token refresh, fetch messages)
- `src/lib/supabase.ts` - DB client + `generateTicketKey()` function
- `src/lib/activity.ts` - `logActivity()` function (exists but not wired up)
- `src/components/email/TicketNotes.tsx` - Internal notes UI (from Phase 1)
- `src/components/email/TicketActivity.tsx` - Activity timeline UI (from Phase 1)

**Existing tables:**
- `email_messages` - Individual emails (gmail_message_id, thread_id, from, to, subject, etc.)
- `email_tickets` - Tickets (ticket_key, gmail_thread_id, customer_email, status, claimed_by, etc.)
- `ticket_notes` - Internal team notes (from Phase 1)
- `ticket_activity` - Audit log (from Phase 1, not fully wired)

**Missing from current system:**
- No `Message-ID`, `In-Reply-To`, `References` headers stored
- No users table
- No real authentication
- No send capability

---

## Solution

Team responds directly from dashboard using their Google account. System controls the send, explicitly links new threads to original tickets regardless of subject changes.

**Key design decisions:**
- NextAuth for Google OAuth (handles token refresh)
- Domain allowlist in code: `['im-xp.com', 'icelandeclipse.com']`
- Tokens encrypted in Supabase (acceptable for internal tool)
- Subject field always visible, pre-filled with original (user edits to break thread)
- Plain text MVP (rich text/attachments later)

---

## Implementation Phases

### Phase 2a: Google OAuth Login ✅ COMPLETE
**Goal:** Real authentication replaces localStorage dropdown
**Status:** Implemented and tested

**New files:**
- `src/app/api/auth/[...nextauth]/route.ts` - NextAuth Google provider
- `src/lib/auth.ts` - Auth utilities, domain allowlist
- `supabase/migrations/006_users.sql` - Users table with encrypted tokens

**Modify:**
- `src/app/email-queue/page.tsx` - Replace dropdown with login state
- `src/components/layout/` - Add user menu / sign out

**Schema: `users` table**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  google_access_token TEXT,  -- encrypted
  google_refresh_token TEXT, -- encrypted
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Domain allowlist:**
```typescript
const ALLOWED_DOMAINS = ['im-xp.com', 'icelandeclipse.com'];
```

**OAuth scopes needed:**
- `openid` (login)
- `email` (get email address)
- `profile` (get name/picture)
- `https://www.googleapis.com/auth/gmail.send` (send email)
- `https://www.googleapis.com/auth/gmail.compose` (create drafts)

---

### Phase 2b: Thread-Ticket Mapping
**Goal:** Track which threads belong to which tickets, even after subject change

**New file:**
- `supabase/migrations/007_thread_mapping.sql`

**Schema: `thread_ticket_mapping` table**
```sql
CREATE TABLE thread_ticket_mapping (
  gmail_thread_id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL REFERENCES email_tickets(ticket_key),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for reverse lookup
CREATE INDEX idx_thread_mapping_ticket ON thread_ticket_mapping(ticket_key);
```

**Modify:**
- `src/app/api/email/sync/route.ts` - Check mapping table before creating new ticket

**Sync logic change:**
```
1. Inbound email arrives with thread_id
2. Check: Is thread_id in email_tickets? → route to that ticket
3. Check: Is thread_id in thread_ticket_mapping? → route to mapped ticket
4. Else: Create new ticket
```

---

### Phase 2c: Compose & Send UI
**Goal:** Team composes and sends responses from dashboard

**New files:**
- `src/components/email/ComposeResponse.tsx` - Compose form
- `src/app/api/email/send/route.ts` - Send endpoint

**ComposeResponse.tsx features:**
- Subject field (pre-filled, editable)
- Body textarea (plain text MVP)
- Send button
- "Subject changed" indicator when different from original

**Send endpoint logic:**
```
1. Validate user session
2. Get user's Gmail token from users table
3. Refresh token if expired
4. Build email (RFC 2822 format)
5. If subject unchanged: include threadId to keep in same thread
6. If subject changed: omit threadId (new thread), add to thread_ticket_mapping
7. POST to Gmail API: users.messages.send
8. Store sent message in email_messages
9. Update ticket: last_outbound_ts, status, responded_by
10. Log activity
```

---

### Phase 2d: Wire Up Activity Logging
**Goal:** Complete the activity tracking from Phase 1

**Modify:**
- `src/app/api/email/claim/route.ts` - Log claim/unclaim
- `src/app/api/email/send/route.ts` - Log responded
- `src/app/api/email/sync/route.ts` - Log customer_replied, created

---

## Files Summary

| Action | File |
|--------|------|
| Create | `src/app/api/auth/[...nextauth]/route.ts` |
| Create | `src/lib/auth.ts` |
| Create | `src/components/email/ComposeResponse.tsx` |
| Create | `src/app/api/email/send/route.ts` |
| Create | `supabase/migrations/006_users.sql` |
| Create | `supabase/migrations/007_thread_mapping.sql` |
| Modify | `src/app/email-queue/page.tsx` |
| Modify | `src/app/api/email/sync/route.ts` |
| Modify | `src/app/api/email/claim/route.ts` |
| Modify | `src/components/layout/MobileNav.tsx` (user menu) |

---

## Environment Variables (New)

```
NEXTAUTH_SECRET=<generate random string>
NEXTAUTH_URL=https://your-domain.vercel.app
# Existing Google OAuth creds can be reused, but need updated scopes
```

---

## Google Cloud Console Setup

1. Go to existing OAuth client
2. Add scopes: `gmail.send`, `gmail.compose`
3. Add authorized redirect URI: `https://your-domain.vercel.app/api/auth/callback/google`
4. If consent screen is "External", no user list needed (we restrict via code)

---

## Verification

1. **Auth flow:** Sign in with @im-xp.com account → session created → user in DB
2. **Unauthorized domain:** Sign in with personal Gmail → rejected
3. **Compose:** Claim ticket → compose response → see subject pre-filled
4. **Send (same subject):** Send → email appears in customer's inbox in same thread
5. **Send (changed subject):** Change subject → send → new thread created → mapping stored
6. **Reply routing:** Customer replies to new thread → sync routes to original ticket
7. **Activity log:** All actions appear in ticket activity timeline

---

## Future Work (Parking Lot)

- [ ] Rich text editor (bold, links, etc.)
- [ ] File attachments
- [ ] Email templates / canned responses
- [ ] Draft auto-save
- [ ] CC/BCC support
- [ ] **Write SOP doc to onboard team on new workflow**

---

## Open Questions (Resolved)

- ~~Same or different Workspace?~~ → Using domain allowlist, works either way
- ~~UI for thread break?~~ → Always show subject, pre-filled (Option A)
- ~~Token storage security?~~ → Encrypted in Supabase (internal tool)
