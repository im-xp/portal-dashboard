import { supabase } from '@/lib/supabase';
import {
  icelandEclipseSnapshot,
  type GeoViabilityRow,
  type MarketingCampaignFixture,
  type MarketingInsight,
  type Viability,
} from '@/data/marketing/iceland-eclipse-lookalike';

const PAGE_SIZE = 1000;
const PLATFORM_FLOOR = 100;
const MATCH_RATE_LOW = 0.4;
const MATCH_RATE_HIGH = 0.6;

const COUNTRY_ALIASES: Record<string, string> = {
  'United States': 'US', 'United States of America': 'US', USA: 'US', US: 'US', 'U.S.': 'US',
  Iceland: 'IS', IS: 'IS',
  'United Kingdom': 'GB', UK: 'GB', 'Great Britain': 'GB', England: 'GB',
  Canada: 'CA', Germany: 'DE', Deutschland: 'DE', France: 'FR', Australia: 'AU',
  Netherlands: 'NL', Switzerland: 'CH', Spain: 'ES', Belgium: 'BE', Ireland: 'IE',
  Italy: 'IT', Norway: 'NO', Sweden: 'SE', Denmark: 'DK', Finland: 'FI', Poland: 'PL',
  Austria: 'AT', 'Czech Republic': 'CZ', Czechia: 'CZ', Portugal: 'PT', Mexico: 'MX',
  Brazil: 'BR', Israel: 'IL', Singapore: 'SG', 'New Zealand': 'NZ',
};

interface FlatRow {
  buyer_email: string | null;
  fever_order_id: string | null;
  fever_item_id: string | null;
  item_status: string | null;
  unitary_price: number | string | null;
  discount: number | string | null;
  purchase_country: string | null;
  purchase_city: string | null;
  buyer_language: string | null;
  purchase_channel: string | null;
  plan_name: string | null;
  order_created_at: string | null;
  buyer_marketing_pref: boolean | null;
}

interface OrderRow {
  buyer_email: string | null;
  buyer_marketing_pref: boolean | null;
  purchase_country: string | null;
  synced_at: string | null;
  order_created_at: string | null;
}

interface ItemRow {
  fever_order_id: string | null;
  fever_item_id: string | null;
  owner_email: string | null;
  owner_marketing_pref: boolean | null;
  status: string | null;
  plan_code_is_cancelled: boolean | null;
  cancellation_date: string | null;
  is_invite: boolean | null;
}

/**
 * Paginated fetch with a mandatory stable ordering. Range pagination without
 * ORDER BY returns overlapping pages from PostgREST (verified: 1,648 dupe rows
 * on fever_sales_flat), silently corrupting every downstream aggregate.
 */
async function fetchAll<T>(table: string, columns: string, orderBy: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = supabase.from(table).select(columns);
    for (const column of orderBy) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function iso2(country: string | null | undefined): string {
  const c = (country ?? '').trim();
  if (!c) return '';
  if (COUNTRY_ALIASES[c]) return COUNTRY_ALIASES[c];
  if (c.length === 2) return c.toUpperCase();
  return c.slice(0, 2).toUpperCase();
}

function normEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function boolish(v: unknown): boolean {
  return v === true || ['true', 't', '1', 'yes', 'y'].includes(String(v).toLowerCase());
}

function netAmount(row: FlatRow): number {
  const unit = Number(row.unitary_price) || 0;
  const discount = Number(row.discount) || 0;
  return Math.max(0, unit - discount);
}

function modal(counter: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [value, count] of counter) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function bump(counter: Map<string, number>, value: string | null | undefined): void {
  const v = (value ?? '').trim();
  if (!v) return;
  counter.set(v, (counter.get(v) ?? 0) + 1);
}

function topEntries(values: Array<string>, limit: number): Array<[string, number]> {
  const counter = new Map<string, number>();
  for (const v of values) if (v) counter.set(v, (counter.get(v) ?? 0) + 1);
  return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface BuyerAggregate {
  spend: number;
  tickets: number;
  orders: Set<string>;
  countries: Map<string, number>;
  cities: Map<string, number>;
  langs: Map<string, number>;
  channels: Map<string, number>;
  plans: Map<string, number>;
  firstPurchase: string | null;
}

function geoRecommendation(country: string, viability: Viability): string {
  if (country === 'unknown') return 'Do not use as a country lookalike seed.';
  switch (viability) {
    case 'green':
      return `Build ${country} 1% lookalike after upload approval.`;
    case 'yellow':
      return `Test ${country} lookalike after upload approval.`;
    case 'red/yellow':
      return 'Borderline source size; expect a sub-floor match.';
    default:
      return 'Use aggregate or interest targeting only.';
  }
}

async function computeLiveCampaign(): Promise<MarketingCampaignFixture> {
  const [flat, orders, items] = await Promise.all([
    fetchAll<FlatRow>(
      'fever_sales_flat',
      'buyer_email,fever_order_id,fever_item_id,item_status,unitary_price,discount,purchase_country,purchase_city,buyer_language,purchase_channel,plan_name,order_created_at,buyer_marketing_pref',
      ['fever_order_id', 'fever_item_id'],
    ),
    fetchAll<OrderRow>(
      'fever_orders',
      'buyer_email,buyer_marketing_pref,purchase_country,synced_at,order_created_at',
      ['fever_order_id'],
    ),
    fetchAll<ItemRow>(
      'fever_order_items',
      'fever_order_id,fever_item_id,owner_email,owner_marketing_pref,status,plan_code_is_cancelled,cancellation_date,is_invite',
      ['fever_order_id', 'fever_item_id'],
    ),
  ]);

  const itemFlags = new Map<string, ItemRow>();
  for (const item of items) {
    if (item.fever_order_id && item.fever_item_id) {
      itemFlags.set(`${item.fever_order_id}:${item.fever_item_id}`, item);
    }
  }

  let syncStateRows = 0;
  let syncStateLastSync: string | null = null;
  try {
    const syncState = await fetchAll<{ last_sync_at: string | null }>('fever_sync_state', 'last_sync_at', ['id']);
    syncStateRows = syncState.length;
    syncStateLastSync = syncState.map((r) => r.last_sync_at).filter(Boolean).sort().pop() ?? null;
  } catch {
    // RLS-blocked for some keys; the fever_orders fallback below covers it.
  }

  const maxSyncedAt = orders.map((o) => o.synced_at).filter(Boolean).sort().pop() ?? '';
  const maxOrderCreatedAt = orders.map((o) => o.order_created_at).filter(Boolean).sort().pop() ?? '';

  const excluded = { zeroNet: 0, badStatus: 0, invite: 0, missingEmail: 0 };
  let cancelledExcluded = 0;
  let includedRows = 0;
  const buyers = new Map<string, BuyerAggregate>();

  for (const row of flat) {
    const email = normEmail(row.buyer_email);
    if (!email) {
      excluded.missingEmail += 1;
      continue;
    }
    const flags = itemFlags.get(`${row.fever_order_id ?? ''}:${row.fever_item_id ?? ''}`);
    const status = (row.item_status ?? flags?.status ?? '').toLowerCase();
    if (['canceled', 'cancelled', 'refunded'].includes(status)) {
      excluded.badStatus += 1;
      continue;
    }
    if (boolish(flags?.plan_code_is_cancelled) || (flags?.cancellation_date ?? '').trim()) {
      cancelledExcluded += 1;
      continue;
    }
    if (boolish(flags?.is_invite)) {
      excluded.invite += 1;
      continue;
    }
    const net = netAmount(row);
    if (net <= 0) {
      excluded.zeroNet += 1;
      continue;
    }

    let agg = buyers.get(email);
    if (!agg) {
      agg = {
        spend: 0, tickets: 0, orders: new Set(),
        countries: new Map(), cities: new Map(), langs: new Map(),
        channels: new Map(), plans: new Map(), firstPurchase: null,
      };
      buyers.set(email, agg);
    }
    agg.spend += net;
    agg.tickets += 1;
    includedRows += 1;
    if (row.fever_order_id) agg.orders.add(row.fever_order_id);
    bump(agg.countries, row.purchase_country);
    bump(agg.cities, row.purchase_city);
    bump(agg.langs, row.buyer_language);
    bump(agg.channels, row.purchase_channel);
    bump(agg.plans, row.plan_name);
    if (row.order_created_at && (!agg.firstPurchase || row.order_created_at < agg.firstPurchase)) {
      agg.firstPurchase = row.order_created_at;
    }
  }

  const ranked = [...buyers.values()]
    .map((b) => ({
      spend: round2(b.spend),
      tickets: b.tickets,
      orders: b.orders.size,
      country: iso2(modal(b.countries)) || '',
      language: modal(b.langs),
      channel: modal(b.channels),
      topPlan: modal(b.plans),
      firstPurchase: b.firstPurchase,
    }))
    .sort((a, b) => b.spend - a.spend || b.tickets - a.tickets);

  const topN = ranked.length ? Math.ceil(ranked.length * 0.1) : 0;
  const top = ranked.slice(0, topN);

  const totalSpendAll = ranked.reduce((sum, r) => sum + r.spend, 0);
  const topSpend = top.reduce((sum, r) => sum + r.spend, 0);
  const topSpends = top.map((r) => r.spend);
  const topTickets = top.reduce((sum, r) => sum + r.tickets, 0);
  const topOrders = top.reduce((sum, r) => sum + r.orders, 0);

  const countryRows = topEntries(top.map((r) => r.country || 'unknown'), 12)
    .map(([country, count]) => ({ country, buyers: count }));
  const languageRows = topEntries(top.map((r) => r.language), 8)
    .map(([language, count]) => ({ language, buyers: count }));
  const channelRows = topEntries(top.map((r) => r.channel), 8)
    .map(([channel, count]) => ({ channel, buyers: count }));
  const planRows = topEntries(top.map((r) => r.topPlan), 10)
    .map(([plan, count]) => ({ plan, buyers: count }));
  const monthRows = topEntries(top.map((r) => (r.firstPurchase ?? '').slice(0, 7)), 12)
    .map(([month, count]) => ({ month, buyers: count }));

  const buyerAllEmails = new Set(orders.map((o) => normEmail(o.buyer_email)).filter(Boolean));
  const buyerSeed = new Map<string, string>();
  for (const order of orders) {
    const email = normEmail(order.buyer_email);
    if (!email || !boolish(order.buyer_marketing_pref) || buyerSeed.has(email)) continue;
    buyerSeed.set(email, iso2(order.purchase_country) || 'unknown');
  }

  const ownerAllEmails = new Set(items.map((i) => normEmail(i.owner_email)).filter(Boolean));
  const ownerPrefEmails = new Set(
    items.filter((i) => boolish(i.owner_marketing_pref)).map((i) => normEmail(i.owner_email)).filter(Boolean),
  );
  const ownerSeedExcludingBuyers = [...ownerPrefEmails].filter((e) => !buyerSeed.has(e));
  const ownerOverlap = ownerPrefEmails.size - ownerSeedExcludingBuyers.length;
  const exclusionEmails = new Set([...buyerAllEmails, ...ownerAllEmails]);

  const geoCounts = new Map<string, number>();
  for (const country of buyerSeed.values()) {
    geoCounts.set(country, (geoCounts.get(country) ?? 0) + 1);
  }
  const geoRows: GeoViabilityRow[] = [...geoCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([country, count]) => {
      const low = Math.floor(count * MATCH_RATE_LOW);
      const high = Math.floor(count * MATCH_RATE_HIGH);
      const viability: Viability =
        low >= PLATFORM_FLOOR ? 'green'
        : high >= PLATFORM_FLOOR ? 'yellow'
        : count >= PLATFORM_FLOOR ? 'red/yellow'
        : 'red';
      return {
        country,
        consentedBuyerSourceCount: count,
        expectedMatchLow: low,
        expectedMatchHigh: high,
        viability,
        recommendation: geoRecommendation(country, viability),
      };
    });

  const usRow = geoRows.find((r) => r.country === 'US');
  const subFloorCountries = geoRows
    .filter((r) => r.country !== 'unknown' && r.viability === 'red')
    .slice(0, 6)
    .map((r) => r.country);
  const avgTopTickets = top.length ? topTickets / top.length : 0;
  const avgTopSpend = top.length ? topSpend / top.length : 0;

  const insights: MarketingInsight[] = [
    usRow
      ? {
          title: usRow.viability === 'green' ? 'US lookalike is viable' : 'US is the only viable lookalike candidate',
          severity: 'high',
          body: `The US has ${usRow.consentedBuyerSourceCount} consented buyer source records (expected match ${usRow.expectedMatchLow}-${usRow.expectedMatchHigh} vs Meta's ${PLATFORM_FLOOR} matched-user floor).`,
        }
      : {
          title: 'No US seed rows found',
          severity: 'high',
          body: 'No consented US buyers in the current data; no country lookalike is viable.',
        },
    {
      title: 'Non-US lookalikes are too small',
      severity: 'medium',
      body: subFloorCountries.length
        ? `${subFloorCountries.join(', ')} are below the source size needed for a country-specific lookalike seed.`
        : 'All non-US countries currently clear or miss the floor together; check the geo table.',
    },
    {
      title: 'Top buyers are group purchasers',
      severity: 'high',
      body: `The top decile averages ${avgTopTickets.toFixed(2)} tickets/items and ${Math.round(avgTopSpend / 100) / 10}k spend, indicating group-basket behavior around festival plus logistics.`,
    },
    {
      title: ownerSeedExcludingBuyers.length === 0 ? 'Owner seed adds no incremental reach' : 'Owner seed adds incremental reach',
      severity: 'medium',
      body: ownerSeedExcludingBuyers.length === 0
        ? `All ${ownerPrefEmails.size} consented owner emails overlap the buyer seed, so the owner seed is empty after excluding buyers.`
        : `${ownerSeedExcludingBuyers.length} consented owner emails fall outside the buyer seed and add incremental reach.`,
    },
    {
      title: 'Use flight urgency in creative',
      severity: 'medium',
      body: 'For international buyers, the real near-term purchase decision is flights and trip logistics, not just the festival ticket.',
    },
  ];

  return {
    campaign: {
      slug: 'iceland-eclipse-lookalike',
      name: 'Iceland Eclipse Lookalike Audience',
      event: 'Iceland Eclipse Festival 2026',
      eventWindow: '2026-08-11 to 2026-08-15',
      generatedAtUtc: new Date().toISOString(),
      dataSources: ['fever_orders', 'fever_order_items', 'fever_sales_flat'],
      privacy: {
        gate1PartnerTerms: 'unlocked',
        piiInFixture: false,
        note: 'Aggregates computed live from Fever order data. Seed CSVs are generated and handled outside the dashboard.',
      },
    },
    freshness: {
      feverSyncStateRows: syncStateRows,
      fallbackMaxSyncedAt: syncStateLastSync ?? maxSyncedAt,
      fallbackMaxOrderCreatedAt: maxOrderCreatedAt,
      ordersRows: orders.length,
      itemsRows: items.length,
      salesFlatRows: flat.length,
      caveat: syncStateLastSync
        ? 'Sync time from fever_sync_state.'
        : 'fever_sync_state empty or unreadable; fallback timestamps from fever_orders are used.',
    },
    population: {
      paidIncludedFlatRows: includedRows,
      paidDistinctBuyers: ranked.length,
      excludedPaidRowReasons: {
        zeroNet: excluded.zeroNet,
        badStatus: excluded.badStatus + cancelledExcluded,
        invite: excluded.invite,
        missingEmail: excluded.missingEmail,
      },
    },
    seedCounts: {
      allDistinctBuyerEmails: buyerAllEmails.size,
      buyerSeedMarketingPrefTrue: buyerSeed.size,
      buyerSeedPassRatePct: buyerAllEmails.size ? round2((100 * buyerSeed.size) / buyerAllEmails.size) : 0,
      allDistinctOwnerEmails: ownerAllEmails.size,
      ownerSeedMarketingPrefTrueExcludingBuyers: ownerSeedExcludingBuyers.length,
      ownerPrefTrueDistinct: ownerPrefEmails.size,
      ownerPrefOverlapBuyerSeed: ownerOverlap,
      exclusionAllTicketholderEmails: exclusionEmails.size,
      recommendation: ownerSeedExcludingBuyers.length === 0
        ? 'Upload buyer seed and exclusion audience only after human execution approval. Owners seed adds no incremental consented reach.'
        : 'Upload buyer seed, owner seed, and exclusion audience only after human execution approval.',
    },
    topBuyerProfile: {
      definition: 'Top decile of paid buyers ranked by net item spend, excluding canceled/refunded/invite/zero-net rows.',
      buyers: top.length,
      spend: round2(topSpend),
      spendSharePct: totalSpendAll ? round2((100 * topSpend) / totalSpendAll) : 0,
      avgSpend: top.length ? round2(topSpend / top.length) : 0,
      medianSpend: round2(median(topSpends)),
      tickets: topTickets,
      avgTickets: round2(avgTopTickets),
      orders: topOrders,
      avgAge: null,
      medianAge: null,
      ageCoverage: 0,
      countries: countryRows,
      languages: languageRows,
      channels: channelRows,
      plans: planRows,
      firstPurchaseMonths: monthRows,
    },
    geoViability: {
      platformFloorMatchedUsers: PLATFORM_FLOOR,
      expectedMatchRateLowPct: MATCH_RATE_LOW * 100,
      expectedMatchRateHighPct: MATCH_RATE_HIGH * 100,
      rows: geoRows,
    },
    insights,
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
        owner: 'chad',
        action: 'Regenerate seed CSV exports after the next Fever sync so uploads match what this dashboard shows.',
      },
    ],
  };
}

export interface MarketingCampaignResult {
  campaign: MarketingCampaignFixture;
  live: boolean;
  error?: string;
}

export async function getIcelandEclipseCampaign(): Promise<MarketingCampaignResult> {
  try {
    if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL not configured');
    const campaign = await computeLiveCampaign();
    return { campaign, live: true };
  } catch (error) {
    return {
      campaign: icelandEclipseSnapshot,
      live: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
