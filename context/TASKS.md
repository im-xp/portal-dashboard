# Dashboard Implementation Tasks

## Phase 1: Foundation (MVP)

### 1.1 Project Setup
- [ ] Initialize Next.js 15 with TypeScript
- [ ] Configure Tailwind CSS
- [ ] Install and configure shadcn/ui
- [ ] Set up environment variables (.env.local)
- [ ] Create base layout with navigation

### 1.2 Data Layer
- [ ] Create NocoDB API client (`lib/nocodb.ts`)
- [ ] Define TypeScript types for all entities (`lib/types.ts`)
- [ ] Create React Query hooks:
  - [ ] `useApplications()`
  - [ ] `useAttendees()`
  - [ ] `useProducts()`
  - [ ] `useAttendeesWithProducts()` (joined data)
- [ ] Add error handling and loading states

### 1.3 Overview Dashboard
- [ ] Create overview page (`app/page.tsx`)
- [ ] Build metric cards component (applicants, accepted, paid, revenue)
- [ ] Add simple application funnel visualization
- [ ] Display recent activity feed

### 1.4 Attendees View
- [ ] Create attendees page (`app/attendees/page.tsx`)
- [ ] Implement data table with TanStack Table
- [ ] Add search functionality (name, email)
- [ ] Add filter dropdowns (status, has products)
- [ ] Add sorting (date, name)
- [ ] Create detail panel (click to expand)

### 1.5 Products View
- [ ] Create products page (`app/products/page.tsx`)
- [ ] Display products table with sales counts
- [ ] Show revenue per product
- [ ] Add category breakdown

---

## Phase 2: Enhanced Analytics

### 2.1 Charts & Visualizations
- [ ] Install Recharts
- [ ] Application funnel chart (bar/funnel)
- [ ] Revenue over time (line chart)
- [ ] Products breakdown (pie/donut chart)
- [ ] Sales velocity trend

### 2.2 Applications Pipeline
- [ ] Create applications page (`app/applications/page.tsx`)
- [ ] Kanban-style or table view of pipeline
- [ ] Highlight "stuck" applications (accepted but unpaid > 7 days)
- [ ] Status change history

### 2.3 Export & Reporting
- [ ] CSV export for attendees
- [ ] CSV export for products sold
- [ ] Print-friendly view

---

## Phase 3: Operations Features

### 3.1 Real-time Updates
- [ ] Implement polling (30-second refresh)
- [ ] Add manual refresh button
- [ ] Show "last updated" timestamp

### 3.2 Authentication
- [ ] Simple API key auth (via middleware)
- [ ] Or: integrate with existing EdgeOS auth

### 3.3 Multi-Event Support
- [ ] Fetch popups list
- [ ] Event selector dropdown
- [ ] Filter all data by selected popup

### 3.4 Actions
- [ ] Send reminder email (unpaid attendees)
- [ ] Update application status
- [ ] Add notes to attendees

---

## Dependencies

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "@tanstack/react-query": "^5.0.0",
    "@tanstack/react-table": "^8.0.0",
    "recharts": "^2.0.0",
    "zod": "^3.0.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tailwindcss": "^3.4.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0"
  }
}
```

---

## Definition of Done (MVP)

- [ ] Dashboard loads and displays current data
- [ ] Can see all applicants with their purchased products
- [ ] Can filter attendees by status and products
- [ ] Can search attendees by name/email
- [ ] Key metrics displayed on overview page
- [ ] Works on desktop (mobile nice-to-have for Phase 2)

---

## Open Questions

1. **Authentication:** Do we need it for MVP, or is this internal-only on a private network?
2. **Payments table ID:** Need to get this from NocoDB to show payment details
3. **Capacity data:** Where is lodging capacity stored? Need for occupancy tracking
4. **Refresh frequency:** Real-time vs. manual refresh for MVP?

