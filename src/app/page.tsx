'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { SourceFilter } from '@/components/dashboard/SourceFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, UserCheck, CreditCard, DollarSign, Package, Clock, Percent, AlertCircle, RefreshCw, Ticket, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFilters } from '@/contexts/DashboardFilterContext';
import { getFeverMetrics, getFeverSyncState } from '@/lib/fever-client';
import type { DashboardData, FeverMetrics, FeverSyncState } from '@/lib/types';

export default function DashboardPage() {
  const { filters } = useFilters();
  const [edgeosData, setEdgeosData] = useState<DashboardData | null>(null);
  const [feverMetrics, setFeverMetrics] = useState<FeverMetrics | null>(null);
  const [feverSync, setFeverSync] = useState<FeverSyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feverExpanded, setFeverExpanded] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [edgeosRes, feverM, feverS] = await Promise.all([
          fetch('/api/dashboard').then(r => r.json()),
          filters.fever.enabled ? getFeverMetrics() : null,
          filters.fever.enabled ? getFeverSyncState() : null,
        ]);
        setEdgeosData(edgeosRes);
        setFeverMetrics(feverM);
        setFeverSync(feverS);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters.fever.enabled]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [edgeosRes, feverM, feverS] = await Promise.all([
        fetch('/api/dashboard').then(r => r.json()),
        filters.fever.enabled ? getFeverMetrics() : null,
        filters.fever.enabled ? getFeverSyncState() : null,
      ]);
      setEdgeosData(edgeosRes);
      setFeverMetrics(feverM);
      setFeverSync(feverS);
    } finally {
      setRefreshing(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  const metrics = edgeosData?.metrics;
  const applications = edgeosData?.applications || [];

  const combinedRevenue = (filters.edgeos.enabled ? (metrics?.revenue.approvedRevenue || 0) : 0) +
    (filters.fever.enabled ? (feverMetrics?.totalRevenue || 0) : 0);

  if (loading) {
    return (
      <div className="flex flex-col">
        <Header
          title="Dashboard Overview"
          description="Real-time insights into your popup city operations"
          actions={<SourceFilter />}
        />
        <div className="p-4 md:p-8">
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-zinc-100 animate-pulse rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Header
        title="Dashboard Overview"
        description="Real-time insights into your popup city operations"
        actions={<SourceFilter />}
      />

      <div className="p-4 md:p-8">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {filters.edgeos.enabled && (
            <>
              <MetricCard
                title="Total Applications"
                value={metrics?.totalApplications || 0}
                subtitle="All time"
                icon={<Users className="h-5 w-5" />}
              />
              <MetricCard
                title="Accepted"
                value={metrics?.acceptedApplications || 0}
                subtitle={`${Math.round(((metrics?.acceptedApplications || 0) / (metrics?.totalApplications || 1)) * 100)}% acceptance rate`}
                icon={<UserCheck className="h-5 w-5" />}
              />
              <MetricCard
                title="Paid Attendees"
                value={metrics?.paidAttendees || 0}
                subtitle={metrics?.pendingAttendees ? `+ ${metrics.pendingAttendees} pending` : 'From approved payments'}
                icon={<CreditCard className="h-5 w-5" />}
              />
            </>
          )}
          {filters.fever.enabled && (
            <MetricCard
              title="Fever Tickets"
              value={feverMetrics?.ticketCount || 0}
              subtitle={`${feverMetrics?.orderCount || 0} orders`}
              icon={<Ticket className="h-5 w-5" />}
            />
          )}
          <MetricCard
            title="Combined Revenue"
            value={formatCurrency(combinedRevenue)}
            subtitle={
              filters.edgeos.enabled && filters.fever.enabled
                ? 'EdgeOS + Fever'
                : filters.fever.enabled
                ? 'Fever only'
                : 'EdgeOS only'
            }
            icon={<DollarSign className="h-5 w-5" />}
            className="bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200"
          />
        </div>

        {/* Revenue Breakdown */}
        <div className="mt-4 md:mt-6 grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-3">
          {filters.edgeos.enabled && (
            <Card className="bg-emerald-50 border-emerald-200">
              <CardHeader className="pb-1 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium text-emerald-700 flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  EdgeOS Revenue
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl md:text-2xl font-bold text-emerald-800">
                  {formatCurrency(metrics?.revenue.approvedRevenue || 0)}
                </div>
                <p className="text-xs md:text-sm text-emerald-600">
                  {metrics?.revenue.approvedPaymentsCount || 0} payments completed
                </p>
              </CardContent>
            </Card>
          )}

          {filters.fever.enabled && (
            <Card className="bg-purple-50 border-purple-200">
              <CardHeader className="pb-1 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium text-purple-700 flex items-center gap-2">
                  <Ticket className="h-4 w-4" />
                  Fever Revenue
                  <button
                    onClick={() => setFeverExpanded(!feverExpanded)}
                    className="ml-auto p-0.5 hover:bg-purple-100 rounded"
                  >
                    <ChevronDown className={cn('h-4 w-4 transition-transform', feverExpanded && 'rotate-180')} />
                  </button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl md:text-2xl font-bold text-purple-800">
                  {formatCurrency(feverMetrics?.totalRevenue || 0)}
                </div>
                <p className="text-xs md:text-sm text-purple-600">
                  {feverMetrics?.ticketCount || 0} tickets sold
                </p>
                {feverExpanded && feverMetrics?.breakdown && (
                  <div className="mt-3 pt-3 border-t border-purple-200 space-y-1.5 text-xs">
                    <div className="flex justify-between text-purple-700">
                      <span>Tickets & Add-ons</span>
                      <span>{formatCurrency(feverMetrics.breakdown.ticketsAndAddonsRevenue)}</span>
                    </div>
                    <div className="flex justify-between text-purple-700">
                      <span>Surcharge</span>
                      <span>{formatCurrency(feverMetrics.breakdown.surcharge)}</span>
                    </div>
                    <div className="flex justify-between font-medium text-purple-800 pt-1 border-t border-purple-100">
                      <span>Gross Revenue</span>
                      <span>{formatCurrency(feverMetrics.breakdown.totalGrossRevenue)}</span>
                    </div>
                    <div className="flex justify-between text-purple-600">
                      <span>Discount</span>
                      <span>-{formatCurrency(feverMetrics.breakdown.discount)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-purple-900 pt-1 border-t border-purple-200">
                      <span>User Payment</span>
                      <span>{formatCurrency(feverMetrics.breakdown.userPayment)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {filters.edgeos.enabled && (
            <Card className="bg-amber-50 border-amber-200">
              <CardHeader className="pb-1 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium text-amber-700 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Pending Payments
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl md:text-2xl font-bold text-amber-800">
                  {formatCurrency(metrics?.revenue.pendingRevenue || 0)}
                </div>
                <p className="text-xs md:text-sm text-amber-600">
                  {metrics?.revenue.pendingPaymentsCount || 0} checkouts in progress
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Fever Sync Status */}
        {filters.fever.enabled && feverSync && (
          <div className="mt-4 flex items-center gap-3 text-sm text-zinc-500">
            <span>Fever last synced: {formatTimeAgo(feverSync.lastSyncAt)}</span>
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        )}

        <div className="mt-6 md:mt-8 grid gap-4 md:gap-6 lg:grid-cols-2">
          {/* Application Status Breakdown */}
          {filters.edgeos.enabled && metrics && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Application Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(metrics.applicationsByStatus).map(([status, count]) => {
                    const percentage = Math.round((count / metrics.totalApplications) * 100);
                    return (
                      <div key={status} className="flex items-center gap-4">
                        <div className="w-24">
                          <Badge variant={status === 'accepted' ? 'default' : 'secondary'} className="capitalize">
                            {status}
                          </Badge>
                        </div>
                        <div className="flex-1">
                          <div className="h-2 rounded-full bg-zinc-100">
                            <div
                              className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                        <div className="w-16 text-right text-sm font-medium">
                          {count} ({percentage}%)
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Fever Sales by Plan */}
          {filters.fever.enabled && feverMetrics && Object.keys(feverMetrics.revenueByPlan).length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Fever Sales by Plan</CardTitle>
                <Ticket className="h-5 w-5 text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(feverMetrics.revenueByPlan)
                    .sort(([, a], [, b]) => b.revenue - a.revenue)
                    .slice(0, 5)
                    .map(([planId, data]) => (
                      <div key={planId} className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{data.planName}</p>
                          <p className="text-xs text-zinc-500">{data.count} tickets</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-purple-600">{formatCurrency(data.revenue)}</p>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Products by Revenue */}
          {filters.edgeos.enabled && metrics && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Product Sales (Actual Revenue)</CardTitle>
                <Package className="h-5 w-5 text-zinc-400" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {metrics.productSales
                    .filter(ps => ps.actualRevenue > 0)
                    .sort((a, b) => b.actualRevenue - a.actualRevenue)
                    .slice(0, 5)
                    .map(({ product, quantity, actualRevenue, hasPendingPayments, hasApprovedPayments }) => (
                      <div key={product.id} className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{product.name}</p>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-zinc-500">{quantity} assigned</p>
                            {hasPendingPayments && !hasApprovedPayments && (
                              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                Pending
                              </Badge>
                            )}
                            {hasApprovedPayments && (
                              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                                Paid
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">{formatCurrency(actualRevenue)}</p>
                          <p className="text-xs text-zinc-500">at purchase price</p>
                        </div>
                      </div>
                    ))}
                  {metrics.productSales.filter(ps => ps.actualRevenue > 0).length === 0 && (
                    <p className="text-sm text-zinc-500 text-center py-4">No paid products yet</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Payments with Discounts */}
        {filters.edgeos.enabled && metrics && metrics.paymentsWithDiscounts.length > 0 && (
          <Card className="mt-6">
            <CardHeader className="flex flex-row items-center gap-2">
              <Percent className="h-5 w-5 text-purple-500" />
              <CardTitle className="text-lg">Payments with Discount Codes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {metrics.paymentsWithDiscounts.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium">
                        {payment.applications?.first_name || 'Unknown'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {payment.coupon_code && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            Code: {payment.coupon_code}
                          </Badge>
                        )}
                        {payment.discount_value > 0 && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            {payment.discount_value}% off
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(payment.amount)}</p>
                      <Badge
                        variant={payment.status === 'approved' ? 'default' : 'secondary'}
                        className={`text-xs capitalize ${
                          payment.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700'
                            : payment.status === 'pending'
                            ? 'bg-amber-100 text-amber-700'
                            : ''
                        }`}
                      >
                        {payment.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Applications */}
        {filters.edgeos.enabled && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg">Recent Applications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {applications
                  .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .slice(0, 5)
                  .map((app) => {
                    const hasPurchases = app.attendeesList.some(a => a.purchasedProducts.length > 0);
                    return (
                      <div key={app.id} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 flex items-center justify-center text-sm font-medium">
                            {app.first_name[0]}{app.last_name[0]}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{app.first_name} {app.last_name}</p>
                            <p className="text-xs text-zinc-500">{app.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={app.status === 'accepted' ? 'default' : 'secondary'} className="capitalize">
                            {app.status}
                          </Badge>
                          {hasPurchases && (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              Has Products
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Banner */}
        <div className="mt-6 rounded-lg bg-blue-50 border border-blue-200 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Revenue Calculation Note</p>
            <p className="text-sm text-blue-700 mt-1">
              <strong>EdgeOS Revenue</strong> = Completed payments from popup city applications.
              <strong> Fever Revenue</strong> = Ticket sales from Fever platform (synced every 5 min).
              Toggle data sources above to filter the dashboard.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
