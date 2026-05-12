# Monitoring & Alerting

System-wide sync health monitoring routes to Slack `#pat-health`.

## Architecture

Single external observer: a GitHub Actions watchdog (`.github/workflows/sync-freshness.yml`) running hourly. Queries Supabase `*_sync_state` rows directly and posts to `#pat-health` when freshness thresholds are exceeded.

This is sufficient on its own because the watchdog catches every cron failure mode — including the one Vercel's own observability can't.

| Failure mode | GHA watchdog catches |
|---|---|
| Cron removed from `vercel.json` | yes — table goes stale, alert fires |
| Cron erroring every run | yes — `last_sync_at` doesn't advance |
| Cron timing out | yes — same as above |
| Cron healthy but API empty | N/A — route still updates `last_sync_at` on successful empty runs, which is correct |

### Why not Vercel → Slack alerts

Considered and rejected. Vercel's native cron-failure alerting requires the paid **Observability Plus** add-on. The free Slack integration in the Marketplace covers deployment status, comments, and new projects — not cron failures. Adding it would post deployment noise to `#pat-health` without contributing to cron coverage.

If real-time native alerts ever become worth the price (vs. hourly GHA polling), upgrade to Observability Plus and configure project alerts at `/observability/alerts`.

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
