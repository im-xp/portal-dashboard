# Mobile Optimization Plan

## Status: Complete

### Completed
- [x] MobileNav - Added Email Queue as 5th item
- [x] Applications page - responsive table (3 columns on mobile)
- [x] Products page - responsive table (4 columns on mobile)
- [x] People page - responsive table (4 columns on mobile)

### Completed
- [x] Email Queue page - ticket card layout (line 409, 531)
- [x] Email Queue - compose form buttons (line 222)
- [x] Email Queue - thread messages height (line 139)
- [x] Browser test Email Queue workflow at 375px
- [x] Browser test Overview page at 375px

---

## Implementation Analysis (from browser testing at 375px viewport)

### MobileNav ✅
**File**: `src/components/layout/MobileNav.tsx`
- Added `Mail` icon import
- Added Email Queue: `{ name: 'Email', href: '/email-queue', icon: Mail }`
- 5 items now in bottom nav and hamburger menu

### Applications Page ✅
**File**: `src/app/applications/page.tsx`

**Problem**: 6 columns with `min-w-[700px]` forced horizontal scroll

**Solution applied**:
- Removed `min-w-[700px]` constraint
- Mobile (3 columns): Applicant, Status, Attendees
- Hidden on mobile: Email, Products, Submitted
- Applicant cell: `max-w-[140px]` with truncate, hidden avatar/telegram
- Status badge: `text-[10px] md:text-xs`
- Attendees icon: `h-3 w-3 md:h-4 md:w-4`

**Result**: No horizontal scroll at 375px ✅

### Products Page ✅
**File**: `src/app/products/page.tsx`

**Problem**: 6 columns too wide even with smaller text

**Solution applied**:
- Mobile (4 columns): Product, Category, Inv, Rev
- Hidden on mobile: Price, Sold
- Product cell: `max-w-[120px]` with truncate, hidden description
- Header text: abbreviated "Inv", "Rev"
- Category badge: `text-[10px] md:text-xs`
- All cells: `text-xs md:text-sm`
- Inventory: hidden progress bar on mobile, just shows X/Y

**Result**: No horizontal scroll at 375px ✅

### People Page ✅
**File**: `src/app/people/PeopleTable.tsx`

**Problem**: 6 columns with `min-w-[600px]` forced horizontal scroll

**Solution applied**:
- Removed `min-w-[600px]` constraint
- Mobile (4 columns): Name, Journey, Pass, Lodging
- Hidden on mobile: Email, Check-in Code
- Name cell: `max-w-[100px]` with truncate
- Journey badge: icon only on mobile (hidden label text)
- Icons: `h-4 w-4 md:h-5 md:w-5`

**Result**: Minimal/no horizontal scroll at 375px ✅

### Email Queue Page (Needs Work)
**Files**:
- `src/app/email-queue/page.tsx`
- `src/components/email/ComposeResponse.tsx`
- `src/components/email/ThreadMessages.tsx`
- `src/components/email/TicketNotes.tsx`

---

## Email Queue Mobile UX Deep Dive

### User Workflow on Mobile:
1. Browse/filter tickets → 2. View ticket details → 3. Claim ticket → 4. Read thread → 5. Compose reply → 6. Send

### Current Issues by Step:

#### Step 1: Browse/Filter
**Current:** 6 filter buttons with `flex-wrap gap-2`
- Unclaimed, Awaiting Team Reply, Awaiting Customer Reply, Claimed, Resolved, All
- These wrap onto 2-3 lines, functional but cramped

**Problem:** "Awaiting Customer Reply" is very long text

**Fix:** Abbreviate on mobile or use horizontal scroll

#### Step 2: View Ticket Card
**Current layout (line 409):**
```jsx
<div className="flex items-center justify-between">
  <div className="flex-1 min-w-0">  // Email + badges + summary
  <div className="flex items-center gap-2 ml-4">  // Action buttons
```

**Problem:** Action buttons (up to 4: Claim, Reply, Mark Replied, Gmail) compete with content on same row. On narrow screens, buttons may overflow or get squished.

**Fix:** Stack action buttons below content on mobile:
```jsx
<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
```

#### Step 3: Claim Ticket
**Current:** "Claim" button in action row
**Problem:** Button may be hard to reach if squished
**Fix:** Will be resolved by stacking action buttons

#### Step 4: Read Thread (ThreadMessages.tsx)
**Current:**
- `max-h-96` (384px) container
- Message bubbles `max-w-[85%]`
- `overflow-y-auto pr-2`

**Problem:** 384px is almost entire mobile viewport height, leaves little room for compose form
**Fix:** Reduce max-height on mobile: `max-h-64 md:max-h-96`

#### Step 5: Compose Reply (ComposeResponse.tsx)
**Current:**
- To field (display only)
- CC field with chips + Add button
- Subject input
- Textarea (6 rows)
- Two buttons side-by-side: "Send Reply" | "Send & Resolve"

**Problems:**
1. Textarea 6 rows = ~150px, large on mobile
2. Two buttons side-by-side get cramped
3. Form padding `p-4` is fine

**Fixes:**
1. Textarea: `rows={4}` on mobile, `md:rows={6}` on desktop (need JS or just use 4)
2. Stack buttons vertically on mobile:
```jsx
<div className="flex flex-col md:flex-row items-stretch md:items-center justify-end gap-2">
```

#### Step 6: Send
**Current:** Two options - "Send Reply" or "Send & Resolve"
**Problem:** Buttons may be too close together for touch
**Fix:** Stack vertically, full-width on mobile

### Additional Mobile Issues:

#### Help Text Box (line 278-287)
Long paragraph in blue box takes up significant mobile real estate
**Fix:** Make collapsible or hide on mobile (show via help icon)

#### Stats Cards (line 309-360)
`grid-cols-2 md:grid-cols-4` - Already mobile-optimized ✅

#### Notes/Activity Grid (line 503-506)
`grid-cols-1 md:grid-cols-2` - Already stacks on mobile ✅

---

## Email Queue Implementation Plan

### Priority 1: Ticket Card Layout
**File:** `src/app/email-queue/page.tsx`

**Line 409:** Change outer wrapper from inline to stacked:
```jsx
// Before: <div className="flex items-center justify-between">
// After:
<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
```

**Line 531:** Action buttons - allow wrapping and remove left margin on mobile:
```jsx
// Before: <div className="flex items-center gap-2 ml-4">
// After:
<div className="flex flex-wrap items-center gap-2 md:ml-4">
```

### Priority 2: Compose Form Buttons
**File:** `src/components/email/ComposeResponse.tsx`

**Line 222:** Stack buttons vertically on mobile:
```jsx
// Before: <div className="flex items-center justify-end gap-2">
// After:
<div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
```

**Lines 223-240 & 241-258:** Add full-width on mobile to both buttons:
```jsx
// Before: <Button ... className="gap-2">
// After:
<Button ... className="w-full sm:w-auto gap-2">
```

### Priority 3: Thread Messages Height
**File:** `src/components/email/ThreadMessages.tsx`

**Line 139:** Reduce max-height on mobile:
```jsx
// Before: <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
// After:
<div className="space-y-3 max-h-64 md:max-h-96 overflow-y-auto pr-2">
```

### Priority 4: Filter Buttons (Optional - skip for now)
Filter buttons already use `flex-wrap gap-2` so they wrap naturally. Can abbreviate labels later if needed.

### Priority 5: Help Text (Optional - skip for now)
The help text box is helpful for understanding workflow. Leave as-is for now.

### Overview Page
**File**: `src/app/page.tsx`

Uses card grids (`grid-cols-2 md:grid-cols-4`) and lists, not tables. Should be mobile-friendly but verify with browser testing.

---

## Responsive Pattern Summary

### Column Visibility Strategy
```
Desktop (md+): All columns visible
Mobile (<md): Essential columns only, use `hidden md:table-cell`
```

### Text/Icon Sizing Pattern
```
Text: text-xs md:text-sm (or text-sm md:text-base for primary)
Icons: h-3 w-3 md:h-4 md:w-4 (or h-4 w-4 md:h-5 md:w-5)
Badges: text-[10px] md:text-xs
```

### Truncation Pattern
```
TableCell className="max-w-[100px] md:max-w-none"
<p className="truncate md:whitespace-normal">...</p>
```

### Hide Secondary Info Pattern
```
{item.secondaryInfo && (
  <p className="hidden md:block text-xs text-zinc-500">...</p>
)}
```

---

## Files Modified

1. `src/components/layout/MobileNav.tsx` - Email nav added ✅
2. `src/app/applications/page.tsx` - Responsive columns ✅
3. `src/app/products/page.tsx` - Responsive columns ✅
4. `src/app/people/PeopleTable.tsx` - Responsive columns ✅

---

## Verification Checklist

Test at 375px viewport (iPhone 12/13):

- [x] MobileNav: Email in bottom bar and hamburger menu
- [x] Applications: No horizontal scroll, 3 columns visible
- [x] Products: No horizontal scroll, 4 columns visible
- [x] People: Minimal scroll, 4 columns visible
- [ ] Email Queue: Full workflow test
  - [ ] Filter buttons readable and tappable
  - [ ] Ticket cards - all content visible without overflow
  - [ ] Action buttons accessible (Claim, Reply, etc.)
  - [ ] Expand ticket - thread readable
  - [ ] Compose reply - form usable, buttons tappable
  - [ ] Send reply - completes successfully
- [ ] Overview: Verify grid/cards work on mobile
- [ ] Test at 320px (smallest common phone)
- [ ] Test at 768px (tablet/md breakpoint transition)
