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
    medianSpend: number;
    tickets: number;
    avgTickets: number;
    orders: number;
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
 * Point-in-time snapshot of the live computation (2026-06-05). Served only as
 * a fallback when the live Supabase query in `@/lib/marketing` fails.
 */
export const icelandEclipseSnapshot: MarketingCampaignFixture = {
  campaign: {
    slug: 'iceland-eclipse-lookalike',
    name: 'Iceland Eclipse Lookalike Audience',
    event: 'Iceland Eclipse Festival 2026',
    eventWindow: '2026-08-11 to 2026-08-15',
    generatedAtUtc: '2026-06-05T02:08:54Z',
    dataSources: ['fever_orders', 'fever_order_items', 'fever_sales_flat'],
    privacy: {
      gate1PartnerTerms: 'unlocked',
      piiInFixture: false,
      note: 'Snapshot fallback. Aggregates only; live values come from @/lib/marketing.',
    },
  },
  freshness: {
    feverSyncStateRows: 0,
    fallbackMaxSyncedAt: '2026-06-05T02:05:41.854Z',
    fallbackMaxOrderCreatedAt: '2026-06-05T01:11:46.715Z',
    ordersRows: 3260,
    itemsRows: 5691,
    salesFlatRows: 5691,
    caveat: 'fever_sync_state was readable but empty; fallback timestamps from fever_orders are used.',
  },
  population: {
    paidIncludedFlatRows: 4524,
    paidDistinctBuyers: 1151,
    excludedPaidRowReasons: {
      zeroNet: 830,
      badStatus: 253,
      invite: 82,
      missingEmail: 2,
    },
  },
  seedCounts: {
    allDistinctBuyerEmails: 2126,
    buyerSeedMarketingPrefTrue: 315,
    buyerSeedPassRatePct: 14.8,
    allDistinctOwnerEmails: 2129,
    ownerSeedMarketingPrefTrueExcludingBuyers: 0,
    ownerPrefTrueDistinct: 315,
    ownerPrefOverlapBuyerSeed: 315,
    exclusionAllTicketholderEmails: 2129,
    recommendation: 'Upload buyer seed and exclusion audience only after human execution approval. Owners seed adds no incremental consented reach.',
  },
  topBuyerProfile: {
    definition: 'Top decile of paid buyers ranked by net item spend, excluding canceled/refunded/invite/zero-net rows.',
    buyers: 116,
    spend: 1458678.43,
    spendSharePct: 41.1,
    avgSpend: 12574.81,
    medianSpend: 10386.14,
    tickets: 945,
    avgTickets: 8.15,
    orders: 318,
    avgAge: null,
    medianAge: null,
    ageCoverage: 0,
    countries: [
      { country: 'US', buyers: 79 },
      { country: 'unknown', buyers: 12 },
      { country: 'CA', buyers: 4 },
      { country: 'AU', buyers: 3 },
      { country: 'GB', buyers: 2 },
    ],
    languages: [
      { language: 'en', buyers: 111 },
      { language: 'it', buyers: 1 },
      { language: 'nl', buyers: 1 },
      { language: 'de', buyers: 1 },
      { language: 'pl', buyers: 1 },
      { language: 'fr', buyers: 1 },
    ],
    channels: [
      { channel: 'marketplace', buyers: 111 },
      { channel: 'affiliate_portal', buyers: 5 },
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
      { country: 'US', consentedBuyerSourceCount: 174, expectedMatchLow: 69, expectedMatchHigh: 104, viability: 'yellow', recommendation: 'Test US lookalike after upload approval.' },
      { country: 'unknown', consentedBuyerSourceCount: 37, expectedMatchLow: 14, expectedMatchHigh: 22, viability: 'red', recommendation: 'Do not use as a country lookalike seed.' },
      { country: 'AU', consentedBuyerSourceCount: 12, expectedMatchLow: 4, expectedMatchHigh: 7, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'GB', consentedBuyerSourceCount: 10, expectedMatchLow: 4, expectedMatchHigh: 6, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'CA', consentedBuyerSourceCount: 8, expectedMatchLow: 3, expectedMatchHigh: 4, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'DE', consentedBuyerSourceCount: 6, expectedMatchLow: 2, expectedMatchHigh: 3, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'NL', consentedBuyerSourceCount: 5, expectedMatchLow: 2, expectedMatchHigh: 3, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
      { country: 'IS', consentedBuyerSourceCount: 5, expectedMatchLow: 2, expectedMatchHigh: 3, viability: 'red', recommendation: 'Use aggregate or interest targeting only.' },
    ],
  },
  insights: [
    {
      title: 'US is the only viable lookalike candidate',
      severity: 'high',
      body: "The US has 174 consented buyer source records, which may clear Meta's 100 matched-user floor only if match rate lands near the high end.",
    },
    {
      title: 'Non-US lookalikes are too small',
      severity: 'medium',
      body: 'AU, GB, CA, DE, NL, and IS are far below the source size needed for a country-specific lookalike seed.',
    },
    {
      title: 'Top buyers are group purchasers',
      severity: 'high',
      body: 'The top decile averages 8.15 tickets/items and 12.6k spend, indicating group-basket behavior around festival plus logistics.',
    },
    {
      title: 'Owner seed adds no incremental reach',
      severity: 'medium',
      body: 'All 315 consented owner emails overlap the buyer seed, so the owner seed is empty after excluding buyers.',
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
      action: 'Build US 1% buyer lookalike after human upload approval; attach all ticketholders exclusion.',
    },
    {
      owner: 'marketing',
      action: 'Avoid non-US lookalike ad sets until seed size grows; use aggregate geo and interest targeting instead.',
    },
    {
      owner: 'jon',
      action: 'Keep PII CSVs out of dashboard and Supabase; dashboard demo should use this aggregate fixture only.',
    },
    {
      owner: 'chad',
      action: 'Refresh this fixture after the next Fever sync or seed rebuild.',
    },
  ],
};
