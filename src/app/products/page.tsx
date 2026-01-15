'use client';

import { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/layout/Header';
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
import { Package, DollarSign, TrendingUp, Ticket, RefreshCw, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getFeverMetrics, getFeverSyncState } from '@/lib/fever-client';
import type { DashboardData, FeverMetrics, FeverSyncState, Product, PaymentWithProducts, PopupCity } from '@/lib/types';

type ActiveSource = 'edgeos' | 'fever';

export default function ProductsPage() {
  const [edgeosData, setEdgeosData] = useState<DashboardData | null>(null);
  const [feverMetrics, setFeverMetrics] = useState<FeverMetrics | null>(null);
  const [feverSync, setFeverSync] = useState<FeverSyncState | null>(null);
  const [cities, setCities] = useState<PopupCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSource, setActiveSource] = useState<ActiveSource>('edgeos');
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null);
  const [feverExpanded, setFeverExpanded] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [edgeosRes, feverM, feverS, citiesRes] = await Promise.all([
          fetch('/api/dashboard').then(r => r.json()),
          getFeverMetrics(),
          getFeverSyncState(),
          fetch('/api/popup-cities').then(r => r.json()),
        ]);
        setEdgeosData(edgeosRes);
        setFeverMetrics(feverM);
        setFeverSync(feverS);
        setCities(citiesRes);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [edgeosRes, feverM, feverS] = await Promise.all([
        fetch('/api/dashboard').then(r => r.json()),
        getFeverMetrics(),
        getFeverSyncState(),
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

  const products = edgeosData?.products || [];
  const payments = edgeosData?.payments || [];

  const filteredProducts = useMemo(() => {
    if (selectedCityId === null) return products;
    return products.filter((p: Product) => p.popup_city_id === selectedCityId);
  }, [products, selectedCityId]);

  const productPaymentData = useMemo(() => {
    const relevantProductIds = new Set(filteredProducts.map((p: Product) => p.id));

    return payments
      .filter((p: PaymentWithProducts) => p.status === 'approved')
      .flatMap((p: PaymentWithProducts) => {
        const listPriceTotal = p.paymentProducts.reduce(
          (sum: number, pp) => sum + pp.product_price * pp.quantity, 0
        );
        const discountMultiplier = listPriceTotal > 0 ? p.amount / listPriceTotal : 1;
        return p.paymentProducts
          .filter(pp => relevantProductIds.has(pp.product_id))
          .map(pp => ({ ...pp, discountMultiplier }));
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
  }, [payments, filteredProducts]);

  const productsWithSales = useMemo(() => {
    return filteredProducts.map((product: Product) => ({
      ...product,
      sales: productPaymentData[product.id] || {
        soldQuantity: 0,
        inCheckoutQuantity: 0,
        approvedRevenue: 0,
        pendingRevenue: 0,
      },
    })).sort((a, b) => (b.sales.approvedRevenue || 0) - (a.sales.approvedRevenue || 0));
  }, [filteredProducts, productPaymentData]);

  const categorySales = useMemo(() => {
    const relevantProductIds = new Set(filteredProducts.map((p: Product) => p.id));

    return payments
      .filter((p: PaymentWithProducts) => p.status === 'approved')
      .flatMap((p: PaymentWithProducts) => {
        const listPriceTotal = p.paymentProducts.reduce(
          (sum: number, pp) => sum + pp.product_price * pp.quantity, 0
        );
        const discountMultiplier = listPriceTotal > 0 ? p.amount / listPriceTotal : 1;
        return p.paymentProducts
          .filter(pp => relevantProductIds.has(pp.product_id))
          .map(pp => ({ ...pp, discountMultiplier }));
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
  }, [payments, filteredProducts]);

  const filteredMetrics = useMemo(() => {
    const totalSold = Object.values(productPaymentData).reduce((sum, p) => sum + p.soldQuantity, 0);
    const totalRevenue = Object.values(productPaymentData).reduce((sum, p) => sum + p.approvedRevenue, 0);
    return { totalSold, totalRevenue, productCount: filteredProducts.length };
  }, [productPaymentData, filteredProducts]);

  if (loading) {
    return (
      <div className="flex flex-col">
        <Header title="Products" description="Sales breakdown by product and category" />
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
      <Header title="Products" description="Sales breakdown by product and category" />

      <div className="p-4 md:p-8">
        {/* Source Tabs */}
        <div className="flex gap-1 mb-6 bg-zinc-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveSource('edgeos')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              activeSource === 'edgeos'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            )}
          >
            EdgeOS Products
          </button>
          <button
            onClick={() => setActiveSource('fever')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              activeSource === 'fever'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            )}
          >
            Fever Tickets
          </button>
        </div>

        {activeSource === 'edgeos' ? (
          <>
            {/* EdgeOS Metrics */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Products</CardTitle>
                  <Package className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl md:text-3xl font-bold">{filteredMetrics.productCount}</div>
                  <p className="text-xs md:text-sm text-zinc-500 mt-1 hidden md:block">
                    {selectedCityId ? 'in selected city' : 'across all cities'}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Sold</CardTitle>
                  <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl md:text-3xl font-bold">{filteredMetrics.totalSold}</div>
                  <p className="text-xs md:text-sm text-zinc-500 mt-1 hidden md:block">paid products</p>
                </CardContent>
              </Card>

              <Card className="bg-emerald-50 border-emerald-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-emerald-700">Revenue</CardTitle>
                  <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-emerald-600" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl md:text-3xl font-bold text-emerald-900">
                    {formatCurrency(filteredMetrics.totalRevenue)}
                  </div>
                  <p className="text-xs md:text-sm text-emerald-700 mt-1 hidden md:block">approved payments</p>
                </CardContent>
              </Card>

              <Card className="bg-amber-50 border-amber-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-amber-700">Pending</CardTitle>
                  <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-amber-600" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl md:text-3xl font-bold text-amber-900">
                    {formatCurrency(edgeosData?.metrics?.revenue.pendingRevenue || 0)}
                  </div>
                  <p className="text-xs md:text-sm text-amber-700 mt-1 hidden md:block">in checkout</p>
                </CardContent>
              </Card>
            </div>

            {/* City Filter Pills */}
            {cities.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  onClick={() => setSelectedCityId(null)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                    selectedCityId === null
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  )}
                >
                  All Cities
                </button>
                {cities.map(city => (
                  <button
                    key={city.id}
                    onClick={() => setSelectedCityId(city.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                      selectedCityId === city.id
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    )}
                  >
                    {city.name}
                  </button>
                ))}
              </div>
            )}

            {/* EdgeOS Content */}
            <div className="grid gap-4 md:gap-6 lg:grid-cols-4">
              {/* Category Breakdown - Narrow */}
              <Card className="lg:col-span-1">
                <CardHeader className="pb-3 md:pb-4">
                  <CardTitle className="text-base md:text-lg">Revenue by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(categorySales).length > 0 ? (
                    <div className="space-y-3">
                      {Object.entries(categorySales)
                        .sort(([, a], [, b]) => b.approvedRevenue - a.approvedRevenue)
                        .map(([category, data]) => (
                          <div key={category} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="outline" className="capitalize">{category}</Badge>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-zinc-600">{data.soldQuantity} sold</span>
                              <span className="font-medium text-emerald-600">
                                {data.approvedRevenue > 0 ? formatCurrency(data.approvedRevenue) : '—'}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-400 text-center py-4">No sales yet</p>
                  )}
                </CardContent>
              </Card>

              {/* Products Table - Wide */}
              <Card className="lg:col-span-3">
                <CardHeader className="pb-3 md:pb-4">
                  <CardTitle className="text-base md:text-lg">
                    {selectedCityId ? `Products (${cities.find(c => c.id === selectedCityId)?.name})` : 'All Products'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs md:text-sm">
                        <TableHead>Product</TableHead>
                        <TableHead className="hidden md:table-cell">Price</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-center">Inv</TableHead>
                        <TableHead className="hidden md:table-cell text-right text-emerald-700">Sold</TableHead>
                        <TableHead className="text-right text-emerald-700">Rev</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productsWithSales.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="max-w-[120px] md:max-w-none">
                            <div>
                              <p className="font-medium text-sm md:text-base truncate md:whitespace-normal">{product.name}</p>
                              {product.description && (
                                <p className="hidden md:block text-xs text-zinc-500 truncate max-w-xs">
                                  {product.description}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs md:text-sm">{formatCurrency(product.price)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize text-[10px] md:text-xs">
                              {product.category || 'other'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {product.max_inventory !== null ? (
                              <div className="md:min-w-[80px]">
                                <div className="flex items-center justify-between text-xs md:text-sm md:mb-1">
                                  <span className="font-medium">
                                    {product.current_sold || 0}/{product.max_inventory}
                                  </span>
                                  {(product.current_sold || 0) >= product.max_inventory && (
                                    <Badge variant="destructive" className="hidden md:inline-flex text-[10px] px-1 py-0 ml-1">
                                      SOLD OUT
                                    </Badge>
                                  )}
                                </div>
                                <div className="hidden md:block h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                                  <div
                                    className={cn(
                                      'h-full rounded-full transition-all',
                                      (product.current_sold || 0) >= product.max_inventory
                                        ? 'bg-red-500'
                                        : (product.current_sold || 0) >= product.max_inventory * 0.8
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                    )}
                                    style={{ width: `${Math.min(100, ((product.current_sold || 0) / product.max_inventory) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-zinc-400 text-xs md:text-sm">∞</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-right text-xs md:text-sm">
                            {product.sales.soldQuantity > 0 ? (
                              <span className="font-medium text-emerald-600">{product.sales.soldQuantity}</span>
                            ) : (
                              <span className="text-zinc-300">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs md:text-sm">
                            {(product.sales.approvedRevenue || 0) > 0 ? (
                              <span className="font-semibold text-emerald-600">
                                {formatCurrency(product.sales.approvedRevenue)}
                              </span>
                            ) : (
                              <span className="text-zinc-300">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {productsWithSales.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-zinc-500 py-8">
                            No products found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <>
            {/* Fever Metrics */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 mb-6">
              <Card className="bg-purple-50 border-purple-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-purple-700">Tickets Sold</CardTitle>
                  <Ticket className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl md:text-3xl font-bold text-purple-900">
                    {feverMetrics?.ticketCount || 0}
                  </div>
                  <p className="text-xs md:text-sm text-purple-700 mt-1 hidden md:block">total purchased</p>
                </CardContent>
              </Card>

              <Card className="bg-purple-50 border-purple-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-purple-700">Orders</CardTitle>
                  <Package className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl md:text-3xl font-bold text-purple-900">
                    {feverMetrics?.orderCount || 0}
                  </div>
                  <p className="text-xs md:text-sm text-purple-700 mt-1 hidden md:block">completed orders</p>
                </CardContent>
              </Card>

              <Card className="bg-purple-50 border-purple-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-purple-700 flex items-center gap-2">
                    Revenue
                    <button
                      onClick={() => setFeverExpanded(!feverExpanded)}
                      className="p-0.5 hover:bg-purple-100 rounded"
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform', feverExpanded && 'rotate-180')} />
                    </button>
                  </CardTitle>
                  <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl md:text-3xl font-bold text-purple-900">
                    {formatCurrency(feverMetrics?.totalRevenue || 0)}
                  </div>
                  <p className="text-xs md:text-sm text-purple-700 mt-1 hidden md:block">user payment</p>
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
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Fever Sync Status */}
            {feverSync && (
              <div className="mb-6 flex items-center gap-3 text-sm text-zinc-500">
                <span>Last synced: {formatTimeAgo(feverSync.lastSyncAt)}</span>
                <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw className={cn('h-4 w-4 mr-1', refreshing && 'animate-spin')} />
                  Refresh
                </Button>
              </div>
            )}

            {/* Fever Sales by Plan - Full Width Table */}
            {feverMetrics && Object.keys(feverMetrics.revenueByPlan).length > 0 && (
              <Card>
                <CardHeader className="pb-3 md:pb-4">
                  <CardTitle className="text-base md:text-lg">Sales by Plan</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plan Name</TableHead>
                        <TableHead className="text-right">Tickets</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(feverMetrics.revenueByPlan)
                        .sort(([, a], [, b]) => b.revenue - a.revenue)
                        .map(([planId, data]) => (
                          <TableRow key={planId}>
                            <TableCell className="font-medium">{data.planName}</TableCell>
                            <TableCell className="text-right text-purple-600">{data.count}</TableCell>
                            <TableCell className="text-right font-semibold text-purple-600">
                              {formatCurrency(data.revenue)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
