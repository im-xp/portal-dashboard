-- Updated-date watermark for the incremental Fever sync.
--
-- The incremental cron previously tracked last_order_created_at and filtered
-- Fever by CREATED_DATE_UTC, so once an order aged past the watermark it was
-- never re-fetched. A later cancellation/refund therefore never updated
-- Supabase and its items stayed 'purchased' forever — silently over-counting
-- revenue (~$46k, found 2026-06-11).
--
-- The sync now filters by UPDATED_DATE_UTC and tracks this column instead. A
-- status change bumps the order's updated_date_utc, so modified orders of any
-- age are re-fetched; a new order's updated date ≈ its created date, so the
-- single pass still captures new orders. last_order_created_at is retained for
-- observability.
ALTER TABLE fever_sync_state
  ADD COLUMN IF NOT EXISTS last_order_updated_at timestamptz;

-- Seed from the existing created-date watermark so the first updated-date run
-- starts from a sane, recent point. Idempotent upserts make the overlap safe.
UPDATE fever_sync_state
  SET last_order_updated_at = COALESCE(last_order_updated_at, last_order_created_at)
  WHERE id = 1;
