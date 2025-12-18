# EdgeOS Admin Dashboard - Architecture Plan

## Executive Summary

A standalone admin dashboard for real-time visibility into popup city operations: applications, attendees, products, and revenue. Designed for internal team decision-making, not end-user facing.

---

## 1. First Principles Analysis

### What Problem Are We Solving?

The core need is **operational visibility**:
- Who has applied? What's their status?
- Who has paid? What did they buy?
- Are we on track for capacity/revenue goals?
- Where are bottlenecks in the funnel?

### Who Is The Audience?

| Role | Needs | Frequency |
|------|-------|-----------|
| Event Organizers | High-level metrics, revenue, capacity | Daily |
| Operations Team | Individual attendee details, check-in status | Real-time |
| Finance | Payment summaries, revenue breakdown | Weekly |

### Data Shape

```
humans (citizens)
    └── applications (1 per popup per person)
            ├── attendees (main + spouse + kids)
            │       └── attendee_products (purchased items)
            └── payments (checkout sessions)
                    └── payment_products (purchase snapshot)
```

**Current scale:** ~6 applicants (test), expected: 100-500 per event
**Data source:** NocoDB REST API (proven working) or direct PostgreSQL

---

## 2. Architecture Decision

### Option Analysis

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **A. Extend EdgeOS (Next.js)** | Shared auth, components, deployment | Mixes user/admin concerns | ❌ |
| **B. Standalone Next.js dashboard** | Clean separation, focused, full control | New deployment | ✅ |
| **C. Off-the-shelf (Metabase/Retool)** | Fast setup, no code | Less customizable, external dependency | ❌ |
| **D. Python (Streamlit/Dash)** | Great for data science | Different stack, less polished UI | ❌ |

### Chosen: **Standalone Next.js Dashboard**

**Rationale:**
1. Consistency with existing codebase (Next.js, Tailwind, TypeScript)
2. Full control over UX and features
3. Can deploy independently (Vercel, or alongside API)
4. Team already knows the stack
5. Clean separation of concerns (user portal vs admin dashboard)

---

## 3. Technical Architecture

### Stack

```
┌─────────────────────────────────────────────────────────────┐
│                      DASHBOARD (Next.js 15)                  │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                    │
│  ├── Tailwind CSS (styling)                                 │
│  ├── shadcn/ui (component library - matches EdgeOS)         │
│  ├── Recharts (charts/visualizations)                       │
│  └── TanStack Table (data grids with filtering/sorting)     │
├─────────────────────────────────────────────────────────────┤
│  Data Layer                                                  │
│  ├── TanStack Query (data fetching, caching)                │
│  ├── NocoDB REST API (primary data source)                  │
│  └── Zod (runtime type validation)                          │
├─────────────────────────────────────────────────────────────┤
│  Auth Layer (Phase 2)                                        │
│  └── Simple API key or shared auth with EdgeOS              │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                    NocoDB REST API                           │
│  Base URL: https://app.nocodb.com/api/v2                    │
│  Auth: xc-token header                                       │
├─────────────────────────────────────────────────────────────┤
│  Tables:                                                     │
│  ├── applications (mhiveeaf8gb9kvy)                         │
│  ├── attendees (mduqna6ve55k8wi)                            │
│  ├── products (mjt8xx9ltkhfcbu)                             │
│  └── payments (TBD - need table ID)                         │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
dashboard/
├── context/
│   └── ARCHITECTURE.md          # This file
├── src/
│   ├── app/
│   │   ├── layout.tsx           # Root layout with providers
│   │   ├── page.tsx             # Overview dashboard
│   │   ├── attendees/
│   │   │   └── page.tsx         # Attendee list/details
│   │   ├── products/
│   │   │   └── page.tsx         # Product sales breakdown
│   │   ├── applications/
│   │   │   └── page.tsx         # Application funnel
│   │   └── revenue/
│   │       └── page.tsx         # Revenue analytics
│   ├── components/
│   │   ├── charts/              # Chart components
│   │   ├── tables/              # Data table components
│   │   ├── filters/             # Filter controls
│   │   └── layout/              # Navigation, sidebar
│   ├── lib/
│   │   ├── nocodb.ts            # NocoDB API client
│   │   ├── types.ts             # TypeScript types
│   │   └── utils.ts             # Helpers
│   └── hooks/
│       ├── useApplications.ts
│       ├── useAttendees.ts
│       └── useProducts.ts
├── public/
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── .env.local                   # NOCODB_TOKEN, NOCODB_URL
```

---

## 4. Dashboard Views

### 4.1 Overview (Home)

**Purpose:** At-a-glance health check of the event

```
┌────────────────────────────────────────────────────────────┐
│  THE PORTAL AT ICELAND ECLIPSE                    [Event ▼]│
├────────────┬────────────┬────────────┬────────────────────┤
│ APPLICANTS │  ACCEPTED  │    PAID    │     REVENUE        │
│     127    │    98      │     76     │    $45,200         │
│            │   (77%)    │   (78%)    │                    │
├────────────┴────────────┴────────────┴────────────────────┤
│                                                            │
│  APPLICATION FUNNEL              REVENUE BY CATEGORY       │
│  ┌──────────────────┐            ┌──────────────────┐     │
│  │ ████████████ 127 │ Applied    │ ████████ Entry   │     │
│  │ ██████████   98  │ Accepted   │ ██████ Lodging   │     │
│  │ ████████     76  │ Paid       │ ██ Extras        │     │
│  └──────────────────┘            └──────────────────┘     │
│                                                            │
│  RECENT ACTIVITY                                           │
│  • Mia Hanak submitted application (2h ago)               │
│  • MaryLiz Bender purchased Portal Entry Pass (1d ago)    │
│  • james ellington accepted (1d ago)                      │
└────────────────────────────────────────────────────────────┘
```

### 4.2 Attendees View

**Purpose:** Individual-level detail, search, filter, export

| Feature | Description |
|---------|-------------|
| **Search** | By name, email, telegram |
| **Filter** | By status (applied/accepted/paid), by product purchased, by category (main/spouse/kid) |
| **Sort** | By date, name, payment amount |
| **Detail Panel** | Click row to see full profile + purchase history |
| **Export** | CSV download |

```
┌────────────────────────────────────────────────────────────┐
│  ATTENDEES                              [Export CSV]       │
├────────────────────────────────────────────────────────────┤
│  🔍 Search...        Status: [All ▼]  Has Product: [All ▼]│
├────────────────────────────────────────────────────────────┤
│  NAME           │ EMAIL              │ STATUS  │ PRODUCTS  │
│─────────────────┼────────────────────┼─────────┼───────────│
│  MaryLiz Bender │ maryliz@im-xp.com  │ ✅ Paid │ 2 items   │
│  Mitch Morales  │ mitch@im-xp.com    │ ✅ Paid │ 1 item    │
│  James Ellington│ james@im-xp.com    │ ⏳ Unpaid│ -         │
│  ...            │                    │         │           │
└────────────────────────────────────────────────────────────┘
```

### 4.3 Products View

**Purpose:** What's selling, inventory/capacity tracking

| Metric | Description |
|--------|-------------|
| **Sales by Product** | Units sold per product |
| **Revenue by Product** | $ per product |
| **Capacity** | For lodging: sold vs available |
| **Trends** | Sales velocity over time |

```
┌────────────────────────────────────────────────────────────┐
│  PRODUCTS                                                  │
├────────────────────────────────────────────────────────────┤
│  PRODUCT                    │ SOLD │ REVENUE │ CAPACITY   │
│─────────────────────────────┼──────┼─────────┼────────────│
│  Portal Entry Pass          │  3   │ $2,100  │ ∞          │
│  Bed (Bunk) 4-person dorm   │  2   │ $1,600  │ 2/20 (10%) │
│  Portal Patron              │  1   │ $5,000  │ 1/10 (10%) │
│  ...                        │      │         │            │
├────────────────────────────────────────────────────────────┤
│  SALES OVER TIME                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │      ╭──╮                                            │ │
│  │   ╭──╯  ╰──╮                                        │ │
│  │ ──╯        ╰────                                    │ │
│  │ Dec 10    Dec 13    Dec 16    Dec 17               │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### 4.4 Applications View

**Purpose:** Review pipeline, identify stuck applications

| Feature | Description |
|---------|-------------|
| **Funnel** | Visual pipeline (draft → submitted → accepted → paid) |
| **Stuck Detection** | Highlight accepted but unpaid > 7 days |
| **Bulk Actions** | Send reminders, export lists |

---

## 5. Implementation Phases

### Phase 1: Foundation (MVP)
- [ ] Next.js project setup with Tailwind + shadcn/ui
- [ ] NocoDB API client with type definitions
- [ ] Basic overview page with key metrics
- [ ] Attendees table with search/filter
- [ ] Products breakdown

**Deliverable:** Working dashboard showing current state of applicants + purchases

### Phase 2: Enhanced Analytics
- [ ] Application funnel visualization
- [ ] Revenue charts over time
- [ ] Capacity tracking for lodging
- [ ] Export to CSV

### Phase 3: Operations Features
- [ ] Real-time updates (polling or webhooks)
- [ ] Authentication (protect dashboard)
- [ ] Multi-event support (dropdown to switch popups)
- [ ] Email integration (send reminders from dashboard)

---

## 6. Data Fetching Strategy

### NocoDB API Patterns

```typescript
// Base configuration
const NOCODB_BASE = 'https://app.nocodb.com/api/v2';
const TABLES = {
  applications: 'mhiveeaf8gb9kvy',
  attendees: 'mduqna6ve55k8wi',
  products: 'mjt8xx9ltkhfcbu',
} as const;

// Fetch with linked records
async function getAttendeesWithProducts() {
  const attendees = await fetch(
    `${NOCODB_BASE}/tables/${TABLES.attendees}/records?limit=100`,
    { headers: { 'xc-token': process.env.NOCODB_TOKEN } }
  );
  
  // For each attendee, fetch linked products
  // Column ID for products link: cjc8h3w216z8n9j
  for (const attendee of attendees.list) {
    const products = await fetch(
      `${NOCODB_BASE}/tables/${TABLES.attendees}/links/cjc8h3w216z8n9j/records/${attendee.id}`,
      { headers: { 'xc-token': process.env.NOCODB_TOKEN } }
    );
    attendee.products = products.list;
  }
  
  return attendees;
}
```

### Caching Strategy

- Use **TanStack Query** with 30-second stale time
- Background refetch on window focus
- Manual refresh button for real-time needs

---

## 7. Key Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Standalone vs integrated | Standalone | Clean separation, focused UX |
| Data source | NocoDB API | Already proven, no backend changes needed |
| Charts library | Recharts | React-native, good docs, lightweight |
| Table library | TanStack Table | Best-in-class filtering/sorting, headless |
| Styling | Tailwind + shadcn/ui | Matches EdgeOS, fast development |

---

## 8. Environment Variables

```bash
# .env.local
NOCODB_URL=https://app.nocodb.com/api/v2
NOCODB_TOKEN=emniaU0j0C2TnH8O82wCiYRWQSxREBk3ZBlChbIc
```

---

## 9. Next Steps

1. **Initialize Next.js project** with TypeScript, Tailwind, shadcn/ui
2. **Build NocoDB client** with typed responses
3. **Create overview page** with key metrics
4. **Build attendees table** with TanStack Table
5. **Add product breakdown** view
6. **Iterate based on feedback**

---

*Document created: December 17, 2025*
*Author: AI Assistant + Jon*

