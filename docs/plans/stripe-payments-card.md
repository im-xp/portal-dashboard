# Stripe Payments Card

Add a "Stripe Payments" metric to the dashboard home showing all-time succeeded revenue from both IMXP Stripe accounts (The Portal + Iceland Eclipse), **net of charges already counted in EdgeOS**.

Mirrors the existing Fever integration: Vercel cron → Supabase table → read API → MetricCard.

## Card spec

- **Title**: Stripe Payments
- **Subtext under total**: "Excluding EdgeOS-recorded payments"
- **Primary value**: combined net total across both accounts
- **Secondary rows**: per-account (label + net amount + charge count)
- **Scope**: all-time, `status='succeeded'` and not refunded
- **Refresh**: every 15 min via Vercel cron
- **Visibility**: default public; gate later if Mitch wants

Baseline verified on 2026-04-22:

| Account | Gross Stripe | Matched to EdgeOS (Portal popup only) | **Net (card value)** |
|---|---|---|---|
| The Portal (`acct_1ST3U3BiqMeveVBC`) | $69,676.58 (60 charges) | $47,534.00 (17 charges) | **$22,142.58 (43 charges)** |
| Iceland Eclipse (`acct_1SUU6nDMeFk2ZRT3`) | $71,672.00 (250 charges) | $0 † | **$71,672.00 (250 charges)** |
| **Combined** | | | **$93,814.58** |

† Iceland dedup against EdgeOS was $0 in the discovery spot-check, but that used `getDashboardData()`'s Portal popup scope only. If EdgeOS tracks Iceland applicants under a different `popup_city_id`, some Iceland $5 charges (per-applicant fee) may also overlap. See Open Questions.

## Dedup algorithm

Run at read time in `/api/stripe` so it picks up new EdgeOS records without re-syncing Stripe.

1. Query Supabase: all `stripe_charges` rows where `status='succeeded' and refunded=false`.
2. Query NocoDB: all EdgeOS payments where `status='approved'` (reuse `fetchPayments` from `src/lib/nocodb.ts`).
3. Build an index keyed by `(amount_usd, created_at_date_utc)`.
4. For each Stripe charge, look up `(charge.amount/100, charge.created_date_utc)`:
   - Match → `source='edgeos'`, exclude from card total.
   - No match → `source='stripe_only'`, include.
5. Return per-account net totals + combined.

Use **same-day amount match only** (no ±N-day window). Deterministic and already captured 17/18 real matches in the 2026-04-22 check.

## Supabase migration

New: `supabase/migrations/014_stripe_charges.sql`

```sql
create table stripe_charges (
  id text primary key,                          -- Stripe charge id (ch_…)
  account_key text not null,                    -- 'portal' | 'iceland'
  account_id text not null,                     -- acct_…
  amount_cents integer not null,
  currency text not null,
  status text not null,                         -- 'succeeded' etc
  refunded boolean not null default false,
  amount_refunded_cents integer not null default 0,
  description text,
  statement_descriptor text,
  payment_intent_id text,
  invoice_id text,
  customer_id text,
  customer_email text,
  customer_name text,
  metadata jsonb,
  created_at timestamptz not null,              -- Stripe's created
  synced_at timestamptz not null default now()
);

create index stripe_charges_account_created on stripe_charges (account_key, created_at desc);
create index stripe_charges_amount_date on stripe_charges (amount_cents, (created_at::date));

create table stripe_sync_state (
  account_key text primary key,
  last_synced_at timestamptz,
  last_charge_created_at timestamptz,           -- for incremental sync cursor
  last_charge_id text,
  last_error text
);
```

## Stripe client library

New: `src/lib/stripe.ts`

Thin wrapper — no need for the `stripe` npm package for read-only `/v1/charges` + `/v1/customers`:

```ts
export interface StripeAccountConfig {
  key: string;           // from env
  accountKey: 'portal' | 'iceland';
  accountId: string;     // acct_…
  label: string;
}

export function stripeAccounts(): StripeAccountConfig[] {
  // reads STRIPE_KEY_PORTAL, STRIPE_KEY_ICELAND from env
  // returns only accounts with a configured key
}

export async function fetchAllCharges(cfg: StripeAccountConfig, sinceCreatedAt?: number): Promise<StripeCharge[]>;
export async function fetchCustomer(cfg: StripeAccountConfig, customerId: string): Promise<StripeCustomer | null>;
export function chargeToDbRow(cfg: StripeAccountConfig, c: StripeCharge, cust?: StripeCustomer | null): StripeChargeRow;
```

Uses `fetch` with `Authorization: Basic base64(key:)`. Paginates via `starting_after`. Retries on 5xx/429 with exponential backoff (match patterns in `src/lib/fever.ts`).

Incremental sync: query Stripe with `created[gt]=<last_charge_created_at>` on each run. First run fetches all.

## Cron endpoint

New: `src/app/api/cron/stripe-sync/route.ts`

Mirrors `/api/cron/fever-sync/route.ts`:

- Guards on `STRIPE_KEY_PORTAL` / `STRIPE_KEY_ICELAND` being present (skip gracefully if not).
- For each configured account:
  - Read `stripe_sync_state` cursor.
  - Fetch new charges from Stripe since cursor.
  - For charges with `customer`, batch-fetch customer records (cache within the request).
  - Upsert into `stripe_charges` (primary key collision → update).
  - Update `stripe_sync_state`.
- Returns `{ accountsProcessed, chargesInserted, chargesUpdated, errors }`.

Add to `vercel.json` crons:

```json
{ "path": "/api/cron/stripe-sync", "schedule": "*/15 * * * *" }
```

## Read API

New: `src/app/api/stripe/route.ts`

- `export const dynamic = 'force-dynamic'`
- Response: `s-maxage=60, stale-while-revalidate=300` (match `/api/dashboard`)
- Logic:
  1. Pull all `stripe_charges` rows (filter succeeded, not refunded).
  2. Pull EdgeOS approved payments from NocoDB (reuse existing `fetchPayments` or `getDashboardData`'s payments list).
  3. Apply dedup algorithm above.
  4. Return:
     ```ts
     {
       accounts: {
         portal:  { label: 'The Portal',    netTotal: 22142.58, netCount: 43,  grossTotal: 69676.58, edgeosMatchedTotal: 47534.00, edgeosMatchedCount: 17 },
         iceland: { label: 'Iceland Eclipse', netTotal: 71672.00, netCount: 250, grossTotal: 71672.00, edgeosMatchedTotal: 0, edgeosMatchedCount: 0 },
       },
       combinedNet: 93814.58,
       generatedAt: '2026-04-22T…',
     }
     ```

`gross*` and `edgeosMatched*` stay in the response for auditing ("where'd the other $47K go?" → /api/stripe is authoritative).

## UI

Home page (`src/app/page.tsx`) already has a row of `MetricCard`s and composes `combinedRevenue = approvedRevenue + feverMetrics.totalRevenue`.

Changes:
1. Add `stripeData` state + fetch from `/api/stripe` alongside EdgeOS/Fever fetches.
2. Add one `MetricCard` to the grid (icon: `CreditCard` from lucide):
   - Label: "Stripe Payments"
   - Value: `formatCurrency(stripeData.combinedNet)`
   - Subtext: "excl. EdgeOS" + small "Portal $22k • Iceland $72k" split
3. Update `combinedRevenue` computation to include `stripeData.combinedNet` so the existing "combined" surface (if shown anywhere prominent) reflects Stripe too.

Component changes isolated to `page.tsx`. No new top-level component needed unless the sub-row presentation gets complex — in which case spin out `StripePaymentsCard.tsx` under `components/dashboard/`.

## Secrets

- **Local**: `dashboard/.env.local`
  ```
  STRIPE_KEY_PORTAL=rk_live_...
  STRIPE_KEY_ICELAND=rk_live_...
  ```
- **Vercel**: `vercel env add STRIPE_KEY_PORTAL` (Production + Preview + Development). Same for Iceland. `.env.local` can be refreshed via `vercel env pull`.

Keys stay restricted read-only. Scopes needed: `charges:read`, `payment_intents:read`, `customers:read`, `balance_transactions:read`. Both keys already have these verified on 2026-04-22.

## Verification

1. Run migration: `psql $DATABASE_URL -f supabase/migrations/014_stripe_charges.sql`.
2. Hit `/api/cron/stripe-sync` manually (add `?manual=1` if guarded). Confirm row counts in Supabase match Stripe dashboard (60 Portal + 250 Iceland succeeded all-time).
3. `curl $APP_URL/api/stripe` returns the JSON shape above and matches the baseline table (within drift for new charges landed since).
4. Home page renders the new Metric Card with correct USD formatting.
5. Re-run sync → no duplicate rows (primary key upsert works).

## Out of scope (intentional follow-ups)

- **EdgeOS pending-installment reconciliation.** Florpez/Isa/yainge/madelinefountain have `pending` EdgeOS records despite paying in full via native Stripe Subscriptions. Existing dashboard undercounts cash-in-hand by ~$10–15K. Separate fix, touches `getDashboardData`'s approved-filter.
- **Per-account drill-down / charge list UI.**
- **Subscription vs one-off split on the card.**
- **Partial refund handling beyond the gross-minus-fully-refunded rule.**
- **Fever ↔ Stripe overlap check.** Discovery on 2026-04-22 showed 0 of 24 Iceland Stripe customer emails matched any of Fever's 866 buyers and 0 amount+date matches — so this dedup isn't needed in v1. Revisit if that changes.

## Open questions

1. **EdgeOS scope for Iceland.** `getDashboardData` is scoped to Portal/volunteers (popup_city_id = 3 for vols, Portal for attendees). If Iceland applicants live in the same NocoDB payments table under a different `popup_city_id`, some Iceland Stripe $5 app-fee charges overlap with EdgeOS records. The dedup algorithm above will catch them automatically **if** the read endpoint pulls *all* approved NocoDB payments, not just Portal-scoped ones. Confirm by querying `payments` table unscoped and checking whether the $5 Iceland volume appears there.
2. **Admin-gate the card?** Default public. Flip `page.tsx` to check `isAdmin` if needed.
3. **Iceland key missing `rak_accounts_kyc_basic_read`.** Non-blocking; only needed if we want to auto-read account display name from Stripe instead of hardcoding.
