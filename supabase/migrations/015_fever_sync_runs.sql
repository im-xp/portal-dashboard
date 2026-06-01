-- Per-run logging table for the Fever sync cron.
--
-- Companion to fever_sync_state (single-row cursor). Every invocation of
-- runSync writes one row here: kind tells you what triggered the run,
-- errors is a jsonb array of per-batch failure messages, reconciliation is
-- populated for kind='health-check' (Phase 3b) with day-level deltas vs
-- Fever's own counts, and watermark_advanced_to is null when an error
-- held the watermark.
--
-- Pat (hermes-side) polls this table to surface failed runs and
-- reconciliation drift to #pat-health. Detection lives on Vercel (this
-- table is the bridge); messaging lives on Pat.

CREATE TABLE fever_sync_runs (
  id              bigserial PRIMARY KEY,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  kind            text NOT NULL CHECK (kind IN ('incremental','manual','health-check')),
  orders_fetched  int,
  orders_inserted int,
  orders_updated  int,
  errors          jsonb,
  reconciliation  jsonb,
  watermark_advanced_to timestamptz,
  skipped_segment boolean DEFAULT false
);

CREATE INDEX idx_fever_sync_runs_started_at ON fever_sync_runs (started_at DESC);
