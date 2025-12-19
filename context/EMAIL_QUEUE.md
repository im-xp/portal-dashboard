# Email Reply Queue - Implementation Plan

## Overview

A mission-critical email reply queue inside the dashboard that surfaces every inbound customer reply to the group email (`theportal@icelandeclipse.com`), tracks which need responses, and allows team members to claim and respond via Gmail.

**Key Design Decisions:**

- Unit of work = `(gmail_thread_id + customer_email)` — handles mega-threads where multiple people reply inline
- Dashboard is the system of record for assignment
- Gmail is the communication UI (read/reply only)
- Separate Supabase database (not touching EdgeOS DB)

---

## Phase 0: Human Setup (BEFORE CODING)

> ⚠️ These steps must be completed before any code is written.

### 0.1 Verify Support Mailbox

- [x] Support mailbox created: `theportalsupport@icelandeclipse.com`
- [ ] Confirm you can log in and receive mail at this address
- [ ] Send a test email to verify it works

### 0.2 Route Group Mail to Support Mailbox

This ensures the Gmail API can ingest all customer replies.

1. [ ] Open [Google Groups](https://groups.google.com)
2. [ ] Open the group: `theportal@icelandeclipse.com`
3. [ ] Go to **Members** → **Add members**
4. [ ] Add `theportalsupport@icelandeclipse.com` as a member
5. [ ] Set subscription to **"Each email"** (not digest)
6. [ ] Send a test email to `theportal@icelandeclipse.com`
7. [ ] Verify it arrives in `theportalsupport@icelandeclipse.com` inbox

**Outcome:** Every customer reply to the group → copied to support mailbox

### 0.3 Set Up Gmail Delegation for Team

This makes deep links work for all responders.

1. [ ] Log in as `theportalsupport@icelandeclipse.com`
2. [ ] Gmail → **Settings** (gear icon) → **See all settings**
3. [ ] Go to **Accounts and Import** tab
4. [ ] Under **"Grant access to your account"**, click **Add another account**
5. [ ] Add each team member's email:
   - [ ] `jon@im-xp.com`
   - [ ] (add other team members)
6. [ ] Each team member must **accept the delegation invite** (email will arrive)
7. [ ] Verify: Team members can switch to support inbox from their Gmail

### 0.4 Create Supabase Project ✅ COMPLETE

- [x] Project created: `Email Tickets`
- [x] Project URL: `https://qnozzvniuptjzefkttgj.supabase.co`
- [x] Database schema deployed (email_messages, email_tickets, email_sync_state)
- [x] Environment variables added to `.env.local`

### 0.5 Create Google Cloud Project for Gmail API

1. [ ] Go to [Google Cloud Console](https://console.cloud.google.com)
2. [ ] Create new project: `iceland-email-queue`
3. [ ] Enable **Gmail API**:
   - APIs & Services → Library → Search "Gmail API" → Enable
4. [ ] Configure OAuth consent screen:
   - User type: **Internal** (if Google Workspace) or **External**
   - App name: `Iceland Email Queue`
   - Scopes: Add `https://www.googleapis.com/auth/gmail.readonly`
5. [ ] Create OAuth credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/auth/gmail/callback` (for initial auth)
6. [ ] Download the credentials JSON
7. [ ] Copy these values for `.env.local`:
   - **Client ID** → `GOOGLE_CLIENT_ID`
   - **Client Secret** → `GOOGLE_CLIENT_SECRET`

### 0.6 Generate Gmail Refresh Token

This is a one-time OAuth flow to get a long-lived refresh token.

**Script ready at:** `scripts/get-gmail-token.ts`

1. [ ] Add `http://localhost:3333/callback` to authorized redirect URIs in Google Cloud Console
2. [ ] Run: `npx tsx scripts/get-gmail-token.ts`
3. [ ] Open the URL it prints in your browser
4. [ ] Log in as `theportalsupport@icelandeclipse.com`
5. [ ] Grant permissions
6. [ ] Copy the refresh token to `.env.local`:
   - → `GOOGLE_REFRESH_TOKEN`

### 0.7 Communicate SOP to Team

> **All customer replies must be sent from the support mailbox.**
> No replies from personal inboxes during launch support.

- [ ] Notify team of this rule
- [ ] Document workflow: Dashboard → Claim → Open in Gmail → Reply from support inbox

---

## Phase 1: Technical Implementation ✅ COMPLETE

### 1.1 Database Schema (Supabase)

I will create two tables:

**`email_messages`** — Dedupe + attribution

```sql
- gmail_message_id (PK)
- gmail_thread_id
- from_email
- to_emails (jsonb)
- cc_emails (jsonb)
- subject
- snippet
- internal_ts (timestamp)
- direction ('inbound' | 'outbound')
- is_noise (boolean)
- created_at
```

**`email_tickets`** — One per customer per thread

```sql
- ticket_key (PK) — hash of (gmail_thread_id + customer_email)
- gmail_thread_id
- customer_email
- subject
- last_inbound_ts
- last_outbound_ts (nullable)
- needs_response (boolean)
- claimed_by (nullable)
- claimed_at (nullable)
- created_at
- updated_at
```

### 1.2 Gmail Sync Job

- **Endpoint:** `POST /api/email/sync`
- **Trigger:** Vercel Cron every 2 minutes
- **Logic:**
  1. Fetch messages from Gmail API (`newer_than:14d` or since last sync)
  2. For each message, extract headers (From, To, Cc, Subject, threadId)
  3. Determine direction: `from === theportalsupport@...` → outbound, else inbound
  4. Insert into `email_messages` (dedupe by `gmail_message_id`)
  5. Upsert `email_tickets` based on direction and customer email
  6. Compute `needs_response` flag

### 1.3 Ticket Key Logic

```
On INBOUND message:
  customer_email = lowercase(from_email)
  ticket_key = hash(gmail_thread_id + customer_email)
  → upsert ticket, set last_inbound_ts

On OUTBOUND message:
  customer_email = lowercase(to_email)
  ticket_key = hash(gmail_thread_id + customer_email)
  → update ticket, set last_outbound_ts
```

### 1.4 Needs-Response Computation

Deterministic (no AI):

```
needs_response =
  last_outbound_ts IS NULL
  OR last_outbound_ts < last_inbound_ts
```

### 1.5 Dashboard UI

**New route:** `/email-queue`

**Queue View:**

- Table showing tickets where `needs_response = true`
- Columns: Customer Email, Subject, Age, Claimed By, Actions
- Sorted by `last_inbound_ts ASC` (oldest first)
- Visual indicator for stale claims (> 24 hours)

**Actions:**

- **Claim** — atomic update with `claimed_by IS NULL` check
- **Unclaim** — release a ticket you claimed
- **Open in Gmail** — deep link to thread

### 1.6 Claim Endpoint

- **Endpoint:** `POST /api/email/claim`
- **Body:** `{ ticket_key, user_email }`
- **Logic:**
  ```sql
  UPDATE email_tickets
  SET claimed_by = $user, claimed_at = now()
  WHERE ticket_key = $key AND claimed_by IS NULL
  RETURNING *;
  ```
- If no rows returned → already claimed by someone else

### 1.7 Gmail Deep Links

Format for delegated mailbox access:

```
https://mail.google.com/mail/?authuser=theportalsupport@icelandeclipse.com#all/<THREAD_ID>
```

### 1.8 Noise Filtering

Auto-mark as `is_noise = true` and exclude from tickets:

- `mailer-daemon@*`
- `postmaster@*`
- Messages with `Auto-Submitted` header
- Messages with `X-Autoreply` header

---

## Environment Variables

Add to `.env.local`:

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Gmail API
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REFRESH_TOKEN=1//xxxxx
GMAIL_SUPPORT_ADDRESS=theportalsupport@icelandeclipse.com
```

---

## Vercel Cron Configuration

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/email/sync",
      "schedule": "*/2 * * * *"
    }
  ]
}
```

---

## Files I Will Create

```
dashboard/
├── src/
│   ├── app/
│   │   ├── email-queue/
│   │   │   └── page.tsx              # Queue UI
│   │   └── api/
│   │       └── email/
│   │           ├── sync/
│   │           │   └── route.ts      # Gmail sync job
│   │           ├── claim/
│   │           │   └── route.ts      # Claim ticket
│   │           └── tickets/
│   │               └── route.ts      # List tickets
│   └── lib/
│       ├── supabase.ts               # Supabase client
│       └── gmail.ts                  # Gmail API client
├── scripts/
│   └── get-gmail-token.ts            # One-time OAuth flow
├── supabase/
│   └── migrations/
│       └── 001_email_queue.sql       # Database schema
└── vercel.json                       # Cron configuration
```

---

## Post-MVP Enhancements (Not in initial build)

- [ ] Link tickets to applications (match customer_email → applications.email)
- [ ] SLA alerts via Slack for aged tickets
- [ ] Replace polling with Gmail Pub/Sub push notifications
- [ ] AI-generated reply drafts
- [ ] Audit log of all claim/unclaim actions

---

## Definition of Done (MVP)

- [ ] Support mailbox receiving group emails
- [ ] Gmail delegation working for all team members
- [ ] Supabase tables created
- [ ] Sync job running on Vercel Cron
- [ ] Queue view showing tickets needing response
- [ ] Claim/unclaim working atomically
- [ ] Gmail deep links verified working for multiple users
- [ ] Stale claim indicator (> 24 hours) visible in UI

---

## Timeline Estimate

| Phase                    | Effort    |
| ------------------------ | --------- |
| Phase 0 (Human setup)    | 1-2 hours |
| Phase 1 (Implementation) | 4-6 hours |
| Testing & verification   | 1-2 hours |

---

_Document created: December 18, 2025_
