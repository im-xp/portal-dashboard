# Monitoring & Alerting

System-wide sync health monitoring routes to Slack `#pat-health`.

## Architecture

Two independent observers, either alerting = look at it:

1. **Vercel cron observability** — catches cron errors, timeouts, 5xx. Configured in Vercel dashboard → project → Settings → Integrations → Slack, routed to `#pat-health`.
2. **GitHub Actions watchdog** (`.github/workflows/sync-freshness.yml`) — hourly external check that survives Vercel cron removal. Queries Supabase `*_sync_state.last_sync_at` directly.

The GHA layer exists specifically because Vercel's observability only tracks crons that *exist* in `vercel.json` — if a cron is removed entirely (as fever-sync was during the CIO cleanup, then forgotten for 5 days), Vercel has nothing to alert on. The GHA watchdog catches that case.

## Thresholds

| Source | Cron interval | Alert threshold |
|---|---|---|
| `fever_sync_state` | `*/5 * * * *` | 30 min |
| `stripe_sync_state` | `*/15 * * * *` | 60 min |

Thresholds live in `.github/workflows/sync-freshness.yml` (search for `FEVER_THRESHOLD` / `STRIPE_THRESHOLD`).

## Secrets

Set in repo settings → Secrets and variables → Actions:

- `SUPABASE_DB_URL` — full `postgresql://...` connection string (read-only role preferred)
- `SLACK_WEBHOOK_PAT_HEALTH` — incoming webhook URL for `#pat-health`

## Manual test

```bash
gh workflow run sync-freshness.yml -f force_alert=true
```

With `force_alert=true`, both thresholds drop to 0 so the next run unconditionally posts an alert to `#pat-health`. Use to verify the Slack path end-to-end. Then run again without the flag (or wait for the hourly schedule) to confirm normal-state silence.

## Adding new checks (Phase 2)

To watch a new sync table, extend the `Query sync state ages` and `Evaluate thresholds` steps. The same workflow can monitor Pat hermes-do state once Pat exposes an HTTP health endpoint or its own `*_state` table is reachable from GHA.

If Pat checks require SSH or different auth, add a sibling workflow rather than overloading this one. Keep one channel (`#pat-health`), many watchdogs.

## What happens when an alert fires

Every hour the table is stale, GHA posts another alert. This is intentional in v1 — persisting signal is louder than a one-shot. If it gets annoying, change the schedule to `@daily` after the first alert, or add a state file with `actions/cache` to track healthy→stale transitions only.

## Pausing a cron safely

If you ever need to remove a cron from `vercel.json` (as we did during CIO cleanup):

1. Open a tracking GitHub issue: "Re-enable cron X" with a deadline
2. The GHA watchdog will alert hourly that the table is stale — this is the intended behavior, not a bug
3. To silence during the pause window: temporarily comment out the relevant table in `sync-freshness.yml`. **Add a TODO with the same deadline.**
4. Re-enable the cron + revert the watchdog change together.
