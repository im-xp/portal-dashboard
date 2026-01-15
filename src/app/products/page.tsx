'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { SourceFilter } from '@/components/dashboard/SourceFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Package, DollarSign, TrendingUp, Ticket, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFilters } from '@/contexts/DashboardFilterContext';
import { getFeverMetrics, getFeverSyncState } from '@/lib/fever-client';
import type { DashboardData, FeverMetrics, FeverSyncState, Product, PaymentWithProducts } from '@/lib/types';

export default function ProductsPage() {
  const { filters } = useFilters();
  const [edgeosData, setEdgeosData] = useState<DashboardData | null>(null);
  const [feverMetrics, setFeverMetrics] = useState<FeverMetrics | null>(null);
  const [feverSync, setFeverSync] = useState<FeverSyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [edgeosRes, feverM, feverS] = await Promise.all([
          filters.edgeos.enabled ? fetch('/api/dashboard').then(r => r.json()) : null,
          filters.fever.enabled ? getFeverMetrics() : null,
          filters.fever.enabled ? getFeverSyncState() : null,
        ]);
        setEdgeosData(edgeosRes);
        setFeverMetrics(feverM);
        setFeverSync(feverS);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters.edgeos.enabled, filters.fever.enabled]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [edgeosRes, feverM, feverS] = await Promise.all([
        filters.edgeos.enabled ? fetch('/api/dashboard').then(r => r.json()) : null,
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
  const products = edgeosData?.products || [];
  const payments = edgeosData?.payments || [];

  const combinedRevenue = (filters.edgeos.enabled ? (metrics?.revenue.approvedRevenue || 0) : 0) +
    (filters.fever.enabled ? (feverMetrics?.totalRevenue || 0) : 0);

  const productPaymentData = payments
    .filter((p: PaymentWithProducts) => p.status === 'approved')
    .flatMap((p: PaymentWithProducts) => {
      const listPriceTotal = p.paymentProducts.reduce(
        (sum: number, pp) => sum + pp.product_price * pp.quantity, 0
      );
      const discountMultiplier = listPriceTotal > 0 ? p.amount / listPriceTotal : 1;
      return p.paymentProducts.map(pp => ({ ...pp, discountMultiplier }));
    })
    .reduce((acc, pp) => {
      if (!acc[pp.product_id]) {
        acc[pp.product_id] = {
          soldQuantity: 0,
          inCheckoutQuantity: 0,
          approvedRevenue: 0,
          pendingRevenue: 0,
          productName: pp.product_name,
          productCategory: pp.product_category,
        };
      }
      const amount = pp.product_price * pp.quantity * pp.discountMultiplier;
      acc[pp.product_id].soldQuantity += pp.quantity;
      acc[pp.product_id].approvedRevenue += amount;
      return acc;
    }, {} as Record<number, {
      soldQuantity: number;
      inCheckoutQuantity: number;
      approvedRevenue: number;
      pendingRevenue: number;
      productName: string;
      productCategory: string;
    }>);

  const productsWithSales = products.map((product: Product) => ({
    ...product,
    sales: productPaymentData[product.id] || {
      soldQuantity: 0,
      inCheckoutQuantity: 0,
      approvedRevenue: 0,
      pendingRevenue: 0,
    },
  }));

  const sortedProducts = productsWithSales.sort((a, b) => {
    return (b.sales.approvedRevenue || 0) - (a.sales.approvedRevenue || 0);
  });

  const categorySales = payments
    .filter((p: PaymentWithProducts) => p.status === 'approved')
    .flatMap((p: PaymentWithProducts) => {
      const listPriceTotal = p.paymentProducts.reduce(
        (sum: number, pp) => sum + pp.product_price * pp.quantity, 0
      );
      const discountMultiplier = listPriceTotal > 0 ? p.amount / listPriceTotal : 1;
      return p.paymentProducts.map(pp => ({ ...pp, discountMultiplier }));
    })
    .reduce((acc, pp) => {
      const category = pp.product_category || 'other';
      if (!acc[category]) {
        acc[category] = {
          soldQuantity: 0,
          inCartQuantity: 0,
          approvedRevenue: 0,
          pendingRevenue: 0
        };
      }
      const amount = pp.product_price * pp.quantity * pp.discountMultiplier;
      acc[category].soldQuantity += pp.quantity;
      acc[category].approvedRevenue += amount;
      return acc;
    }, {} as Record<string, {
      soldQuantity: number;
      inCartQuantity: number;
      approvedRevenue: number;
      pendingRevenue: number;
    }>);

  if (loading) {
    return (
      <div className="flex flex-col">
        <Header
          title="Products"
          description="Sales breakdown by product and category"
          actions={<SourceFilter />}
        />
        <div className="p-4 md:p-8">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6">
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
        title="Products"
        description="Sales breakdown by product and category"
        actions={<SourceFilter />}
      />

      <div className="p-4 md:p-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6 md:mb-8">
          {filters.edgeos.enabled && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Products</CardTitle>
                  <Package className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl md:text-3xl font-bold">{products.length}</div>
                  <p className="text-xs md:text-sm text-zinc-500 mt-1 hidden md:block">available for purchase</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Assigned</CardTitle>
                  <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl md:text-3xl font-bold">
                    {metrics?.productSales.reduce((sum, ps) => sum + ps.quantity, 0) || 0}
                  </div>
                  <p className="text-xs md:text-sm text-zinc-500 mt-1 hidden md:block">includes test/manual</p>
                </CardContent>
              </Card>
            </>
          )}

          {filters.fever.enabled && (
            <Card className="bg-purple-50 border-purple-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium text-purple-700">Fever Tickets</CardTitle>
                <Ticket className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl md:text-3xl font-bold text-purple-900">
                  {feverMetrics?.ticketCount || 0}
                </div>
                <p className="text-xs md:text-sm text-purple-700 mt-1 hidden md:block">
                  {feverMetrics?.orderCount || 0} orders
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="bg-emerald-50 border-emerald-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-emerald-700">Combined Revenue</CardTitle>
              <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-emerald-600" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-xl md:text-3xl font-bold text-emerald-900">
                {formatCurrency(combinedRevenue)}
              </div>
              <p className="text-xs md:text-sm text-emerald-700 mt-1 hidden md:block">
                {filters.edgeos.enabled && filters.fever.enabled
                  ? 'EdgeOS + Fever'
                  : filters.fever.enabled
                  ? 'Fever only'
                  : 'EdgeOS only'}
              </p>
            </CardContent>
          </Card>

          {filters.edgeos.enabled && (
            <Card className="bg-amber-50 border-amber-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                <CardTitle className="text-xs md:text-sm font-medium text-amber-700">Pending</CardTitle>
                <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-amber-600" />
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl md:text-3xl font-bold text-amber-900">
                  {formatCurrency(metrics?.revenue.pendingRevenue || 0)}
                </div>
                <p className="text-xs md:text-sm text-amber-700 mt-1 hidden md:block">
                  {metrics?.revenue.pendingPaymentsCount || 0} in checkout
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Fever Sync Status */}
        {filters.fever.enabled && feverSync && (
          <div className="mb-4 flex items-center gap-3 text-sm text-zinc-500">
            <span>Fever last synced: {formatTimeAgo(feverSync.lastSyncAt)}</span>
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        )}

        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          {/* Fever Sales by Plan */}
          {filters.fever.enabled && feverMetrics && Object.keys(feverMetrics.revenueByPlan).length > 0 && (
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3 md:pb-6 flex flex-row items-center justify-between">
                <CardTitle className="text-base md:text-lg">Fever Sales by Plan</CardTitle>
                <Ticket className="h-5 w-5 text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(feverMetrics.revenueByPlan)
                    .sort(([, a], [, b]) => b.revenue - a.revenue)
                    .map(([planId, data]) => (
                      <div key={planId} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate max-w-[200px]">{data.planName}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-purple-600">{data.count} tickets</span>
                          <span className="font-semibold text-purple-600">{formatCurrency(data.revenue)}</span>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* EdgeOS Category Breakdown */}
          {filters.edgeos.enabled && Object.keys(categorySales).length > 0 && (
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3 md:pb-6">
                <CardTitle className="text-base md:text-lg">EdgeOS Revenue by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(categorySales)
                    .sort(([, a], [, b]) => b.approvedRevenue - a.approvedRevenue)
                    .map(([category, data]) => (
                      <div key={category} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between mb-2">
                          <Badge variant="outline" className="capitalize">{category}</Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-emerald-600">{data.soldQuantity} sold</span>
                          <span className="font-medium text-emerald-600">
                            {data.approvedRevenue > 0 ? formatCurrency(data.approvedRevenue) : '—'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm mt-1">
                          <span className="text-amber-600">{data.inCartQuantity} in carts</span>
                          <span className="font-medium text-amber-600">
                            {data.pendingRevenue > 0 ? formatCurrency(data.pendingRevenue) : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Products Table */}
          {filters.edgeos.enabled && (
            <Card className={filters.fever.enabled && feverMetrics && Object.keys(feverMetrics.revenueByPlan).length > 0 ? 'lg:col-span-1' : 'lg:col-span-2'}>
              <CardHeader className="pb-3 md:pb-6">
                <CardTitle className="text-base md:text-lg">All Products</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-center">Inventory</TableHead>
                      <TableHead className="text-right text-emerald-700">Sold</TableHead>
                      <TableHead className="text-right text-amber-700">In Carts</TableHead>
                      <TableHead className="text-right text-emerald-700">Approved $</TableHead>
                      <TableHead className="text-right text-amber-700">Pending $</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedProducts.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{product.name}</p>
                            {product.description && (
                              <p className="text-xs text-zinc-500 truncate max-w-xs">
                                {product.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{formatCurrency(product.price)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {product.category || 'other'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {product.max_inventory !== null ? (
                            <div className="min-w-[80px]">
                              <div className="flex items-center justify-between text-sm mb-1">
                                <span className="font-medium">
                                  {product.current_sold || 0} / {product.max_inventory}
                                </span>
                                {(product.current_sold || 0) >= product.max_inventory && (
                                  <Badge variant="destructive" className="text-[10px] px-1 py-0 ml-1">
                                    SOLD OUT
                                  </Badge>
                                )}
                              </div>
                              <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    (product.current_sold || 0) >= product.max_inventory
                                      ? 'bg-red-500'
                                      : (product.current_sold || 0) >= product.max_inventory * 0.8
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${Math.min(100, ((product.current_sold || 0) / product.max_inventory) * 100)}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-zinc-400 text-sm">∞</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {product.sales.soldQuantity > 0 ? (
                            <span className="font-medium text-emerald-600">{product.sales.soldQuantity}</span>
                          ) : (
                            <span className="text-zinc-300">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {product.sales.inCheckoutQuantity > 0 ? (
                            <span className="font-medium text-amber-600">{product.sales.inCheckoutQuantity}</span>
                          ) : (
                            <span className="text-zinc-300">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {(product.sales.approvedRevenue || 0) > 0 ? (
                            <span className="font-semibold text-emerald-600">
                              {formatCurrency(product.sales.approvedRevenue)}
                            </span>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {(product.sales.pendingRevenue || 0) > 0 ? (
                            <span className="font-semibold text-amber-600">
                              {formatCurrency(product.sales.pendingRevenue)}
                            </span>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Empty state when nothing selected */}
        {!filters.edgeos.enabled && !filters.fever.enabled && (
          <Card className="mt-6">
            <CardContent className="py-12 text-center">
              <Package className="h-12 w-12 text-zinc-300 mx-auto mb-4" />
              <p className="text-zinc-500">Select a data source above to view product sales</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
