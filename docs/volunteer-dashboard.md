# Volunteer Dashboard - Context Dump

All known context for the volunteer dashboard feature, compiled from calls, Telegram threads, and task notes. Ready to be turned into a spec.

## What Is This

A new "Volunteers" page on the existing Iceland Eclipse portal dashboard that shows volunteer application data from EdgeOS. The dashboard currently handles ticket sales, email queue, and attendee data. This adds a volunteer-specific view.

## Data Source

**EdgeOS** is the source of truth for volunteer data. SimpleFi (Tule) built the volunteer application flow directly in EdgeOS as a "popup" (EdgeOS term for event). The application form replicates Jesse's Fillout form and includes a $5 application fee before submission.

- Volunteer app lives at volunteers.icelandeclipse.com
- Custom intake form stored as JSON blob column (same pattern as Ripple on the Nile)
- Volunteer option segmentation column added to EdgeOS DB (Long Build, Short Build, etc.)
- Data flows EdgeOS -> Jesse's Airtable (webhook, for approved+deposited volunteers only)

The volunteer EdgeOS instance may be a separate popup within the same EdgeOS setup, or a separate instance entirely. Mitch wanted separate ("volunteers.icelandeclipse.com"), Tule went with popup approach. Need to confirm schema.

## What To Show

From Jon/Mitch call (Feb 23):

- **Applicant counts**: profiles created vs applications completed vs $5 fee paid
- **Clickable list of volunteer applications**
- **Click into individual submission** to see full application details
- **Signup journey stage tracking** (where each applicant is in the funnel)

## What To Exclude

- All financial data (ticket revenue, payment plans, etc.)
- Email queue
- Ripple and Iceland city data
- People tab showing portal/festival attendees

## Volunteer Application Funnel

The signup journey has these stages:

1. Profile created (started application)
2. Application completed (filled out form)
3. $5 application fee paid (submitted)
4. Under review (AI/team screening)
5. Approved into specific volunteer type
6. Deposit paid ($600, single amount for all types)
7. Webhook fires to Jesse's Airtable

April 1 is the application submission deadline.

## Volunteer Types

- Long Build
- Short Build
- (Possibly others, names confirmed by Mitch via Jesse)
- Applicants may indicate availability for multiple types but get accepted into a specific one
- Single $600 deposit for all types
- $5 application fee for all types

## Permissions

### Navigation
- New "Volunteers" link in left nav
- Visible to all IMXP emails (existing users)

### Jesse's Access
- Whitelist Jesse's email (volunteers@imxp or his shifthappens address) to ONLY see the volunteer page
- Jesse should never see org financials, email queue, attendee data, etc.
- If Jesse somehow gets the main dashboard URL, financial data must still be hidden

### Broader Scoping
- This is the first time per-user permissions need real thought
- Start scoping a broader permissions model (who sees what)
- Current dashboard has no role-based access beyond "has an IMXP email"

## Architecture Notes

- New page on the existing portal dashboard (Next.js app, Supabase backend)
- NOT a separate application
- Filter data to volunteer-specific records only
- Dashboard currently reads from NocoDB (EdgeOS backend) for sales data and Supabase for email/tickets
- Volunteer data likely needs a new data pipeline from EdgeOS (NocoDB or direct RDS)

## Blocking Dependencies

- **Tule's backend work must be live first** so Jon can review the actual schema
- Volunteer app launched Feb 21 target. Status of the backend needs confirmation before dashboard work begins
- Airtable webhook (EdgeOS -> Shift) is post-April 1 scope, not needed for dashboard

## Key People

- **Mitch** (IMXP): Product owner, assigned this task to Jon
- **Jesse Gibson** (Shift Happens): Volunteer program lead. Needs dashboard access for reviewing applications pre-approval. Currently manages volunteers post-approval only via Airtable.
- **Tule** (SimpleFi): Built the EdgeOS volunteer application backend
- **Sarah Kraut** (IMXP): Proposed volunteer categories (construction, design/decor, hospitality, tech, gophers). May be involved in volunteer review process.

## Related Context

- ~1,200 volunteer applications in pipeline (being filtered to ~400 via AI, then Shift picks top 200-300)
- ~200 unapproved portal applicants may be pushed into volunteer/build flow
- Mitch wants AI-led selection eventually (whittle 1,200 -> 400, compare to Jesse's manual picks)
- Jon argues meaningful AI comparison requires post-festival participation data
- Jesse is protective of Shift Happens' Airtable system IP but accepted EdgeOS owning the application frontend
- Deposit features are deferred until approved volunteers exist

## Open Questions for Spec

1. What's the actual EdgeOS schema for volunteer data? (blocked on reviewing Tule's live backend)
2. How does the dashboard connect to volunteer data? (NocoDB API? Direct RDS? New Supabase sync?)
3. What are the exact volunteer types and their final names?
4. What does "signup journey stage tracking" look like in the data? (which fields indicate each stage)
5. Does Jesse need any write access (approve/reject) or just read?
6. How should permissions be modeled? (role column on existing auth? separate permissions table?)
7. Is the 10-day availability question included in the application form?
8. What email address will Jesse use to access the dashboard?
