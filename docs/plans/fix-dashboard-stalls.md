# Plan: Fix Dashboard Periodic Data Stalls

## Summary

The dashboard periodically shows blank/zero NocoDB data because of a cascade of issues: sequential external API fetches, no fetch timeouts, silent client-side error swallowing, and a cache design that makes users wait for fresh data when cache expires. The fix applies battle-tested patterns used by production dashboards (Vercel, Linear, Datadog): stale-while-revalidate semantics, parallel fetching, cron-based cache warming, and proper error boundaries.

## Research

### Current Architecture (problems identified)

| Layer | Current | Problem |
|-------|---------|---------|
| **NocoDB fetches** | 5 tables fetched sequentially (`nocodb.ts:256-260`) | 10-15s total if NocoDB is slow. Single slow table blocks everything. |
| **NocoDB fetch timeout** | None. Uses bare `fetch()` with no AbortController | If NocoDB hangs, serverless function blocks until Vercel's 60s limit |
| **Redis cache** | 10min fresh / 30min stale TTL | When cache expires, next user request pays the full fetch cost |
| **Stale fallback** | Only on fetch **error**, not on slow responses | User waits for slow fetch even when stale data exists |
| **Cache warming** | `vercel.json` has `"crons": []` - nothing | Cache goes cold between user visits, causing cold-start stalls |
| **Client error handling** | `fetch('/api/dashboard').then(r => r.json())` - no `r.ok` check | 500 error response parsed as data, `metrics` is undefined, UI shows blanks with no error message |
| **Error UI** | None | User sees loading spinner stop → zeros/empty. No indication anything failed. |
| **People page** | Server component calls `getDashboardData()` directly | Different code path from other pages, but same underlying stall |
| **Affected pages** | `page.tsx`, `applications/page.tsx`, `products/page.tsx`, `people/page.tsx` | Every page independently hits same cache → potential thundering herd on cold cache |

### How Production Apps Handle This

**Stale-while-revalidate (server-side)**: Always return cached data immediately. Trigger background refresh if cache is approaching expiry. Users never wait for a fetch.

**Cron-based cache warming**: A periodic cron job refreshes cache before it expires, so user requests always hit warm cache.

**Parallel external API calls**: Independent API calls run via `Promise.all`, not sequentially.

**Fetch timeouts**: Every external call has an AbortController timeout (5-10s). Fail fast, fall back to stale.

**Client-side resilience**: Check `response.ok`, show error state with retry button, display stale-data indicator.

**Vercel Edge caching**: `Cache-Control: s-maxage=60, stale-while-revalidate=300` lets Vercel's CDN serve cached responses at the edge.

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stale TTL | Increase from 30min to 1h | Safety net for NocoDB outages. Stale data >> no data. |
| People page | Keep as server component | SWR fixes apply at library layer. SSR advantage preserved. |
| Cold start | Accept 5min window | Parallel fetch makes sync path ~5s. Deploy hook not worth the complexity. |
| Caching library | Keep Redis (already working) | No new dependencies. Add cron warming instead. |
| Client data fetching | Keep vanilla fetch (no SWR/react-query) | Adding a lib for 3 pages is overkill. Fix the actual bugs instead. |
| Cache warming | Vercel cron every 5min | Cache TTL is 10min. Cron at 5min means cache is always warm. |
| Background refresh | Serve stale + refresh in background | Biggest UX win. Users never wait for NocoDB. |
| Fetch timeout | AbortController, 5s timeout | NocoDB should respond in <2s. 5s is generous. Fail fast after that. |
| Retry strategy | 1 retry for cron/background, 0 for sync path | Sync path should fail fast to stale fallback. Cron can afford retries. |
| Thundering herd | Redis lock (`SET NX EX`) before background refresh | Prevents multiple serverless instances refreshing simultaneously |
| Parallel failure mode | `Promise.allSettled` not `Promise.all` | Partial data is better than no data. Log which tables failed. |
| Edge caching | `Cache-Control` headers on `/api/dashboard` | Free CDN caching on top of Redis. Reduces serverless invocations. |
| Error state | Inline error banner with retry | Simple, no new components needed. |

## Implementation Approach

### Phase 1: Server-side fixes (eliminates root cause)

**1a. Parallelize NocoDB fetches** (`src/lib/nocodb.ts:253-260`)

```typescript
// BEFORE (sequential - 10-15s)
const applications = await getApplications();
const attendees = await getAttendees();
const products = await getProducts();
const payments = await getPayments();
const paymentProducts = await getPaymentProducts();

// AFTER (parallel - 2-3s)
const [applications, attendees, products, payments, paymentProducts] = await Promise.all([
  getApplications(),
  getAttendees(),
  getProducts(),
  getPayments(),
  getPaymentProducts(),
]);
```

**1b. Add fetch timeout** (`src/lib/nocodb.ts:129-163`)

Add AbortController with 5s timeout to `nocoFetch`. Accept configurable retries (0 for sync path, 1 for background/cron):

```typescript
async function nocoFetch<T>(endpoint: string, retries = 1): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${NOCODB_URL}${endpoint}`, {
        headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      // ... existing error handling ...
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        error = new Error(`NocoDB timeout on ${endpoint} (5s)`);
      }
      if (attempt === retries) throw error;
      await delay(1000 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('NocoDB API: Max retries exceeded');
}
```

**1c. True stale-while-revalidate with refresh lock** (`src/lib/nocodb.ts:232-251`)

Change `getDashboardData` to always return immediately from cache (even stale), then refresh in background. Use a Redis lock to prevent thundering herd (multiple serverless instances refreshing simultaneously):

```typescript
export async function getDashboardData(): Promise<DashboardData> {
  const cacheKey = 'dashboard-data';

  // 1. Try fresh cache
  const cached = await getCached<DashboardData>(cacheKey);
  if (cached) return cached;

  // 2. Try stale cache + trigger background refresh (with lock)
  const stale = await getStaleCached<DashboardData>(cacheKey);
  if (stale) {
    triggerBackgroundRefresh();
    return stale;
  }

  // 3. No cache at all - must fetch synchronously (no retries, fail fast)
  return refreshDashboardCache();
}

async function triggerBackgroundRefresh(): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    // Acquire lock - only one instance refreshes at a time
    const locked = await redis.set('dashboard-refresh-lock', '1', { NX: true, EX: 30 });
    if (!locked) return; // another instance is already refreshing
    refreshDashboardCache().catch(err =>
      console.error('Background refresh failed:', err)
    );
  } catch {
    // Lock acquisition failed, skip refresh
  }
}

export async function refreshDashboardCache(): Promise<DashboardData> {
  const data = await fetchFreshDashboardData();
  await setCache('dashboard-data', data);
  return data;
}
```

**1d. Use `Promise.allSettled` for partial failure resilience** (`fetchFreshDashboardData`)

If one NocoDB table fails, still use data from the others instead of losing everything:

```typescript
const results = await Promise.allSettled([
  getApplications(),
  getAttendees(),
  getProducts(),
  getPayments(),
  getPaymentProducts(),
]);

const [appResult, attResult, prodResult, payResult, ppResult] = results;
const applications = appResult.status === 'fulfilled' ? appResult.value : [];
const attendees = attResult.status === 'fulfilled' ? attResult.value : [];
const products = prodResult.status === 'fulfilled' ? prodResult.value : [];
const payments = payResult.status === 'fulfilled' ? payResult.value : [];
const paymentProducts = ppResult.status === 'fulfilled' ? ppResult.value : [];

const failures = results.filter(r => r.status === 'rejected');
if (failures.length > 0) {
  console.error(`NocoDB: ${failures.length}/5 tables failed:`,
    failures.map(f => (f as PromiseRejectedResult).reason?.message));
}
// If ALL failed, throw so stale fallback kicks in
if (failures.length === results.length) {
  throw new Error('All NocoDB tables failed to fetch');
}
```

### Phase 2: Cache warming cron

**2a. Add cron endpoint** (`src/app/api/cron/warm-cache/route.ts`)

New route that pre-fetches dashboard data into Redis:

```typescript
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await refreshDashboardCache();
  return NextResponse.json({ success: true, warmedAt: new Date().toISOString() });
}
```

**2b. Configure Vercel cron** (`vercel.json`)

```json
{
  "crons": [
    {
      "path": "/api/cron/warm-cache",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

**2c. Exclude from auth middleware** (`src/middleware.ts`)

Already excluded by `api/cron` pattern in matcher. No change needed.

### Phase 3: Client-side resilience

**3a. Check response status** (all pages that fetch `/api/dashboard`)

```typescript
// BEFORE
const edgeosRes = await fetch('/api/dashboard').then(r => r.json());

// AFTER
const res = await fetch('/api/dashboard');
if (!res.ok) throw new Error(`Dashboard API ${res.status}`);
const edgeosRes = await res.json();
```

Apply to: `page.tsx`, `applications/page.tsx`, `products/page.tsx`

**3b. Add error state to dashboard page** (`src/app/page.tsx`)

Add `error` state and display inline banner:

```typescript
const [error, setError] = useState<string | null>(null);

// In fetchEdgeOS:
catch (error) {
  console.error('Failed to fetch EdgeOS data:', error);
  setError('Failed to load EdgeOS data. Retrying...');
}

// In UI (below header):
{error && !edgeosData && (
  <div className="m-4 md:m-8 rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3">
    <AlertCircle className="h-5 w-5 text-red-500" />
    <span className="text-sm text-red-700">{error}</span>
    <Button variant="ghost" size="sm" onClick={handleRefresh}>Retry</Button>
  </div>
)}
```

### Phase 4: Edge caching + observability

**4a. Add Cache-Control and `X-Cache-Status` to API response** (`src/app/api/dashboard/route.ts`)

```typescript
export async function GET() {
  try {
    const startMs = Date.now();
    const data = await getDashboardData();
    const durationMs = Date.now() - startMs;

    // Determine cache status based on timing
    // Fresh cache returns in <50ms, stale in <50ms, miss takes 1s+
    const cacheStatus = durationMs < 100 ? 'HIT' : 'MISS';

    return new NextResponse(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
        'X-Cache-Status': cacheStatus,
        'Server-Timing': `fetch;dur=${durationMs}`,
      },
    });
  } catch (error) {
    console.error('[API] Dashboard data error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

`X-Cache-Status` and `Server-Timing` headers are visible in browser DevTools for debugging. `s-maxage=60, stale-while-revalidate=300` lets Vercel's Edge Network cache the response for 60s, serving stale for up to 5min while revalidating.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/nocodb.ts` | Parallel `Promise.allSettled`, 5s timeout, SWR with refresh lock, export `refreshDashboardCache` |
| `src/app/api/dashboard/route.ts` | `Cache-Control`, `X-Cache-Status`, `Server-Timing` headers |
| `src/app/api/cron/warm-cache/route.ts` | **New file** - cron endpoint for cache warming |
| `vercel.json` | Add cron schedule (every 5min) |
| `src/app/page.tsx` | Check `r.ok`, add error state with retry |
| `src/app/applications/page.tsx` | Check `r.ok` |
| `src/app/products/page.tsx` | Check `r.ok` |

## Resolved Questions

### Q1: Stale TTL → Increase to 1h

**Decision**: `STALE_TTL = 3600` (1 hour)

The stale TTL is a safety net, not normal operation. With cron warming every 5min and fresh TTL at 10min, normal operation never touches stale data. But when things go wrong (NocoDB outage, Vercel cron hiccup), 30min stale means the dashboard goes blank after half an hour. 1h gives 60min of runway showing slightly-stale-but-real data.

For a dashboard showing applications, payments, and revenue, hour-old data is infinitely better than no data.

### Q2: People page → Keep as server component

**Decision**: No change. Keep `people/page.tsx` as a server component.

The SWR changes in `getDashboardData()` already solve the stall at the library layer. When cache is warm (which it always will be with the cron), the server component renders instantly. Converting to a client component would add useState/useEffect/loading/error boilerplate for zero benefit, and would lose the SSR advantage: People page currently renders with data on first paint with no loading skeleton flash.

### Q3: Redis cold start → Accept the 5min window

**Decision**: Accept it. No deploy hook needed.

Math: Cold start = first request must fetch synchronously. With parallel `Promise.allSettled` + 5s timeout, worst case is ~5s (not the 15s it was before). Cron warms the cache within 5min of deployment. This scenario only happens on fresh deploy or Redis flush (rare). A deploy hook adds complexity (webhook config, Vercel API integration, error handling) to save one user one 5-second wait on a rare event.

## Estimated Complexity

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Server fixes | ~30min | Low - straightforward refactor |
| Phase 2: Cron warming | ~15min | Low - new route + config |
| Phase 3: Client resilience | ~20min | Low - error handling |
| Phase 4: Edge caching | ~5min | Low - one header |
| **Total** | **~70min** | **Low** |

## Review Notes

Council of Experts review conducted 2026-02-13.

### Incorporated
- **Refresh lock** (Skeptic): Added Redis `SET NX EX` lock before background refresh to prevent thundering herd
- **`Promise.allSettled`** (Skeptic): Changed from `Promise.all` to `Promise.allSettled` so partial table failures don't lose all data
- **Lower timeout** (Skeptic): Reduced from 8s to 5s. Sync path gets 0 retries (fail fast to stale), cron/background gets 1 retry
- **`X-Cache-Status` header** (Visionary): Added to API response for production debugging visibility
- **`Server-Timing` header**: Added fetch duration for DevTools observability
- **Serverless background execution** (Executor): Note that fire-and-forget in `getDashboardData` works for the API route (response is sent, function stays alive briefly), but the cron job is the real safety net. The background refresh is best-effort.

### Deferred
- **Increase fresh TTL to 15-20min** (Visionary): Validate cron reliability first, then tune. Keep 10min for now.
- **Cron monitoring/alerting** (Executor): Out of scope. Would need Datadog or similar. Note for follow-up.
- **`after()` from `next/server`** (Executor): Valid concern about serverless freezing background promises. However, the cron is the primary refresh mechanism. Background refresh is opportunistic. If it gets killed, the cron catches it within 5min. Not worth the added complexity right now.

### Rejected
- None. All feedback was actionable.

## References

- [Vercel Edge Caching for Serverless Functions](https://vercel.com/docs/functions/serverless-functions/edge-caching)
- [Next.js Caching and Revalidating](https://nextjs.org/docs/app/getting-started/caching-and-revalidating)
- [Stale-While-Revalidate RFC 5861](https://tools.ietf.org/html/rfc5861)
- Existing cron pattern in this codebase: `src/app/api/cron/fever-sync/route.ts`
