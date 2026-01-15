# Products Page Redesign

## Current State UI Critique

### Layout Issues
1. **Three cramped columns** - Fever Sales, EdgeOS Category, All Products compete for space
2. **Horizontal scroll required** - All Products table is cut off, important columns hidden
3. **No visual hierarchy** - All three sections appear equally important
4. **Wasted vertical space** - Left/middle columns end early while right column scrolls forever

### Information Architecture Problems
1. **Mixed popup cities** - 25 products from multiple cities shown as flat list (Iceland Eclipse + Egypt Luxor products mixed together)
2. **No context switching** - User can't focus on one city or one data source
3. **Redundant data** - "EdgeOS Revenue by Category" duplicates info that's in the product table
4. **Mismatched granularity** - Fever shows by "Plan", EdgeOS shows by "Category" - not comparable

### Missing Capabilities
1. **No city filter** - Products have `popup_city_id` but it's unused
2. **No source toggle** - Can't focus on just EdgeOS or just Fever
3. **No search/filter** - Can't find specific products in long list

---

## Proposed Redesign

### Primary Navigation: Source Tabs
```
┌─────────────────────────────────────────────────────────────┐
│  [EdgeOS]  [Fever]                                          │
└─────────────────────────────────────────────────────────────┘
```
- Tab-based toggle between data sources
- Each tab shows data relevant to that source only
- Shared summary metrics at top

### EdgeOS View (when EdgeOS tab selected)
```
┌─────────────────────────────────────────────────────────────┐
│ Products (EdgeOS)                                           │
│ ────────────────────────────────────────────────────────── │
│                                                             │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │ Products │ │ Sold     │ │ Revenue  │ │ Pending  │       │
│ │ 25       │ │ 16       │ │ $35,229  │ │ $0       │       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                             │
│ City: [All] [Iceland Eclipse] [Egypt]  ← pill buttons      │
│                                                             │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ Revenue by Category          │ All Products (filtered)│  │
│ │ ─────────────────────        │ ───────────────────────│  │
│ │ Month      $26,279 (10 sold) │ Product | Price | ...  │  │
│ │ Lodging    $8,950  (6 sold)  │ ...                    │  │
│ └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Fever View (when Fever tab selected)
```
┌─────────────────────────────────────────────────────────────┐
│ Ticket Sales (Fever)                      Synced: 2h ago 🔄 │
│ ────────────────────────────────────────────────────────── │
│                                                             │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│ │ Tickets  │ │ Orders   │ │ Revenue  │                     │
│ │ 3,209    │ │ 1,695    │ │ $2.36M   │                     │
│ └──────────┘ └──────────┘ └──────────┘                     │
│                                                             │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ Sales by Plan (full width table)                      │  │
│ │ ─────────────────────────────────────────────────────│  │
│ │ Plan Name                      | Tickets | Revenue   │  │
│ │ Iceland Eclipse 2026 Festival  | 2,278   | $2.11M    │  │
│ │ Accommodation for Iceland...   | 170     | $182k     │  │
│ │ ...                                                   │  │
│ └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Tabs not toggles** - Clear active state, familiar pattern
2. **City filter only for EdgeOS** - Fever has no city dimension
3. **Full-width tables** - No more cramped columns
4. **Category breakdown stays** - Compact summary alongside products table
5. **Fever breakdown expandable** - Like overview page pattern

---

## Implementation Plan

### Files to Modify
- `src/app/products/page.tsx` - Main redesign

### Step 1: Add Source Tab State
```typescript
const [activeSource, setActiveSource] = useState<'edgeos' | 'fever'>('edgeos');
```

### Step 2: Fetch Popup Cities for Filter
```typescript
const [cities, setCities] = useState<PopupCity[]>([]);
const [selectedCityId, setSelectedCityId] = useState<number | null>(null);

useEffect(() => {
  fetch('/api/popup-cities').then(r => r.json()).then(setCities);
}, []);
```

### Step 3: Create Tab UI Component
Simple tab bar with two options, styled to match dashboard aesthetic.

### Step 4: Refactor EdgeOS View
- Add city filter as horizontal pill buttons: `[All] [Iceland Eclipse] [Egypt]`
- "All" selected by default, shows combined data
- Filter products by `popup_city_id` when specific city selected
- Recalculate metrics based on filtered products
- Two-column layout: Category summary (left, narrow) + Products table (right, wide)

### Step 5: Refactor Fever View
- Full-width "Sales by Plan" table (currently cramped in 1/3 width)
- Keep expandable revenue breakdown from overview page
- Show sync status prominently

### Step 6: Update Metric Cards
- Show metrics for active source only (not combined)
- Update counts/revenue when city filter changes

---

## Verification

1. **Visual check**: Navigate to `/products`, verify tabs work
2. **EdgeOS tab**:
   - Verify city filter shows all cities from data
   - Select "Iceland Eclipse" - only Iceland products shown
   - Metrics update to reflect filtered data
3. **Fever tab**:
   - Full-width plan table displays properly
   - Sync status and refresh button work
4. **Responsive**: Check mobile layout still works
