export type Viability = 'green' | 'yellow' | 'red/yellow' | 'red';

export interface MarketingBreakdownRow {
  buyers: number;
  country?: string;
  language?: string;
  channel?: string;
  plan?: string;
  month?: string;
}

export interface GeoViabilityRow {
  country: string;
  eligibleSourceCount: number;
  basis: string;
  expectedMatchLow: number;
  expectedMatchHigh: number;
  viability: Viability;
  recommendation: string;
}

export interface MarketingInsight {
  title: string;
  severity: 'high' | 'medium' | 'low';
  body: string;
}

export interface RecommendedAction {
  owner: string;
  action: string;
}

export interface MarketingCampaignFixture {
  campaign: {
    slug: string;
    name: string;
    event: string;
    eventWindow: string;
    generatedAtUtc: string;
    dataSources: string[];
    privacy: {
      gate1PartnerTerms: 'unlocked';
      piiInFixture: false;
      note: string;
    };
  };
  freshness: {
    feverSyncStateRows: number;
    fallbackMaxSyncedAt: string;
    fallbackMaxOrderCreatedAt: string;
    ordersRows: number;
    itemsRows: number;
    salesFlatRows: number;
    caveat: string;
  };
  population: {
    paidIncludedFlatRows: number;
    paidDistinctBuyers: number;
    excludedPaidRowReasons: {
      zeroNet: number;
      badStatus: number;
      invite: number;
      missingEmail: number;
    };
  };
  seedCounts: {
    allDistinctBuyerEmails: number;
    usBuyerSeedAllBuyers: number;
    usBuyerShareOfAllPct: number;
    usBuyersConsentedSubset: number;
    allDistinctOwnerEmails: number;
    ownerSeedConsentedExcludingBuyers: number;
    ownerPrefTrueDistinct: number;
    ownerPrefOverlapAllBuyers: number;
    exclusionAllTicketholderEmails: number;
    recommendation: string;
  };
  topBuyerProfile: {
    definition: string;
    buyers: number;
    spend: number;
    spendSharePct: number;
    avgSpend: number;
    medianSpend: number | null;
    tickets: number;
    avgTickets: number;
    orders: number | null;
    avgAge: number | null;
    medianAge: number | null;
    ageCoverage: number;
    countries: Array<MarketingBreakdownRow & { country: string }>;
    languages: Array<MarketingBreakdownRow & { language: string }>;
    channels: Array<MarketingBreakdownRow & { channel: string }>;
    plans: Array<MarketingBreakdownRow & { plan: string }>;
    firstPurchaseMonths: Array<MarketingBreakdownRow & { month: string }>;
  };
  geoViability: {
    platformFloorMatchedUsers: number;
    expectedMatchRateLowPct: number;
    expectedMatchRateHighPct: number;
    rows: GeoViabilityRow[];
  };
  insights: MarketingInsight[];
  recommendedActions: RecommendedAction[];
}

/**
 * Point-in-time snapshot of the live computation (2026-06-10). Served only as
 * a fallback when the live Supabase query in `@/lib/marketing` fails.
 * Seed policy: US buyers without consent filter (Jon, 2026-06-10); non-US
 * buyers remain consent-filtered for audience seeding.
 */
export const icelandEclipseSnapshot: MarketingCampaignFixture = {
  campaign: {
    slug: 'iceland-eclipse-lookalike',
    name: 'Iceland Eclipse Lookalike Audience',
    event: 'Iceland Eclipse Festival 2026',
    eventWindow: '2026-08-11 to 2026-08-15',
    generatedAtUtc: '2026-06-10T01:19:24Z',
    dataSources: ['fever_orders', 'fever_order_items', 'fever_sales_flat'],
    privacy: {
      gate1PartnerTerms: 'unlocked',
      piiInFixture: false,
      note: 'Snapshot fallback. Aggregates only; live values come from @/lib/marketing.',
    },
  },
  freshness: {
    feverSyncStateRows: 0,
    fallbackMaxSyncedAt: '2026-06-09T16:40:29.968+00:00',
    fallbackMaxOrderCreatedAt: '2026-06-09T15:07:07.848+00:00',
    ordersRows: 3328,
    itemsRows: 5798,
    salesFlatRows: 5798,
    caveat: 'fever_sync_state was readable but empty; fallback timestamps from fever_orders are used.',
  },
  population: {
    paidIncludedFlatRows: 4336,
    paidDistinctBuyers: 1289,
    excludedPaidRowReasons: {
      zeroNet: 1151,
      badStatus: 234,
      invite: 71,
      missingEmail: 6,
    },
  },
  seedCounts: {
    allDistinctBuyerEmails: 2147,
    usBuyerSeedAllBuyers: 1215,
    usBuyerShareOfAllPct: 56.6,
    usBuyersConsentedSubset: 188,
    allDistinctOwnerEmails: 2150,
    ownerSeedConsentedExcludingBuyers: 0,
    ownerPrefTrueDistinct: 317,
    ownerPrefOverlapAllBuyers: 317,
    exclusionAllTicketholderEmails: 2150,
    recommendation: 'Upload all US Fever buyers (no consent filter — seeding sends no comms) as the Meta source seed, plus the all-ticketholders exclusion. Non-US buyers stay consent-filtered and are below lookalike floors. Owners add no incremental reach.',
  },
  topBuyerProfile: {
    definition: 'Top decile of paid buyers ranked by net item spend, excluding canceled/refunded/invite/zero-net rows.',
    buyers: 129,
    spend: 1365634.44,
    spendSharePct: 38.5,
    avgSpend: 10586.31,
    medianSpend: null,
    tickets: 805,
    avgTickets: 6.24,
    orders: null,
    avgAge: null,
    medianAge: null,
    ageCoverage: 0,
    countries: [
      { country: 'US', buyers: 95 },
      { country: 'unknown', buyers: 10 },
      { country: 'CA', buyers: 5 },
      { country: 'AU', buyers: 3 },
      { country: 'GB', buyers: 2 },
    ],
    languages: [
      { language: 'en', buyers: 126 },
      { language: 'it', buyers: 1 },
      { language: 'nl', buyers: 1 },
      { language: 'de', buyers: 1 },
      { language: 'pl', buyers: 1 },
      { language: 'fr', buyers: 1 },
    ],
    channels: [
      { channel: 'marketplace', buyers: 125 },
      { channel: 'affiliate_portal', buyers: 4 },
    ],
    plans: [
      { plan: 'Iceland Eclipse Festival 2026 — August 11-15', buyers: 66 },
      { plan: 'Experiences for Iceland Eclipse 2026', buyers: 21 },
      { plan: 'Shuttle for Iceland Eclipse 2026', buyers: 15 },
      { plan: 'Accommodation for Iceland Eclipse 2026 Festival', buyers: 11 },
      { plan: 'Off-site Lodging', buyers: 3 },
    ],
    firstPurchaseMonths: [
      { month: '2025-08', buyers: 23 },
      { month: '2025-11', buyers: 21 },
      { month: '2025-12', buyers: 15 },
      { month: '2026-04', buyers: 14 },
      { month: '2025-10', buyers: 14 },
      { month: '2026-03', buyers: 10 },
      { month: '2026-01', buyers: 7 },
      { month: '2026-02', buyers: 6 },
      { month: '2026-05', buyers: 4 },
      { month: '2025-09', buyers: 2 },
    ],
  },
  geoViability: {
    platformFloorMatchedUsers: 100,
    expectedMatchRateLowPct: 40,
    expectedMatchRateHighPct: 60,
    rows: [
      { country: 'US', eligibleSourceCount: 1215, basis: 'all buyers (no consent filter)', expectedMatchLow: 486, expectedMatchHigh: 729, viability: 'green', recommendation: 'Build US 1% lookalike after upload approval.' },
      { country: 'unknown', eligibleSourceCount: 21, basis: 'consented only', expectedMatchLow: 8, expectedMatchHigh: 12, viability: 'red', recommendation: 'Do not use as a country lookalike seed.' },
      { country: 'AU', eligibleSourceCount: 13, basis: 'consented only', expectedMatchLow: 5, expectedMatchHigh: 7, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'CA', eligibleSourceCount: 10, basis: 'consented only', expectedMatchLow: 4, expectedMatchHigh: 6, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'GB', eligibleSourceCount: 9, basis: 'consented only', expectedMatchLow: 3, expectedMatchHigh: 5, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'IS', eligibleSourceCount: 6, basis: 'consented only', expectedMatchLow: 2, expectedMatchHigh: 3, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'DE', eligibleSourceCount: 5, basis: 'consented only', expectedMatchLow: 2, expectedMatchHigh: 3, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'NL', eligibleSourceCount: 5, basis: 'consented only', expectedMatchLow: 2, expectedMatchHigh: 3, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
    ],
  },
  insights: [
    {
      title: 'US lookalike is solidly viable',
      severity: 'high',
      body: "The US seed is 1,215 buyers (no consent filter for seeding); expected match 486-729 vs Meta's 100 matched-user floor. Green.",
    },
    {
      title: 'Non-US lookalikes are too small',
      severity: 'medium',
      body: 'Non-US buyers remain consent-filtered (EU custom-audience rules), and AU, CA, GB, IS, DE, and NL are far below the source size needed for a country-specific lookalike seed.',
    },
    {
      title: 'Top buyers shape creative, not seed sizing',
      severity: 'high',
      body: 'The top decile averages 6.24 tickets/items and 10.6k spend, so use them to frame creative around group trip logistics while keeping the Meta source seed broad: all US buyers.',
    },
    {
      title: 'Owner seed adds no incremental reach',
      severity: 'medium',
      body: 'All 317 consented owner emails are already among the distinct buyer emails, so the owner seed is empty after excluding buyers.',
    },
    {
      title: 'Use flight urgency in creative',
      severity: 'medium',
      body: 'For international buyers, the real near-term purchase decision is flights and trip logistics, not just the festival ticket.',
    },
  ],
  recommendedActions: [
    {
      owner: 'marketing',
      action: 'Use all US Fever buyers (no consent filter) as the Meta source audience; build US 1% lookalike after human upload approval and attach all-ticketholders exclusion.',
    },
    {
      owner: 'marketing',
      action: 'Keep non-US buyers consent-filtered for seeding; their lookalike pools are below floor anyway — use aggregate geo and interest targeting instead.',
    },
    {
      owner: 'jon',
      action: "Confirm with Mitch that Fever's data clearance covers uploading buyer emails to Meta before approving the upload.",
    },
    {
      owner: 'chad',
      action: 'Keep regenerating the US all-buyers seed CSV after Fever syncs so uploads match what this dashboard shows.',
    },
  ],
};
