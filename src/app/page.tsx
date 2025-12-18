import { getDashboardData } from '@/lib/nocodb';
import { Header } from '@/components/layout/Header';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, UserCheck, CreditCard, DollarSign, Package, Clock, Percent, AlertCircle } from 'lucide-react';

export const dynamic = 'force-dynamic'; // We handle caching ourselves

export default async function DashboardPage() {
  const { metrics, applications } = await getDashboardData();

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  return (
    <div className="flex flex-col">
      <Header 
        title="Dashboard Overview" 
        description="Real-time insights into your popup city operations"
      />

      <div className="p-8">
        {/* Key Metrics */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Applications"
            value={metrics.totalApplications}
            subtitle="All time"
            icon={<Users className="h-5 w-5" />}
          />
          <MetricCard
            title="Accepted"
            value={metrics.acceptedApplications}
            subtitle={`${Math.round((metrics.acceptedApplications / metrics.totalApplications) * 100) || 0}% acceptance rate`}
            icon={<UserCheck className="h-5 w-5" />}
          />
          <MetricCard
            title="Paid Attendees"
            value={metrics.paidAttendees}
            subtitle={metrics.pendingAttendees > 0 ? `+ ${metrics.pendingAttendees} pending` : 'From approved payments'}
            icon={<CreditCard className="h-5 w-5" />}
          />
          <MetricCard
            title="Approved Revenue"
            value={formatCurrency(metrics.revenue.approvedRevenue)}
            subtitle={metrics.revenue.pendingRevenue > 0 
              ? `+ ${formatCurrency(metrics.revenue.pendingRevenue)} pending`
              : 'From completed payments'
            }
            icon={<DollarSign className="h-5 w-5" />}
            className="bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200"
          />
        </div>

        {/* Revenue Breakdown */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Card className="bg-emerald-50 border-emerald-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-emerald-700 flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Approved Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-800">
                {formatCurrency(metrics.revenue.approvedRevenue)}
              </div>
              <p className="text-sm text-emerald-600">
                {metrics.revenue.approvedPaymentsCount} payment{metrics.revenue.approvedPaymentsCount !== 1 ? 's' : ''} completed
              </p>
            </CardContent>
          </Card>

          <Card className="bg-amber-50 border-amber-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-700 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Pending Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-800">
                {formatCurrency(metrics.revenue.pendingRevenue)}
              </div>
              <p className="text-sm text-amber-600">
                {metrics.revenue.pendingPaymentsCount} checkout{metrics.revenue.pendingPaymentsCount !== 1 ? 's' : ''} in progress
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500 flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Total Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(metrics.revenue.totalRevenue)}
              </div>
              <p className="text-sm text-zinc-500">
                Approved + Pending
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* Application Status Breakdown */}
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

          {/* Top Products by Actual Revenue */}
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
        </div>

        {/* Payments with Discounts */}
        {metrics.paymentsWithDiscounts.length > 0 && (
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

        {/* Info Banner */}
        <div className="mt-6 rounded-lg bg-blue-50 border border-blue-200 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Revenue Calculation Note</p>
            <p className="text-sm text-blue-700 mt-1">
              <strong>Approved Revenue</strong> = Completed payments only. 
              <strong> Pending Revenue</strong> = Checkouts in progress (not yet paid).
              Product assignments without payments are not counted toward revenue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
