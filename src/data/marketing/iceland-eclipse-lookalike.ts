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
  consentedBuyerSourceCount: number;
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
    buyerSeedMarketingPrefTrue: number;
    buyerSeedPassRatePct: number;
    allDistinctOwnerEmails: number;
    ownerSeedMarketingPrefTrueExcludingBuyers: number;
    ownerPrefTrueDistinct: number;
    ownerPrefOverlapBuyerSeed: number;
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
 * Point-in-time snapshot of the live computation (2026-06-09). Served only as
 * a fallback when the live Supabase query in `@/lib/marketing` fails.
 */
export const icelandEclipseSnapshot: MarketingCampaignFixture = {
  campaign: {
    slug: 'iceland-eclipse-lookalike',
    name: 'Iceland Eclipse Lookalike Audience',
    event: 'Iceland Eclipse Festival 2026',
    eventWindow: '2026-08-11 to 2026-08-15',
    generatedAtUtc: '2026-06-09T18:40:27Z',
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
    buyerSeedMarketingPrefTrue: 317,
    buyerSeedPassRatePct: 14.8,
    allDistinctOwnerEmails: 2150,
    ownerSeedMarketingPrefTrueExcludingBuyers: 0,
    ownerPrefTrueDistinct: 317,
    ownerPrefOverlapBuyerSeed: 317,
    exclusionAllTicketholderEmails: 2150,
    recommendation: 'Proceed with Agustin’s recommendation: upload all consented Fever buyers as the Meta source seed, plus the all-ticketholders exclusion. Owners seed adds no incremental consented reach.',
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
      { country: 'US', consentedBuyerSourceCount: 173, expectedMatchLow: 69, expectedMatchHigh: 103, viability: 'yellow', recommendation: 'Test US lookalike after upload approval.' },
      { country: 'unknown', consentedBuyerSourceCount: 41, expectedMatchLow: 16, expectedMatchHigh: 24, viability: 'red', recommendation: 'Do not use as a country lookalike seed.' },
      { country: 'AU', consentedBuyerSourceCount: 11, expectedMatchLow: 4, expectedMatchHigh: 6, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'GB', consentedBuyerSourceCount: 11, expectedMatchLow: 4, expectedMatchHigh: 6, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'CA', consentedBuyerSourceCount: 8, expectedMatchLow: 3, expectedMatchHigh: 4, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'DE', consentedBuyerSourceCount: 8, expectedMatchLow: 3, expectedMatchHigh: 4, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'NL', consentedBuyerSourceCount: 5, expectedMatchLow: 2, expectedMatchHigh: 3, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'IS', consentedBuyerSourceCount: 5, expectedMatchLow: 2, expectedMatchHigh: 3, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
    ],
  },
  insights: [
    {
      title: 'US is the only viable lookalike candidate',
      severity: 'high',
      body: "The US has 173 consented buyer source records; expected match 69-103 vs Meta's 100 matched-user floor. This is yellow, not guaranteed.",
    },
    {
      title: 'Non-US lookalikes are too small',
      severity: 'medium',
      body: 'AU, GB, CA, DE, NL, and IS are far below the source size needed for a country-specific lookalike seed.',
    },
    {
      title: 'Top buyers shape creative, not seed sizing',
      severity: 'high',
      body: 'The top decile averages 6.24 tickets/items and 10.6k spend, so use them to frame creative around group trip logistics while keeping the Meta source seed broad: all consented buyers.',
    },
    {
      title: 'Owner seed adds no incremental reach',
      severity: 'medium',
      body: 'All 317 consented owner emails overlap the buyer seed, so the owner seed is empty after excluding buyers.',
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
      action: 'Use all consented Fever buyers as the Meta source audience; build/test US 1% lookalike after human upload approval and attach all-ticketholders exclusion.',
    },
    {
      owner: 'marketing',
      action: 'Avoid non-US lookalike ad sets until seed size grows; use aggregate geo and interest targeting instead.',
    },
    {
      owner: 'jon',
      action: 'Keep PII CSVs out of dashboard and Supabase; dashboard remains aggregate-only.',
    },
    {
      owner: 'chad',
      action: 'Refresh this fixture after the next Fever sync or seed rebuild.',
    },
  ],
};
