import { getDashboardData } from '@/lib/nocodb';
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
import { Package, DollarSign, TrendingUp } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const { metrics, products, payments } = await getDashboardData();

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  // Build product sales DIRECTLY from payment_products (not attendee_products)
  // This ensures the table matches the category breakdown and totals
  const productPaymentData = payments
    .filter(p => p.status === 'pending' || p.status === 'approved')
    .flatMap(p => p.paymentProducts.map(pp => ({ ...pp, paymentStatus: p.status })))
    .reduce((acc, pp) => {
      if (!acc[pp.product_id]) {
        acc[pp.product_id] = { 
          soldQuantity: 0,      // From approved payments
          inCheckoutQuantity: 0, // From pending payments
          approvedRevenue: 0,
          pendingRevenue: 0,
          productName: pp.product_name,
          productCategory: pp.product_category,
        };
      }
      const amount = pp.product_price * pp.quantity;
      if (pp.paymentStatus === 'approved') {
        acc[pp.product_id].soldQuantity += pp.quantity;
        acc[pp.product_id].approvedRevenue += amount;
      } else {
        acc[pp.product_id].inCheckoutQuantity += pp.quantity;
        acc[pp.product_id].pendingRevenue += amount;
      }
      return acc;
    }, {} as Record<number, { 
      soldQuantity: number;
      inCheckoutQuantity: number;
      approvedRevenue: number;
      pendingRevenue: number;
      productName: string;
      productCategory: string;
    }>);

  // Combine products with their payment sales data
  const productsWithSales = products.map(product => ({
    ...product,
    sales: productPaymentData[product.id] || { 
      soldQuantity: 0,
      inCheckoutQuantity: 0,
      approvedRevenue: 0,
      pendingRevenue: 0,
    },
  }));

  // Sort by total revenue (approved + pending, highest first)
  const sortedProducts = productsWithSales.sort((a, b) => {
    const aTotal = (a.sales.approvedRevenue || 0) + (a.sales.pendingRevenue || 0);
    const bTotal = (b.sales.approvedRevenue || 0) + (b.sales.pendingRevenue || 0);
    return bTotal - aTotal;
  });

  // Category breakdown calculated DIRECTLY from payment_products (not via attendee_products)
  // This ensures the numbers match the payment totals exactly
  const categorySales = payments
    .filter(p => p.status === 'pending' || p.status === 'approved')
    .flatMap(p => p.paymentProducts.map(pp => ({ ...pp, paymentStatus: p.status })))
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
      const amount = pp.product_price * pp.quantity;
      if (pp.paymentStatus === 'approved') {
        acc[category].soldQuantity += pp.quantity;
        acc[category].approvedRevenue += amount;
      } else {
        acc[category].inCartQuantity += pp.quantity;
        acc[category].pendingRevenue += amount;
      }
      return acc;
    }, {} as Record<string, { 
      soldQuantity: number; 
      inCartQuantity: number;
      approvedRevenue: number; 
      pendingRevenue: number;
    }>);

  return (
    <div className="flex flex-col">
      <Header
        title="Products"
        description="Sales breakdown by product and category"
      />

      <div className="p-4 md:p-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6 md:mb-8">
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
                {metrics.productSales.reduce((sum, ps) => sum + ps.quantity, 0)}
              </div>
              <p className="text-xs md:text-sm text-zinc-500 mt-1 hidden md:block">includes test/manual</p>
            </CardContent>
          </Card>

          <Card className="bg-emerald-50 border-emerald-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-emerald-700">Approved</CardTitle>
              <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-emerald-600" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-xl md:text-3xl font-bold text-emerald-900">
                {formatCurrency(metrics.revenue.approvedRevenue)}
              </div>
              <p className="text-xs md:text-sm text-emerald-700 mt-1 hidden md:block">
                {metrics.revenue.approvedPaymentsCount} completed
              </p>
            </CardContent>
          </Card>

          <Card className="bg-amber-50 border-amber-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-amber-700">Pending</CardTitle>
              <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-amber-600" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-xl md:text-3xl font-bold text-amber-900">
                {formatCurrency(metrics.revenue.pendingRevenue)}
              </div>
              <p className="text-xs md:text-sm text-amber-700 mt-1 hidden md:block">
                {metrics.revenue.pendingPaymentsCount} in checkout
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          {/* Category Breakdown */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3 md:pb-6">
              <CardTitle className="text-base md:text-lg">Revenue by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(categorySales)
                  .sort(([, a], [, b]) => (b.approvedRevenue + b.pendingRevenue) - (a.approvedRevenue + a.pendingRevenue))
                  .map(([category, data]) => (
                    <div key={category} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className="capitalize">{category}</Badge>
                      </div>
                      {/* Approved row */}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-emerald-600">
                          {data.soldQuantity} sold
                        </span>
                        <span className="font-medium text-emerald-600">
                          {data.approvedRevenue > 0 ? formatCurrency(data.approvedRevenue) : '—'}
                        </span>
                      </div>
                      {/* Pending row */}
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-amber-600">
                          {data.inCartQuantity} in carts
                        </span>
                        <span className="font-medium text-amber-600">
                          {data.pendingRevenue > 0 ? formatCurrency(data.pendingRevenue) : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                {Object.keys(categorySales).length === 0 && (
                  <p className="text-sm text-zinc-500 text-center py-4">No payments yet</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Products Table */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3 md:pb-6">
              <CardTitle className="text-base md:text-lg">All Products</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Category</TableHead>
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
        </div>
      </div>
    </div>
  );
}

