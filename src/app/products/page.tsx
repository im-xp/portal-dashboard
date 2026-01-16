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
import { Package, DollarSign, TrendingUp, Ticket, RefreshCw, ChevronDown, ChevronRight, Search, X, MapPin, Calendar, User, CreditCard, Tag, MessageSquare, Globe, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getFeverMetrics, getFeverSyncState, getFeverOrders } from '@/lib/fever-client';
import type { DashboardData, FeverMetrics, FeverSyncState, FeverOrderWithItems, FeverOrdersResponse, Product, PaymentWithProducts, PopupCity } from '@/lib/types';

type ActiveSource = 'edgeos' | 'fever';

function InfoTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <span className="relative group inline-flex">
      <Info className={cn('h-3 w-3 cursor-help', className || 'text-purple-400')} />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-zinc-800 rounded shadow-lg whitespace-normal w-48 text-center opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-50">
        {text}
      </span>
    </span>
  );
}

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

  // Fever orders state
  const [feverOrders, setFeverOrders] = useState<FeverOrdersResponse | null>(null);
  const [feverOrdersLoading, setFeverOrdersLoading] = useState(false);
  const [feverSearch, setFeverSearch] = useState('');
  const [feverStatusFilter, setFeverStatusFilter] = useState('');
  const [feverPlanFilter, setFeverPlanFilter] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [salesByPlanExpanded, setSalesByPlanExpanded] = useState(false);
  const [salesByProductExpanded, setSalesByProductExpanded] = useState(false);
  const [salesByProductFilter, setSalesByProductFilter] = useState<string>('all');

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

  // Fetch fever orders when tab is active
  useEffect(() => {
    if (activeSource !== 'fever') return;

    async function fetchOrders() {
      setFeverOrdersLoading(true);
      try {
        const data = await getFeverOrders({
          search: feverSearch,
          status: feverStatusFilter,
          plan: feverPlanFilter,
        });
        setFeverOrders(data);
      } catch (error) {
        console.error('Failed to fetch fever orders:', error);
      } finally {
        setFeverOrdersLoading(false);
      }
    }

    const debounce = setTimeout(fetchOrders, 300);
    return () => clearTimeout(debounce);
  }, [activeSource, feverSearch, feverStatusFilter, feverPlanFilter]);

  const toggleOrderExpanded = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateRange = (start: string | null, end: string | null) => {
    if (!start) return '-';
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!endDate) return startStr;
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startStr} - ${endStr}`;
  };

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
                  <CardTitle className="text-xs md:text-sm font-medium text-purple-700 flex items-center gap-1">
                    Tickets Sold
                    <InfoTooltip text="Count of individual ticket/addon items with status 'purchased'. Excludes cancelled or refunded items." />
                  </CardTitle>
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
                  <CardTitle className="text-xs md:text-sm font-medium text-purple-700 flex items-center gap-1">
                    Orders
                    <InfoTooltip text="Count of unique orders with at least one purchased item. Orders with only cancelled items are excluded." />
                  </CardTitle>
                  <Package className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl md:text-3xl font-bold text-purple-900">
                    {feverMetrics?.orderCount || 0}
                  </div>
                  <p className="text-xs md:text-sm text-purple-700 mt-1 hidden md:block">with purchased items</p>
                </CardContent>
              </Card>

              <Card className="bg-purple-50 border-purple-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
                  <CardTitle className="text-xs md:text-sm font-medium text-purple-700 flex items-center gap-1">
                    Revenue
                    <InfoTooltip text="Total user payment from purchased items only: (price + surcharge - discount). Excludes cancelled/refunded." />
                    <button
                      onClick={() => setFeverExpanded(!feverExpanded)}
                      className="p-0.5 hover:bg-purple-100 rounded ml-1"
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

            {/* Sales by Product Type - Full Width Table */}
            {feverOrders && (
              <Card className="mb-6">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Sales by Product</CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const bySession = feverOrders.orders.reduce((acc, order) => {
                      for (const item of order.items) {
                        if (item.status !== 'purchased') continue;
                        const name = item.session_name || 'Unknown';
                        const type = item.session_is_addon ? 'Addon' : 'Ticket';
                        if (!acc[name]) acc[name] = { count: 0, revenue: 0, type };
                        acc[name].count++;
                        acc[name].revenue += (item.unitary_price || 0) + (item.surcharge || 0);
                      }
                      return acc;
                    }, {} as Record<string, { count: number; revenue: number; type: string }>);

                    const allEntries = Object.entries(bySession).sort(([, a], [, b]) => b.revenue - a.revenue);
                    const productTypes = [...new Set(allEntries.map(([, d]) => d.type))].sort();

                    const filtered = salesByProductFilter === 'all'
                      ? allEntries
                      : allEntries.filter(([, d]) => d.type === salesByProductFilter);

                    const displayed = salesByProductExpanded ? filtered : filtered.slice(0, 4);
                    const hasMore = filtered.length > 4;
                    const totalRevenue = filtered.reduce((sum, [, d]) => sum + d.revenue, 0);
                    const totalCount = filtered.reduce((sum, [, d]) => sum + d.count, 0);

                    return (
                      <>
                        <div className="flex gap-1 mb-4 bg-zinc-100 p-1 rounded-lg w-fit">
                          <button
                            onClick={() => { setSalesByProductFilter('all'); setSalesByProductExpanded(false); }}
                            className={cn(
                              'px-3 py-1 rounded-md text-sm font-medium transition-colors',
                              salesByProductFilter === 'all'
                                ? 'bg-white text-zinc-900 shadow-sm'
                                : 'text-zinc-600 hover:text-zinc-900'
                            )}
                          >
                            All
                          </button>
                          {productTypes.map(type => (
                            <button
                              key={type}
                              onClick={() => { setSalesByProductFilter(type); setSalesByProductExpanded(false); }}
                              className={cn(
                                'px-3 py-1 rounded-md text-sm font-medium transition-colors',
                                salesByProductFilter === type
                                  ? 'bg-white text-zinc-900 shadow-sm'
                                  : 'text-zinc-600 hover:text-zinc-900'
                              )}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Product</TableHead>
                              {salesByProductFilter === 'all' && <TableHead className="text-center w-20">Type</TableHead>}
                              <TableHead className="text-right w-24">Qty</TableHead>
                              <TableHead className="text-right w-32">Revenue</TableHead>
                              <TableHead className="text-right w-20">%</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {displayed.map(([name, data]) => (
                              <TableRow key={name}>
                                <TableCell className="font-medium text-sm">{name}</TableCell>
                                {salesByProductFilter === 'all' && (
                                  <TableCell className="text-center">
                                    {data.type === 'Addon' ? (
                                      <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                                        Addon
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px]">
                                        Ticket
                                      </Badge>
                                    )}
                                  </TableCell>
                                )}
                                <TableCell className="text-right text-purple-600">{data.count}</TableCell>
                                <TableCell className="text-right font-semibold text-purple-600">
                                  {formatCurrency(data.revenue)}
                                </TableCell>
                                <TableCell className="text-right text-zinc-500 text-sm">
                                  {totalRevenue > 0 ? `${((data.revenue / totalRevenue) * 100).toFixed(1)}%` : '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                            {salesByProductExpanded && (
                              <TableRow className="border-t-2 font-semibold">
                                <TableCell>Total</TableCell>
                                {salesByProductFilter === 'all' && <TableCell></TableCell>}
                                <TableCell className="text-right text-purple-700">{totalCount}</TableCell>
                                <TableCell className="text-right text-purple-700">{formatCurrency(totalRevenue)}</TableCell>
                                <TableCell className="text-right">100%</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                        {hasMore && (
                          <button
                            onClick={() => setSalesByProductExpanded(!salesByProductExpanded)}
                            className="w-full pt-3 flex items-center justify-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
                          >
                            {salesByProductExpanded ? (
                              <>Show less <ChevronDown className="h-4 w-4 rotate-180" /></>
                            ) : (
                              <>Show {filtered.length - 4} more <ChevronDown className="h-4 w-4" /></>
                            )}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Sales by Plan */}
            {feverMetrics && Object.keys(feverMetrics.revenueByPlan).length > 0 && (
              <Card className="mb-6">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-zinc-500">Sales by Plan</CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const sorted = Object.entries(feverMetrics.revenueByPlan)
                      .sort(([, a], [, b]) => b.revenue - a.revenue);
                    const displayed = salesByPlanExpanded ? sorted : sorted.slice(0, 4);
                    const hasMore = sorted.length > 4;

                    return (
                      <div className="space-y-2">
                        {displayed.map(([planId, data]) => (
                          <div key={planId} className="flex items-center justify-between py-1">
                            <div className="font-medium text-sm">{data.planName}</div>
                            <div className="flex items-center gap-4">
                              <span className="text-sm text-zinc-500">{data.count} tickets</span>
                              <span className="font-semibold text-purple-600 w-24 text-right">
                                {formatCurrency(data.revenue)}
                              </span>
                            </div>
                          </div>
                        ))}
                        {hasMore && (
                          <button
                            onClick={() => setSalesByPlanExpanded(!salesByPlanExpanded)}
                            className="w-full pt-2 flex items-center justify-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
                          >
                            {salesByPlanExpanded ? (
                              <>Show less <ChevronDown className="h-4 w-4 rotate-180" /></>
                            ) : (
                              <>Show {sorted.length - 4} more <ChevronDown className="h-4 w-4" /></>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Secondary Stats Row */}
            {feverOrders && (
              <div className="grid gap-4 md:grid-cols-3 mb-6">
                {/* By Payment Method */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-zinc-500 flex items-center gap-1">
                      <CreditCard className="h-4 w-4" /> Payment Methods
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const byMethod = feverOrders.orders.reduce((acc, order) => {
                        const method = order.payment_method || 'Unknown';
                        if (!acc[method]) acc[method] = 0;
                        acc[method]++;
                        return acc;
                      }, {} as Record<string, number>);

                      return (
                        <div className="space-y-1.5">
                          {Object.entries(byMethod)
                            .sort(([, a], [, b]) => b - a)
                            .slice(0, 5)
                            .map(([method, count]) => (
                              <div key={method} className="flex justify-between text-sm">
                                <span className="text-zinc-600 truncate">{method}</span>
                                <span className="font-medium">{count}</span>
                              </div>
                            ))}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>

                {/* By Country */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-zinc-500 flex items-center gap-1">
                      <MapPin className="h-4 w-4" /> Top Countries
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const byCountry = feverOrders.orders.reduce((acc, order) => {
                        const country = order.purchase_country || 'Unknown';
                        if (!acc[country]) acc[country] = 0;
                        acc[country]++;
                        return acc;
                      }, {} as Record<string, number>);

                      return (
                        <div className="space-y-1.5">
                          {Object.entries(byCountry)
                            .sort(([, a], [, b]) => b - a)
                            .slice(0, 5)
                            .map(([country, count]) => (
                              <div key={country} className="flex justify-between text-sm">
                                <span className="text-zinc-600">{country}</span>
                                <span className="font-medium">{count}</span>
                              </div>
                            ))}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>

                {/* Status Breakdown */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-zinc-500 flex items-center gap-1">
                      <Ticket className="h-4 w-4" /> Item Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const byStatus = feverOrders.orders.reduce((acc, order) => {
                        for (const item of order.items) {
                          const status = item.status || 'unknown';
                          if (!acc[status]) acc[status] = 0;
                          acc[status]++;
                        }
                        return acc;
                      }, {} as Record<string, number>);

                      return (
                        <div className="space-y-1.5">
                          {Object.entries(byStatus)
                            .sort(([, a], [, b]) => b - a)
                            .map(([status, count]) => (
                              <div key={status} className="flex justify-between text-sm">
                                <span className={cn(
                                  'capitalize',
                                  status === 'purchased' ? 'text-emerald-600' :
                                  status === 'cancelled' ? 'text-red-600' : 'text-zinc-600'
                                )}>{status}</span>
                                <span className="font-medium">{count}</span>
                              </div>
                            ))}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Orders Section - Collapsible */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-1">
                    Orders ({feverOrders?.total || 0})
                    <InfoTooltip text="All orders in database, including those with only cancelled items. May differ from metric above." className="text-zinc-400 h-3.5 w-3.5" />
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedOrders(new Set())}
                    className="text-xs"
                  >
                    Collapse All
                  </Button>
                </div>
                {/* Search and Filters */}
                <div className="flex flex-col md:flex-row gap-2 mt-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input
                      placeholder="Search email, name, order ID..."
                      value={feverSearch}
                      onChange={(e) => setFeverSearch(e.target.value)}
                      className="pl-9 pr-9 h-9 text-sm"
                    />
                    {feverSearch && (
                      <button
                        onClick={() => setFeverSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <select
                    value={feverStatusFilter}
                    onChange={(e) => setFeverStatusFilter(e.target.value)}
                    className="px-3 py-1.5 border rounded-md text-sm bg-white h-9"
                  >
                    <option value="">All Status</option>
                    <option value="purchased">Purchased</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </CardHeader>
              <CardContent>
                {feverOrdersLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 bg-zinc-100 animate-pulse rounded" />
                    ))}
                  </div>
                ) : feverOrders?.orders.length === 0 ? (
                  <div className="py-8 text-center text-zinc-500">No orders found</div>
                ) : (
                  <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
                    {feverOrders?.orders.slice(0, 100).map((order) => {
                      const isExpanded = expandedOrders.has(order.fever_order_id);
                      const buyerName = [order.buyer_first_name, order.buyer_last_name]
                        .filter(Boolean)
                        .join(' ') || 'Unknown';

                      return (
                        <div key={order.fever_order_id} className="border rounded bg-white">
                          <button
                            onClick={() => toggleOrderExpanded(order.fever_order_id)}
                            className="w-full px-3 py-2 text-left hover:bg-zinc-50 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex-1 min-w-0 flex items-center gap-3">
                                <span className="font-mono text-xs text-zinc-400">
                                  #{order.fever_order_id.slice(-6)}
                                </span>
                                <span className="font-medium text-sm truncate">{buyerName}</span>
                                <span className="text-xs text-zinc-500 truncate hidden md:inline">
                                  {order.buyer_email}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <span className="text-xs text-zinc-400">
                                  {formatDate(order.order_created_at)}
                                </span>
                                <span className="font-semibold text-sm text-purple-600">
                                  {formatCurrency(order.total_value)}
                                </span>
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-zinc-400" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                                )}
                              </div>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="border-t px-3 py-3 bg-zinc-50 space-y-3 text-sm">
                              {/* Items */}
                              <div className="space-y-1.5">
                                {order.items.map((item) => (
                                  <div key={item.fever_item_id} className="bg-white rounded p-2 border flex items-center justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm truncate">{item.session_name}</div>
                                      <div className="text-xs text-zinc-500 flex items-center gap-2">
                                        <span>{formatDateRange(item.session_start, item.session_end)}</span>
                                        <Badge variant="outline" className={cn('text-[10px]',
                                          item.status === 'purchased' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                                        )}>{item.status}</Badge>
                                        {item.session_is_addon && <Badge variant="outline" className="text-[10px]">Addon</Badge>}
                                      </div>
                                      {item.plan_code_barcode && (
                                        <div className="text-[10px] text-zinc-400 font-mono mt-1">{item.plan_code_barcode}</div>
                                      )}
                                    </div>
                                    <div className="font-semibold text-purple-600">
                                      {formatCurrency((item.unitary_price || 0) + (item.surcharge || 0))}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Buyer & Meta */}
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                                {order.purchase_city && <span><MapPin className="h-3 w-3 inline" /> {order.purchase_city}, {order.purchase_country}</span>}
                                {order.payment_method && <span><CreditCard className="h-3 w-3 inline" /> {order.payment_method}</span>}
                                {order.coupon_code && <span className="text-emerald-600"><Tag className="h-3 w-3 inline" /> {order.coupon_code}</span>}
                              </div>

                              {/* Booking Questions */}
                              {order.booking_questions && Array.isArray(order.booking_questions) && order.booking_questions.length > 0 && (
                                <div className="text-xs space-y-1 pt-2 border-t">
                                  {(order.booking_questions as Array<{question: string; answers: string[]}>).map((q, i) => (
                                    <div key={i} className="flex gap-2">
                                      <span className="text-zinc-400">{q.question}:</span>
                                      <span>{q.answers?.join(', ')}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(feverOrders?.orders.length || 0) > 100 && (
                      <div className="text-center text-xs text-zinc-500 py-2">
                        Showing first 100 of {feverOrders?.orders.length} orders
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
