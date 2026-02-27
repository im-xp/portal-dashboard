# Plan: Volunteer Dashboard

## Summary

Add a "Volunteers" page to the existing portal dashboard that displays volunteer application data from NocoDB (popup_city_id=3). Includes a lightweight permissions layer: `volunteers@icelandeclipse.com` sees only the Volunteers page; all other `@im-xp.com` / `@icelandeclipse.com` users see everything as before. Data comes from the same NocoDB applications table, filtered to the volunteer popup, with `custom_data` JSON parsed for volunteer-specific fields.

## Research

### Existing Patterns
- Dashboard is Next.js 16 + React 19, Tailwind 4, shadcn/ui components
- Auth: NextAuth Google OAuth, domain allow-list (`im-xp.com`, `icelandeclipse.com`), no roles
- Data: NocoDB REST API via `lib/nocodb.ts` with Redis caching, paginated fetcher
- Pages: Mix of server components (People) and client components (Overview, Applications)
- Navigation: Hardcoded array in `Sidebar.tsx`

### Volunteer Data Shape
- Applications table (`mhiveeaf8gb9kvy`), filtered by `popup_city_id=3`
- `first_name`/`last_name` are EMPTY for all volunteers (names in `custom_data.full_name`)
- `custom_data` JSON contains: full_name, phone_number, volunteer_type, available_phases, team_preferences, talents_skills, skills_description, festival_experience, team_contribution, emergency contacts, agreement, etc.
- `residence` is populated on the standard record
- Statuses: `draft` (started, fee unpaid) and `in review` (fee paid, submitted)

### Options Considered

**Data fetching approach**: Reuse `getDashboardData()` vs. dedicated volunteer fetcher
- Chosen: Dedicated fetcher. `getDashboardData()` pulls all 5 tables with heavy revenue/product processing that volunteers don't need. A targeted fetch of just applications where `popup_city_id=3` is faster and simpler.

**Permissions approach**: Middleware vs. session-level role
- Chosen: Session-level role. Add a `role` field to the JWT/session based on email. Sidebar filters nav items by role. Middleware redirects restricted users away from pages they can't access.

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source | Dedicated NocoDB fetch for volunteer apps only | Avoid loading all 5 tables + revenue calcs for a simple application list |
| Caching | Reuse existing Redis pattern with `volunteer-data` key | Consistent with codebase, 10min fresh / 1hr stale |
| Permissions model | `role` field on session (`admin` vs `volunteer_viewer`) | Minimal change, email-based lookup at sign-in, easy to extend later |
| Permission enforcement | Sidebar filtering + middleware redirect | Defense in depth: UI hides links AND server blocks access |
| Page type | Client component with `/api/volunteers` route | Matches Applications page pattern (client fetch + filter/sort state) |
| Detail view | Slide-out panel (shadcn Sheet) | 20+ fields across 5 sections need room; expandable row too cramped |
| Name display | Parse `custom_data.full_name` | `first_name`/`last_name` are empty for all volunteer apps |

## Implementation Approach

### Phase 0: Filter Volunteers from Existing Views

**Why:** `getApplications()` in `nocodb.ts` fetches ALL applications with no popup filter. The 26 volunteer apps (popup_city_id=3) currently appear in the Applications page, People page, and Overview metrics. They need to be excluded from the main dashboard data.

**Files to modify:**
- `src/lib/nocodb.ts` - Add `where=(popup_city_id,neq,3)` filter to `getApplications()`, OR filter in `getDashboardData()` processing

**Approach:** Filter at the `getApplications()` level since volunteer apps have empty `first_name`/`last_name` and a completely different data shape that makes them noise in every existing view. This is the simplest change with broadest effect.

### Phase 1: Permissions Layer

**Files to modify:**
- `src/lib/auth.ts` - Add role resolution
- `src/middleware.ts` - Add route-based access control
- `src/components/layout/Sidebar.tsx` - Filter nav by role
- `src/components/layout/MobileNav.tsx` - Same filtering

**Logic:**
```
Role resolution (in auth.ts signIn/jwt callbacks):
  if email === 'volunteers@icelandeclipse.com' → role = 'volunteer_viewer'
  else → role = 'admin'

Route access (in middleware.ts):
  if token.role is falsy → redirect to sign-in (deny by default)
  volunteer_viewer can ONLY access: /, /volunteers, /auth/*, /api/auth/*, /api/volunteers
  admin can access everything

Sidebar (in Sidebar.tsx):
  Add `roles?: string[]` to nav items
  Volunteers link: visible to all roles
  Other links: visible to 'admin' only
  Filter navigation array based on session role
```

### Phase 2: Volunteer API Route

**New file:** `src/app/api/volunteers/route.ts`

Fetches applications from NocoDB filtered to `popup_city_id=3`, parses `custom_data`, returns typed response. Uses existing `nocoFetchAll` + Redis cache pattern.

**New types in `src/lib/types.ts`:**
```typescript
interface VolunteerCustomData {
  // Displayed fields (required with fallbacks)
  full_name?: string;
  phone_number?: string;
  volunteer_type?: string;
  available_phases?: string[];
  team_preferences?: string[];
  talents_skills?: string[];
  skills_description?: string;
  festival_experience?: string;
  team_contribution?: string;
  build_experience?: string;
  eclipse_attendance?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  // Non-displayed fields
  city_town?: string;
  state_option?: string;
  staff_referral?: string;
  referral_name?: string;
  medical_conditions?: string;
  accommodations_needed?: string;
  ticket_type?: string;
  newsletter_opt_in?: string;
  agreement_consent?: boolean;
  agreement_date?: string;
  has_chosen_name?: boolean;
  chosen_name?: string;
  data_privacy_consent?: boolean;
  // Future-proof: form fields may be added without type updates
  [key: string]: unknown;
}

interface VolunteerApplication {
  id: number;
  email: string;
  status: string;
  residence: string | null;
  custom_data: VolunteerCustomData;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

interface VolunteerMetrics {
  total: number;
  drafts: number;
  inReview: number;
  approved: number;
  rejected: number;
}

interface VolunteerDashboardData {
  metrics: VolunteerMetrics;
  applications: VolunteerApplication[];
}
```

### Phase 3: Volunteers Page

**New file:** `src/app/volunteers/page.tsx`

**Layout:**
1. **Header**: "Volunteers" title, "Track volunteer applications for Iceland Eclipse"
2. **Funnel metrics row** (4 cards):
   - Total Applications (all)
   - Drafts (started, fee unpaid)
   - Submitted / In Review (fee paid)
   - Approved (future, currently 0)
3. **Filterable table** of applications:
   - Columns: Name, Email, Status, Volunteer Type, Available Phases, Teams, Submitted
   - Filter tabs: All / Draft / In Review / Approved
   - Sort by submission date (newest first)
   - Click row to expand details
4. **Slide-out detail panel** (shadcn Sheet component):
   - Full application data parsed from `custom_data` with defensive optional chaining
   - Organized into sections matching the form: About, Experience, Availability & Teams, Special Accommodations, Emergency Contact

### Phase 4: Sidebar & Navigation

**Modify:** `src/components/layout/Sidebar.tsx`

Add Volunteers nav item with `HandHeart` or `HardHat` icon from lucide-react. Position after Applications.

Add role-based filtering so `volunteer_viewer` role only sees: Overview (redirect to /volunteers) and Volunteers.

Actually, simpler: for `volunteer_viewer`, redirect `/` to `/volunteers` and only show the Volunteers link.

## Open Questions

1. ~~Jesse's email~~ → Resolved: `volunteers@icelandeclipse.com`
2. Should `volunteer_viewer` see a stripped-down Overview page or just redirect straight to `/volunteers`? **Recommendation**: Redirect `/` to `/volunteers` for volunteer_viewer role.
3. Do we need search/text filtering on the volunteer list, or are status tabs sufficient for 26 apps? **Recommendation**: Add a simple search box (name/email) since app count will grow toward 1,200.
4. Should the volunteer detail view show the agreement signature image? **Recommendation**: No, it's a large base64 blob. Just show "Signed on [date]".
5. Recovery procedure if `volunteers@icelandeclipse.com` Google account is compromised or changed? (Ops concern, not code.)
6. **Pending from Tule**: Accepted volunteers need to show which track they were accepted into (Long Build, Short Build, etc.). Tule is adding a field to the backend for track assignment at acceptance time. Dashboard will need to surface this once the field exists.

## Estimated Complexity

| Phase | Effort | Files |
|-------|--------|-------|
| Phase 0: Filter volunteers from existing views | ~15 min | 1 modified |
| Phase 1: Permissions | ~1 hour | 4 modified |
| Phase 2: API Route | ~30 min | 2 new, 1 modified (types) |
| Phase 3: Volunteers Page | ~2 hours | 1-2 new files |
| Phase 4: Sidebar + Nav | ~30 min | 2 modified |
| **Total** | **~4 hours** | **3-4 new, 5-6 modified** |

## Review Notes

Council of Experts review conducted 2026-02-27.

### Incorporated
- Middleware must deny by default when `token.role` is falsy (prevents access during token refresh edge case)
- `VolunteerCustomData` fields all optional with `[key: string]: unknown` index signature (form fields drift as frontend team evolves the form)
- Committed to slide-out panel (shadcn Sheet) over expandable row (20+ fields across 5 sections need room)
- Phases 1 & 2 are independent and can be built in parallel

### Deferred
- Role lookup table instead of hardcoded if/else (only 2 roles, refactor when third appears)
- API response shape for external consumers (no external consumers planned)
- Account recovery procedure for `volunteers@icelandeclipse.com` (ops concern, noted in open questions)
- Estimate precision (guidance, not commitment)

### Rejected
- None

## References

- NocoDB volunteer popup: id=3, slug=`iceland-eclipse-volunteers`, 26 applications
- Existing NocoDB client: `src/lib/nocodb.ts` (paginated fetcher, Redis cache)
- Auth config: `src/lib/auth.ts` (NextAuth, Google OAuth)
- Sidebar: `src/components/layout/Sidebar.tsx` (hardcoded nav array)
- Applications page pattern: `src/app/applications/page.tsx` (client component with API fetch)
- Jon <> Mitch call Feb 23: Volunteer dashboard scope, Jesse permissions
- Context doc: `docs/volunteer-dashboard.md`
