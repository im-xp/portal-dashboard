-- Stripe charges import tables (materialized cache from Stripe /v1/charges)
-- Supports two accounts: 'portal' (The Portal) and 'iceland' (Iceland Eclipse).

CREATE TABLE stripe_charges (
  id TEXT PRIMARY KEY,                            -- Stripe charge id (ch_…)
  account_key TEXT NOT NULL,                      -- 'portal' | 'iceland'
  account_id TEXT NOT NULL,                       -- acct_…

  -- Money
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  amount_refunded_cents INTEGER NOT NULL DEFAULT 0,
  refunded BOOLEAN NOT NULL DEFAULT FALSE,

  -- State
  status TEXT NOT NULL,                           -- 'succeeded' | 'pending' | 'failed'
  description TEXT,
  statement_descriptor TEXT,

  -- Refs (kept nullable; we skip /v1/customers enrichment in v1)
  payment_intent_id TEXT,
  invoice_id TEXT,
  customer_id TEXT,

  -- Buyer info pulled from charge.billing_details (no customer fetch needed)
  billing_email TEXT,
  billing_name TEXT,

  -- Flexible storage
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL,                -- Stripe's `created`
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_charges_account_created ON stripe_charges (account_key, created_at DESC);
CREATE INDEX idx_stripe_charges_status ON stripe_charges (status);
CREATE INDEX idx_stripe_charges_billing_email ON stripe_charges (billing_email);

-- Per-account incremental sync cursor
CREATE TABLE stripe_sync_state (
  account_key TEXT PRIMARY KEY,                   -- 'portal' | 'iceland'
  last_synced_at TIMESTAMPTZ,
  last_charge_created_at TIMESTAMPTZ,             -- cursor for `created[gt]` on next run
  last_charge_id TEXT,
  charges_synced INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed rows so the cron can read-before-write without special-casing first run
INSERT INTO stripe_sync_state (account_key) VALUES ('portal'), ('iceland');
