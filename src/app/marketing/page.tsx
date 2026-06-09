import { Header } from '@/components/layout/Header';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Globe,
  Lock,
  MapPinned,
  ShoppingBag,
  Target,
  Users,
} from 'lucide-react';
import {
  type MarketingInsight,
  type Viability,
} from '@/data/marketing/iceland-eclipse-lookalike';
import { getIcelandEclipseCampaign } from '@/lib/marketing';

export const revalidate = 300;

const viabilityBadgeClasses: Record<Viability, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  yellow: 'border-amber-200 bg-amber-50 text-amber-700',
  'red/yellow': 'border-orange-200 bg-orange-50 text-orange-700',
  red: 'border-red-200 bg-red-50 text-red-700',
};

const severityBadgeClasses: Record<MarketingInsight['severity'], string> = {
  high: 'border-red-200 bg-red-50 text-red-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-zinc-200 bg-zinc-100 text-zinc-700',
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}-01T00:00:00Z`));
}

export default async function MarketingPage() {
  const { campaign, live, error } = await getIcelandEclipseCampaign();
  const usViability = campaign.geoViability.rows.find((row) => row.country === 'US');

  return (
    <div className="flex flex-col">
      <Header
        title="Marketing"
        description="Iceland Eclipse campaign intelligence and audience viability"
      />

      <div className="space-y-6 p-4 md:p-8">
        <Card className={live ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}>
          <CardContent className="flex items-start gap-3 p-4 md:p-6">
            <Lock className={cn('mt-0.5 h-5 w-5 shrink-0', live ? 'text-emerald-700' : 'text-amber-700')} />
            <div>
              <p className={cn('text-sm font-medium', live ? 'text-emerald-900' : 'text-amber-900')}>
                {live
                  ? `Live Fever data, computed ${formatDateTime(campaign.campaign.generatedAtUtc)}`
                  : `Live query unavailable, showing snapshot from ${formatDateTime(campaign.campaign.generatedAtUtc)}`}
              </p>
              <p className={cn('mt-1 text-sm', live ? 'text-emerald-800' : 'text-amber-800')}>
                {live
                  ? 'Audience uploads still require human approval.'
                  : `${error ?? 'Unknown error'} — fix the Supabase connection to restore live numbers.`}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
          <MetricCard
            title="All Buyers Seed"
            value={formatInteger(campaign.seedCounts.buyerSeedMarketingPrefTrue)}
            subtitle="Consented Fever buyers for Meta source audience"
            icon={<Users className="h-5 w-5" />}
          />
          <MetricCard
            title="Consent Pass Rate"
            value={formatPercent(campaign.seedCounts.buyerSeedPassRatePct)}
            subtitle={`${formatInteger(campaign.seedCounts.allDistinctBuyerEmails)} distinct buyer emails`}
            icon={<Target className="h-5 w-5" />}
          />
          <MetricCard
            title="Top Buyers = Creative Brief"
            value={formatPercent(campaign.topBuyerProfile.spendSharePct)}
            subtitle={`${formatCurrency(campaign.topBuyerProfile.spend)} from ${formatInteger(campaign.topBuyerProfile.buyers)} buyers`}
            icon={<ShoppingBag className="h-5 w-5" />}
          />
          <MetricCard
            title="US Viability"
            value={usViability ? usViability.viability.toUpperCase() : 'N/A'}
            subtitle={usViability ? `${formatInteger(usViability.consentedBuyerSourceCount)} consented source records` : 'No US row'}
            icon={<Globe className="h-5 w-5" />}
            className="bg-amber-50 border-amber-200"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Freshness and Coverage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Fallback Sync Time</p>
                  <p className="mt-2 text-base font-semibold text-zinc-900">
                    {formatDateTime(campaign.freshness.fallbackMaxSyncedAt)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Latest Order Time</p>
                  <p className="mt-2 text-base font-semibold text-zinc-900">
                    {formatDateTime(campaign.freshness.fallbackMaxOrderCreatedAt)}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Orders rows</p>
                  <p className="mt-1 text-2xl font-semibold">{formatInteger(campaign.freshness.ordersRows)}</p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Item rows</p>
                  <p className="mt-1 text-2xl font-semibold">{formatInteger(campaign.freshness.itemsRows)}</p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Flat rows</p>
                  <p className="mt-1 text-2xl font-semibold">{formatInteger(campaign.freshness.salesFlatRows)}</p>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">Caveat</p>
                <p className="mt-1">{campaign.freshness.caveat}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Seed Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Owner incremental reach</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatInteger(campaign.seedCounts.ownerSeedMarketingPrefTrueExcludingBuyers)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Exclusion audience</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatInteger(campaign.seedCounts.exclusionAllTicketholderEmails)}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-sm text-zinc-700">
                <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3">
                  <span>Owner overlap with buyer seed</span>
                  <span className="font-semibold">{formatInteger(campaign.seedCounts.ownerPrefOverlapBuyerSeed)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3">
                  <span>Paid included rows</span>
                  <span className="font-semibold">{formatInteger(campaign.population.paidIncludedFlatRows)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3">
                  <span>Distinct buyer emails</span>
                  <span className="font-semibold">{formatInteger(campaign.seedCounts.allDistinctBuyerEmails)}</span>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                {campaign.seedCounts.recommendation}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top Buyer Profile</CardTitle>
              <p className="text-sm text-zinc-500">
                {campaign.topBuyerProfile.definition} Use this for creative and offer strategy; the Meta source seed is all consented Fever buyers.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Top decile buyers</p>
                  <p className="mt-1 text-2xl font-semibold">{formatInteger(campaign.topBuyerProfile.buyers)}</p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Total spend</p>
                  <p className="mt-1 text-2xl font-semibold">{formatCurrency(campaign.topBuyerProfile.spend)}</p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Average spend</p>
                  <p className="mt-1 text-2xl font-semibold">{formatCurrency(campaign.topBuyerProfile.avgSpend)}</p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">Average tickets/items</p>
                  <p className="mt-1 text-2xl font-semibold">{campaign.topBuyerProfile.avgTickets.toFixed(2)}</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-sm font-medium text-zinc-900">Country mix</p>
                  <div className="mt-3 space-y-2">
                    {campaign.topBuyerProfile.countries.map((row) => (
                      <div key={row.country} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-zinc-600">{row.country}</span>
                        <span className="font-medium text-zinc-900">{formatInteger(row.buyers)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-sm font-medium text-zinc-900">Language mix</p>
                  <div className="mt-3 space-y-2">
                    {campaign.topBuyerProfile.languages.map((row) => (
                      <div key={row.language} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-zinc-600">{row.language}</span>
                        <span className="font-medium text-zinc-900">{formatInteger(row.buyers)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 p-4">
                  <p className="text-sm font-medium text-zinc-900">Channel mix</p>
                  <div className="mt-3 space-y-2">
                    {campaign.topBuyerProfile.channels.map((row) => (
                      <div key={row.channel} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-zinc-600">{row.channel}</span>
                        <span className="font-medium text-zinc-900">{formatInteger(row.buyers)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Product Mix</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {campaign.topBuyerProfile.plans.map((row) => (
                  <div key={row.plan} className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3">
                    <span className="text-sm text-zinc-700">{row.plan}</span>
                    <span className="text-sm font-semibold text-zinc-900">{formatInteger(row.buyers)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">First Purchase Months</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {campaign.topBuyerProfile.firstPurchaseMonths.map((row) => (
                  <div key={row.month} className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3">
                    <span className="text-sm text-zinc-700">{formatMonth(row.month)}</span>
                    <span className="text-sm font-semibold text-zinc-900">{formatInteger(row.buyers)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MapPinned className="h-5 w-5 text-zinc-500" />
              Geo Viability
            </CardTitle>
            <p className="text-sm text-zinc-500">
              Platform floor is {formatInteger(campaign.geoViability.platformFloorMatchedUsers)} matched users. Expected match rate range is {campaign.geoViability.expectedMatchRateLowPct}% to {campaign.geoViability.expectedMatchRateHighPct}%.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead>Source Count</TableHead>
                  <TableHead>Expected Match Range</TableHead>
                  <TableHead>Viability</TableHead>
                  <TableHead className="min-w-[280px]">Recommendation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaign.geoViability.rows.map((row) => {
                  const isUs = row.country === 'US';
                  return (
                    <TableRow key={row.country} className={cn(isUs && 'bg-amber-50/50')}>
                      <TableCell className="font-medium text-zinc-900">{row.country}</TableCell>
                      <TableCell>{formatInteger(row.consentedBuyerSourceCount)}</TableCell>
                      <TableCell>{formatInteger(row.expectedMatchLow)}-{formatInteger(row.expectedMatchHigh)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={viabilityBadgeClasses[row.viability]}>
                          {row.viability}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal text-zinc-700">{row.recommendation}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertTriangle className="h-5 w-5 text-zinc-500" />
                Chad&apos;s Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {campaign.insights.map((insight) => (
                <div key={insight.title} className="rounded-lg border border-zinc-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-900">{insight.title}</p>
                    <Badge variant="outline" className={severityBadgeClasses[insight.severity]}>
                      {insight.severity}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-700">{insight.body}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Privacy and Next Steps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                {campaign.campaign.privacy.note}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                CSV seeds remain outside the dashboard. Upload the all-consented-buyers seed and ticketholder exclusion only after human approval.
              </div>
              <div className="space-y-3">
                {campaign.recommendedActions.map((item) => (
                  <div key={`${item.owner}-${item.action}`} className="rounded-lg border border-zinc-200 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-700">
                        {item.owner}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-zinc-700">{item.action}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
