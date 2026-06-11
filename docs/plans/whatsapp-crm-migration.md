# Plan: WhatsApp CRM — move to dashboard under `/whatsapp`

## Summary

Consolidate **both** WhatsApp outreach flows into a single team-accessible `/whatsapp` tab in the **portal-dashboard** repo, replacing the admin-only, single-operator implementation that currently lives (and is half-built) in `affinity-mvp/portal-viz`:

1. **Non-buyer outreach** (the original WA flow) — WhatsApp-community members who engaged but never purchased. Tiered list, per-person status, manual + templated outreach.
2. **Work-exchange volunteers** (the new flow) — the 95 accepted Iceland Eclipse work-exchange applicants. Cold WABA template blast (Kapso) → CRM back-and-forth.

The dashboard is the right home because it already has what portal-viz lacks: **team auth with roles** (NextAuth/Google, including a `volunteer_viewer` role that already lists Zilla and the volunteer team), **Supabase Postgres** for concurrent multi-user state, **Redis** caching, **NocoDB** as the live volunteer source, a **cron** framework, and an **email-queue CRM** (tickets/claim/notes/activity/thread/send) whose shape maps almost 1:1 onto a WhatsApp CRM.

This is a **re-platform, not a port**: storage moves KV→Supabase, auth moves shared-cookie→NextAuth roles, UI moves hand-rolled Tailwind→shadcn/Radix + TanStack Table, and the work-exchange data source moves Google-Sheet-export→live NocoDB.

## Research

### Target repo (portal-dashboard) — what we build on

- **Stack:** Next.js 16, TS, Tailwind, shadcn/ui (`src/components/ui`), TanStack Query + Table, recharts. `components.json` present.
- **Auth (`src/lib/auth.ts`):** NextAuth Google, gated to `im-xp.com` / `icelandeclipse.com` domains + an explicit allowlist. Roles `admin | volunteer_viewer` via `resolveRole()`. **`VOLUNTEER_VIEWER_EMAILS` already includes `zilla@shifthappensvolunteers.com`, `volunteers@icelandeclipse.com`, and others.** API routes authorize with `getServerSession(authOptions)`; the Sidebar filters nav by `session.user.role`.
- **Storage:**
  - **Supabase Postgres** (`src/lib/supabase.ts`, `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). Migrations in `supabase/migrations/NNN_*.sql`.
  - **Redis** cache (`src/lib/nocodb.ts`, `getCached`/`setCache`/stale-while-revalidate). Used for NocoDB read caching.
- **CRM pattern to mirror — email-queue:** `email_tickets` (with `claimed_by`/`claimed_at`, generated `needs_response`), `ticket_notes`, `ticket_activity` (action log with `actor`), `api/email/{tickets,thread,claim,notes,send,activity,sync}`, and `logActivity()` in `src/lib/activity.ts`. This is the closest existing analog to a WhatsApp CRM and should be the template.
- **Volunteer data is already live:** `src/app/api/volunteers/route.ts` → `getVolunteerData()` (NocoDB applications filtered by `popup_city_id = VOLUNTEER_POPUP_CITY_ID`, status `accepted`), warmed by `cron/warm-volunteers`. **Phone numbers are in `custom_data.phone_number`** (see `RawVolunteerApp` / `VolunteerCustomData`). A `/volunteers` page already exists and is visible to `volunteer_viewer`.
- **Cron:** `vercel.json` registers Vercel cron handlers under `api/cron/*`.

### Source repo (portal-viz) — what exists today

- **Non-buyer tab:** snapshot `public/data/wa-non-buyers.json` (built from the `pat-profile-cloud` WhatsApp pipeline via a GH Action), tiered A/C/EXCLUDED/BUYER, per-person status in **Upstash KV** (`wa-non-buyer:<stable_id>`, monotonic ladder), `assigned_to`/`contacted_by`/`notes`, CSV export. Send (Kapso template + wa.me) was **spec'd but never shipped**.
- **Work-exchange tab (Bout 1, just built):** `public/data/volunteers.json` (one-time Google Sheet export), read-only table. **Superseded by NocoDB in the dashboard — discard, do not migrate the snapshot or export script.**
- **Confirmed Kapso contract** (see `affinity-mvp/docs/plans/volunteer-whatsapp-blast.md`): send `POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages` (`X-API-Key`), webhook signature `X-Webhook-Signature` = HMAC-SHA256 of body, events `whatsapp.message.{received,sent,delivered,read,failed}`. This contract carries over unchanged.

### Key differences forcing rework (not copy)

| Concern | portal-viz (today) | portal-dashboard (target) |
|---|---|---|
| Auth | shared admin cookie | NextAuth Google + roles |
| Identity for `contacted_by`/assignee | free-text field | real `session.user.email` |
| Status/notes store | Upstash KV JSON | Supabase tables |
| Conversation threads | none (status only) | Supabase, mirror email thread |
| UI | hand-rolled Tailwind | shadcn/Radix + TanStack Table |
| Work-exchange data | Google Sheet export JSON | live NocoDB (`custom_data.phone_number`) |
| Non-buyer data | snapshot JSON in repo | needs ingestion path (see Bout 0) |
| Kapso webhook target | `portal-viz.vercel.app/...` | dashboard domain (**must reconfigure in Kapso**) |
| Kapso env vars | affinity-mvp Vercel project | dashboard Vercel project |

## Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| State store | Supabase Postgres (+ Redis only for read-through caching) | Multi-user, concurrent, queryable, activity log; KV can't safely serve a team |
| Data model | One generic schema for both cohorts (`whatsapp_contacts` + `cohort` discriminator) | CRM mechanics are identical; avoids duplicate tables/routes |
| Identity | `session.user.email` for assignee/sender/actor | Real attribution replaces free-text `contacted_by` |
| UI | shadcn + TanStack Table, mirror email-queue components | House style; reuse Dialog/Table/Badge |
| Work-exchange source | **Jesse's spreadsheet** (one-shot import to Supabase) | Jesse-curated source of truth; sheet columns mirror NocoDB but may diverge if hand-edited |
| Send transport | Kapso (contract already confirmed) | Unchanged from portal-viz plan |
| Webhook | `…/api/whatsapp/webhook/kapso` on dashboard domain | Must re-point Kapso webhook + move secrets |

## Proposed Data Model (Supabase migrations)

New migration `016_whatsapp_crm.sql` (mirrors email-queue conventions):

```
whatsapp_contacts
  contact_key TEXT PK            -- stable id: cohort + normalized phone
  cohort TEXT                    -- 'non_buyer' | 'work_exchange'
  phone TEXT                     -- E.164
  display_name TEXT
  external_ref TEXT              -- nocodb application id / wa stable_id
  status TEXT                    -- uncontacted|contacted|responded|converted
  assigned_to TEXT               -- team member email
  opted_out BOOLEAN DEFAULT false
  window_open_until TIMESTAMPTZ  -- 24h free-form window
  last_inbound_ts / last_outbound_ts TIMESTAMPTZ
  metadata JSONB                 -- tier, phase, skills, etc.
  created_at / updated_at

whatsapp_messages
  id UUID PK
  contact_key TEXT FK
  direction TEXT                 -- inbound|outbound
  kind TEXT                      -- template|freeform
  body TEXT
  template_name TEXT
  kapso_message_id TEXT
  status TEXT                    -- sent|delivered|read|failed
  sent_by TEXT                   -- team member email (null for inbound)
  created_at

whatsapp_activity   (mirror ticket_activity: contact_key, action, actor, metadata, created_at)
whatsapp_optouts    (phone PK, reason, created_at)  -- enforce across cohorts
```

## Build Sequence

Order reflects the locked decision: **work-exchange end-to-end first** (Bouts 1–5), **non-buyer last** (Bout 6, one-shot import). The shared schema/UI built in Bouts 1–3 is cohort-agnostic, so Bout 6 is mostly data ingestion, not new surface.

### Bout 1 — Schema + auth + shell
- Migration `016_whatsapp_crm.sql`. `src/lib/whatsapp.ts` (types, contact-key mint, phone normalize) + `src/lib/whatsapp-store.ts` (Supabase reads/writes).
- `/whatsapp` route + Sidebar nav entry (`MessageCircle` icon). **Role decision (see Open Questions)** gates visibility/sending.
- Cohort switcher (Work-Exchange / Non-Buyer) — two TanStack tables over one contacts store.

### Bout 2 — Cohort population + read-only tables
- Work-exchange: **one-shot import of Jesse's spreadsheet** (export CSV → upsert into `whatsapp_contacts`, cohort `work_exchange`). NocoDB stays available as a cross-check but is not the source of truth.
- Non-buyer: read from Bout 0's ingest.
- Status/assignee/notes columns, filters, search, CSV — rebuilt in shadcn/TanStack.

### Bout 3 — Status + assignment + activity (Supabase)
- `api/whatsapp/status`, `/assign`, `/notes` — authorized via `getServerSession`, write Supabase, `logActivity`. Monotonic status guard carried from the KV design. Real `assigned_to`/actor = session email.

### Bout 4 — Template blast send (Kapso) [needs production number + approved template]
- `api/whatsapp/send` — POST `{contact_keys[], template_name, varsByKey}`; per-recipient Kapso template send, rate-limited loop, skip opted-out/no-phone, write `whatsapp_messages` + status `contacted`. Blast composer in shadcn (template preview, recipient count, dry-run/test recipient, results summary).

### Bout 5 — Inbound + conversation CRM [needs Kapso webhook re-pointed]
- `api/whatsapp/webhook/kapso` — verify `X-Webhook-Signature` over **raw body**, handle batched deliveries; inbound → append `whatsapp_messages`, bump `responded`, set `window_open_until = now+24h`; STOP → `whatsapp_optouts`. Conversation thread drawer (mirror email `thread` UI) + free-form reply box **enabled only while window open**.

### Bout 6 — Non-buyer cohort (one-shot import) [after work-exchange ships]
- One-time import of the current `pat-profile-cloud` non-buyer snapshot into `whatsapp_contacts (cohort='non_buyer')` (tier/groups → `metadata`). No cron. Reuses all Bout 1–5 surface via the cohort switcher. Gate sending to the non-buyer sender allowlist (TBD).

## Prerequisites / Blockers

1. **Move Kapso config to the dashboard.** `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`, `WABA_PHONE_NUMBER_ID` → dashboard Vercel project env. **Re-point the Kapso webhook** from `portal-viz.vercel.app/...` to `<dashboard-domain>/api/whatsapp/webhook/kapso`. ⚠️ The number/webhook setup the Chrome agent is doing now targets portal-viz — redirect it to the dashboard.
2. **Production WhatsApp number** connected to Kapso (Cloud API number already on WABA `2102230076919824`). Blocks Bouts 4–5.
3. **Meta template approval** (`iceland_eclipse_work_exchange_confirm_v1` + confirm-link URL). Blocks Bout 4.
4. **Supabase migration** access (already in repo workflow).

## Out of Scope (v1)

- Multi-template picker / template management UI.
- Drip/scheduled campaigns.
- Media/attachments in threads (text only).
- Backfilling historical non-buyer conversations.

## Resolved Decisions (2026-06-08)

1. **Send permissions — per-cohort.** Work-exchange: `volunteer_viewer` (Zilla's team) **can send** (blast + replies). Non-buyer: sending gated to a **separate sender allowlist Jon will provide** (admins always can). → implement a per-cohort `canSend(role, email, cohort)` check, not a single global gate.
2. **Sequencing — work-exchange first, end-to-end.** Drive the shared schema + UI to a working work-exchange blast before porting the non-buyer cohort. Non-buyer ingestion (Bout 0) moves to the end.
3. **Non-buyer ingestion — one-shot import.** Import the current snapshot into Supabase once (no cron); refresh manually if needed. Lower priority than work-exchange.
4. **Work-exchange list source — Jesse's spreadsheet** (not NocoDB live). One-shot import to Supabase.

## Remaining Open Questions

- **Non-buyer sender allowlist** — Jon to provide the emails permitted to send non-buyer outreach.
- **Disposition of portal-viz work.** Recommended: abandon the portal-viz non-buyer tab + the just-built Bout 1 volunteer tab once the dashboard work-exchange flow ships. Confirm whether the old non-buyer tab should keep running in the interim.
- **Dashboard production domain** for the Kapso webhook URL (`<dashboard-domain>/api/whatsapp/webhook/kapso`).
