# Plan: Product Segments + Application Review

## Summary

Jesse needs the dashboard to support a new application review workflow with product segments. Francisco deployed backend changes to the EdgeOS API that add:
1. A `PATCH /applications/{id}/review` endpoint for accepting/rejecting applications with optional segment assignment
2. A `GET /product-segments/` endpoint to list available segments per popup city
3. Automatic product filtering for end users based on assigned segments

The dashboard currently has NO review functionality and NO connection to the EdgeOS API (it reads everything from NocoDB). This plan adds a review UI and wires it to the new API endpoints.

## Current State

### Data Flow

```
PostgreSQL (EdgeOS RDS) → NocoDB → Dashboard (nocodb.ts)
```

The dashboard is read-only. All data comes from NocoDB tables. There is no write path and no EdgeOS API client.

### Where Applications Are Displayed

- `src/app/applications/page.tsx` - Application list with status counts, no review actions
- `src/app/people/PeopleTable.tsx` - People table filtered by journey stage (post-acceptance only)
- `src/lib/nocodb.ts` - Fetches applications from NocoDB, no write operations
- `src/lib/types.ts` - `Application` type has `discount_assigned` but no `product_segment_ids`

### What Doesn't Exist

| Capability | Status |
|-----------|--------|
| EdgeOS API client | Does not exist |
| Review endpoint integration | Does not exist |
| Product segments UI | Does not exist |
| Accept/reject buttons | Do not exist |
| Segment selector | Does not exist |
| `APPLICATION_REVIEW_API_KEY` env var | Not configured |

## Backend API (production, verified from code on `origin/main`)

### Review Endpoint

```
PATCH /applications/{application_id}/review
Header: x-api-key: <APPLICATION_REVIEW_API_KEY>
```

Request body:
```json
{
  "status": "accepted",           // "accepted" | "rejected"
  "discount_assigned": 70,        // 0-100, optional (defaults to 0 on accept)
  "segment_slugs": ["long-build"] // string[], required when popup has segments
}
```

Rules:
- `segment_slugs` only matters when `status` is `"accepted"`. Ignored on rejection.
- If popup city has segments configured, `segment_slugs` is required when accepting (400 if missing).
- If popup city has no segments, omit `segment_slugs` or set to `null`.
- Invalid slug returns 400.
- Rejection clears `discount_assigned`, `accepted_at`, and `product_segments`.

Response: full Application object with `product_segment_ids: number[]`.

### Segments Endpoint

```
GET /product-segments/?popup_city_slug={slug}
Header: x-api-key: <APPLICATION_REVIEW_API_KEY>
```

Response:
```json
[
  {
    "id": 1,
    "name": "VIP",
    "slug": "vip",
    "description": "VIP ticket holders",
    "popup_city_id": 5,
    "products": [{ "id": 10, "name": "VIP Pass", "slug": "vip-pass", "price": 500.0 }],
    "created_at": "2026-03-19T00:00:00",
    "updated_at": "2026-03-19T00:00:00"
  }
]
```

Returns empty list if popup has no segments configured.

### Auth

Both endpoints use `x-api-key` header with `APPLICATION_REVIEW_API_KEY` value. Returns 403 on invalid key.

## Implementation Steps

### Step 1: Add EdgeOS API Client

Create `src/lib/edgeos-api.ts` with:
- Base URL from `EDGEOS_API_URL` env var
- API key from `APPLICATION_REVIEW_API_KEY` env var
- `fetchSegments(popupCitySlug: string)` - GET segments for a popup
- `reviewApplication(applicationId: number, body: ReviewBody)` - PATCH review

Types needed (add to `src/lib/types.ts`):
```typescript
interface ProductSegment {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  popup_city_id: number;
  products: Product[];
  created_at: string;
  updated_at: string;
}

interface ReviewApplicationBody {
  status: 'accepted' | 'rejected';
  discount_assigned?: number;
  segment_slugs?: string[];
}
```

### Step 2: Add API Routes (Next.js server-side proxy)

The dashboard runs on Vercel. Browser can't call EdgeOS directly (API key would be exposed). Add Next.js API routes:

- `src/app/api/segments/route.ts` - GET handler that proxies to EdgeOS segments endpoint
- `src/app/api/applications/[id]/review/route.ts` - PATCH handler that proxies to EdgeOS review endpoint

Both routes read API key from server env, so the key never reaches the browser.

### Step 3: Add Env Vars

Add to `.env.local` and Vercel:
- `EDGEOS_API_URL` - Production: `https://theportalapi.icelandeclipse.com` (develop: `https://api-develop.icelandeclipse.com`)
- `APPLICATION_REVIEW_API_KEY` - Get from EdgeOS deployment config or ask Francisco

### Step 4: Update Applications Page with Review UI

Current `src/app/applications/page.tsx` is a read-only list. Add:

1. **Expandable row or detail panel** (match the pattern in `PeopleTable.tsx`) showing full application details
2. **Accept/Reject buttons** that call the new API routes
3. **Segment selector** (multi-select dropdown) that appears when accepting, populated from the segments endpoint
4. **Discount input** (number 0-100) that appears when accepting
5. **Loading/error states** for the review action
6. **Optimistic UI or refetch** after review to update the application's status in the list

### Step 5: Fetch Segments on Page Load

When the applications page loads:
1. Get the list of popup cities (already fetched)
2. For the selected popup city, call `GET /api/segments?popup_city_slug={slug}`
3. If segments come back empty, hide the segment selector in the review UI
4. If segments exist, show multi-select and make it required for acceptance

Cache segments per popup city (they don't change often). Refetch when switching popup cities.

### Step 6: Wire Up Review Flow

When reviewer clicks "Accept":
1. Validate segment selection (if popup has segments)
2. POST to `/api/applications/{id}/review` with `{ status: "accepted", discount_assigned, segment_slugs }`
3. On success: update local state (move app from "in review" to "accepted"), clear dashboard cache, show success toast
4. On error: show error message (e.g. "Segment required for this popup city")

When reviewer clicks "Reject":
1. POST to `/api/applications/{id}/review` with `{ status: "rejected" }`
2. On success: update local state, clear dashboard cache

### Step 7: Clear Dashboard Cache on Review

After a successful review, call `POST /api/refresh` (existing endpoint that calls `clearCache()`) so the NocoDB-sourced dashboard data refreshes to reflect the status change.

## File Changes

| File | Action | What |
|------|--------|------|
| `src/lib/types.ts` | Edit | Add `ProductSegment`, `ReviewApplicationBody` types |
| `src/lib/edgeos-api.ts` | Create | EdgeOS API client (segments + review) |
| `src/app/api/segments/route.ts` | Create | Server-side proxy for segments endpoint |
| `src/app/api/applications/[id]/review/route.ts` | Create | Server-side proxy for review endpoint |
| `src/app/applications/page.tsx` | Edit | Add review UI (accept/reject, segment picker, discount) |
| `.env.local` | Edit | Add `EDGEOS_API_URL`, `APPLICATION_REVIEW_API_KEY` |

## Open Questions

1. **~~What is the EdgeOS API production URL?~~** Resolved: `https://theportalapi.icelandeclipse.com`
2. **~~What is the prod `APPLICATION_REVIEW_API_KEY` value?~~** Resolved.
3. **~~Which popup city slug to use for Iceland?~~** Resolved. Production popup cities from NocoDB `popups` table:
   - id 1: `iceland-eclipse-preapproved` ("The Portal at Iceland Eclipse")
   - id 2: `ripple-on-the-nile` ("Ripple on the Nile")
   - id 3: `iceland-eclipse-volunteers` ("Iceland Eclipse Volunteers")

   **Important:** The dashboard currently derives slugs from `popups.name` via `name.toLowerCase().replace(/\s+/g, '-')`, which produces DIFFERENT slugs (e.g. `the-portal-at-iceland-eclipse` vs `iceland-eclipse-preapproved`). Must fix `getPopupCities()` in `nocodb.ts` to use the actual `slug` column from the popups record.
4. **Should the review UI filter to "in review" applications by default?** Currently shows all statuses. Probably should default to "in review" for the review workflow.
5. **Does Jesse want bulk review?** The API is per-application. If bulk is needed, we'd loop client-side. Worth confirming scope.

## Context from Telegram (SimpleFi chat, 2026-03-18 through 2026-03-24)

- **Prod is live** (Francisco confirmed "it's live" on 3/23)
- **Emails disabled** in review endpoint for now. Francisco disabled the email logic since Postmark templates aren't ready (msg 909). Jesse shared acceptance email template in a Google Doc.
- **Jesse's timeline:** Wants to review all applications before sending acceptance emails at end of March.
- **Safe to develop on prod** since changes are dashboard-only (confirmed by Jesse, msg 897).
- **Future work:** Jesse wants a pipeline to send confirmed volunteer data to Shift Happens' Airtable for scheduling (msg 901). Out of scope for this plan.
- **New application question requested:** Bjarni from Iceland Team wants to add English fluency question (msg 908). Out of scope for this plan.

## Notes

- Francisco's writeup had a typo: he said `segments_slugs` but the actual API field is `segment_slugs` (no extra 's').
- The API returns `product_segment_ids` (plural array of ints), not `product_segment_id` (singular).
- The dashboard's NocoDB data will eventually reflect segment assignments (since NocoDB reads from the same PostgreSQL), but there may be a delay. The review response itself has the updated data.
- Application IDs in NocoDB match the EdgeOS API (confirmed by Francisco, msg 821).
