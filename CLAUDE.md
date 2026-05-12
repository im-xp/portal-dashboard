# Portal Dashboard — Claude Code Context

Real-time operations dashboard for **The Portal at Iceland Eclipse**. Next.js 15 + TypeScript + Tailwind, deployed on Vercel.

## What this repo does

Far more than email tickets. Current scope:

- **People journey tracker** — accepted → in-cart → partial → confirmed funnel. Source data: NocoDB (applications), Stripe (payments), Fever (event passes), Supabase (email tickets).
- **Finances** — revenue aggregation, products analytics, Stripe transaction reconciliation.
- **Applications pipeline** — admission applications backed by NocoDB.
- **Email tickets** — support thread/ticket DB on Supabase (original purpose; still active).
- **Volunteers, Fever ticketing, Stripe charges, Segment/CIO segmentation, Slack digests.**

## Top-level layout

| Path | Purpose |
|---|---|
| `src/app/page.tsx` + `dashboard/` | Top-level metrics overview |
| `src/app/people/`, `applications/`, `products/`, `volunteers/`, `email-queue/` | Operator pages |
| `src/app/api/applications/` | NocoDB-backed admission applications CRUD |
| `src/app/api/auth/[...nextauth]/` | NextAuth (Google) |
| `src/app/api/cron/{fever-sync,slack-digest,slack-stale,stripe-sync,warm-cache}/` | Vercel cron handlers |
| `src/app/api/email/` | Email tickets — activity, backfill, claim, notes, send |
| `src/app/api/fever/` | Fever Events API integration (orders, lookups) |
| `src/app/api/finances/aggregate/` | Revenue + transaction aggregation |
| `src/app/api/stripe/` | Stripe charges read |
| `src/app/api/webhooks/payment-approved/` | Inbound payment webhook |
| `src/app/api/segments/`, `popup-cities/`, `refresh/`, `volunteers/` | Misc operator routes |
| `src/lib/` | `edgeos-api.ts`, `fever-client.ts`, `nocodb.ts`, `segment.ts`, `stripe.ts`, `supabase.ts`, `slack.ts`, `gmail.ts`, `gemini.ts`, `auth.ts`, `activity.ts` |

## External data sources

| Source | Used for | Access |
|---|---|---|
| Supabase | Email tickets + threads + activity | `DATABASE_URL` (Session Pooler), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| NocoDB | Applications, humans, attendees | `EDGEOS_API_URL` + token via `src/lib/edgeos-api.ts` |
| Stripe | Charges, transactions | `STRIPE_SECRET_KEY` |
| Fever | Event ticketing orders | `FEVER_*` env vars |
| Segment | Behavioral events | `SEGMENT_*` |
| Gmail | Email tickets ingestion | OAuth via `gmail.ts` |
| Slack | Digests + stale-ticket pings | `SLACK_*` |

`.env.local` holds the full set in dev. Production env lives in Vercel.

## Common operator queries

- **Recent transactions / charges**: `src/app/api/stripe/route.ts` + `src/lib/stripe.ts`. Charges also flow through the `webhooks/payment-approved/` path and the `cron/stripe-sync/` job.
- **Finance aggregation**: `src/app/api/finances/aggregate/route.ts` and `src/lib/types.ts` for shape.
- **Applications**: `src/app/api/applications/[id]/route.ts` + NocoDB via `edgeos-api.ts`.
- **Email tickets**: `src/app/api/email/*` + Supabase tables `email_messages`, `email_tickets`, `thread_ticket_mapping`, `ticket_activity`.

## Supabase access (dev)

```bash
# Session-pooler DATABASE_URL works on IPv4
psql $DATABASE_URL -c "SELECT count(*) FROM email_tickets;"
```

Anon key has RLS restrictions (DELETE returns success but does not delete). Use `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` for writes. Pooler host prefix (`aws-1` vs `aws-0`) varies by project — get yours via `npx supabase inspect db db-stats --debug 2>&1 | grep pooler`.

## Code conventions

- Server routes use Next.js App Router `route.ts` handlers.
- All external integrations are thin clients in `src/lib/*.ts` — keep route handlers focused on shape/validation.
- Types live in `src/lib/types.ts`.
- See `docs/MONITORING.md` for prod observability.

## Out of scope

- Customer-facing portal (that's `portal-frontend`).
- Portal API backend (that's `portal-backend-api` / `edgeos-monorepo/backend`).
- Affinity / social graph (that's `affinity-mvp` + `portal-viz`).
