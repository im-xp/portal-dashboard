import type {
  NocoDBResponse,
  Application,
  Attendee,
  Product,
  LinkedProduct,
  AttendeeWithProducts,
  AttendeeProductWithStatus,
  ApplicationWithDetails,
  Payment,
  PaymentProduct,
  PaymentWithProducts,
  RevenueMetrics,
  ProductSaleRecord,
  JourneyStage,
  DashboardData,
  PopupCity,
} from './types';

// Helper to clean env vars (strip whitespace/newlines that can corrupt values)
const cleanEnv = (value: string | undefined): string => (value || '').trim();

// NocoDB configuration with validation
const NOCODB_URL = cleanEnv(process.env.NOCODB_URL) || 'https://app.nocodb.com/api/v2';
const NOCODB_TOKEN = cleanEnv(process.env.NOCODB_TOKEN);

// Validate URL contains /api/v2 (common misconfiguration)
if (NOCODB_URL && !NOCODB_URL.includes('/api/v2')) {
  console.error(
    `⚠️ NOCODB_URL misconfigured! Got "${NOCODB_URL}" but expected path to include "/api/v2". ` +
    `Full URL should be "https://app.nocodb.com/api/v2"`
  );
}

// Validate token is present
if (!NOCODB_TOKEN) {
  console.error('⚠️ NOCODB_TOKEN is not set! API calls will fail.');
}

const TABLES = {
  applications: cleanEnv(process.env.NOCODB_TABLE_APPLICATIONS) || 'mhiveeaf8gb9kvy',
  attendees: cleanEnv(process.env.NOCODB_TABLE_ATTENDEES) || 'mduqna6ve55k8wi',
  products: cleanEnv(process.env.NOCODB_TABLE_PRODUCTS) || 'mjt8xx9ltkhfcbu',
  payments: cleanEnv(process.env.NOCODB_TABLE_PAYMENTS) || 'mgxw2e15fw64o1f',
  paymentProducts: cleanEnv(process.env.NOCODB_TABLE_PAYMENT_PRODUCTS) || 'm9y11y6lwwxuq6k',
} as const;

// Simple delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Simple in-memory cache with TTL (persists across hot reloads in dev)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

declare global {
  // eslint-disable-next-line no-var
  var nocoDBCache: Map<string, CacheEntry<unknown>> | undefined;
}

const cache = globalThis.nocoDBCache ?? new Map<string, CacheEntry<unknown>>();
globalThis.nocoDBCache = cache;

const CACHE_TTL = 60 * 1000; // 60 seconds

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export function clearCache(): void {
  cache.clear();
}

async function nocoFetch<T>(endpoint: string, retries = 3): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${NOCODB_URL}${endpoint}`, {
        headers: {
          'xc-token': NOCODB_TOKEN,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (res.status === 429) {
        // Rate limited - short backoff for serverless
        const waitTime = 500 * (attempt + 1);
        console.log(`Rate limited on ${endpoint}, waiting ${waitTime}ms`);
        await delay(waitTime);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        // Provide helpful diagnosis for common errors
        if (res.status === 404) {
          throw new Error(
            `NocoDB API error: 404 Not Found - ${text}\n` +
            `Full URL: ${NOCODB_URL}${endpoint}\n` +
            `Check: NOCODB_URL should be "https://app.nocodb.com/api/v2"`
          );
        }
        throw new Error(`NocoDB API error: ${res.status} ${res.statusText} - ${text}`);
      }

      return res.json();
    } catch (error) {
      console.error(`Fetch attempt ${attempt + 1} failed for ${endpoint}:`, error);
      if (attempt === retries - 1) throw error;
      await delay(300 * (attempt + 1));
    }
  }
  throw new Error('NocoDB API: Max retries exceeded');
}

// Base fetchers

export async function getApplications(): Promise<Application[]> {
  const response = await nocoFetch<NocoDBResponse<Application>>(
    `/tables/${TABLES.applications}/records?limit=500`
  );
  return response.list;
}

export async function getAttendees(): Promise<Attendee[]> {
  const response = await nocoFetch<NocoDBResponse<Attendee>>(
    `/tables/${TABLES.attendees}/records?limit=500`
  );
  return response.list;
}

export async function getProducts(): Promise<Product[]> {
  const response = await nocoFetch<NocoDBResponse<Product>>(
    `/tables/${TABLES.products}/records?limit=500`
  );
  return response.list;
}

export async function getPayments(): Promise<Payment[]> {
  const response = await nocoFetch<NocoDBResponse<Payment>>(
    `/tables/${TABLES.payments}/records?limit=500`
  );
  return response.list;
}

export async function getPaymentProducts(): Promise<PaymentProduct[]> {
  const response = await nocoFetch<NocoDBResponse<PaymentProduct>>(
    `/tables/${TABLES.paymentProducts}/records?limit=500`
  );
  return response.list;
}

export async function getPopupCities(): Promise<PopupCity[]> {
  const cacheKey = 'popup-cities';
  const cached = getCached<PopupCity[]>(cacheKey);
  if (cached) return cached;

  // Derive popup cities from applications data (they have linked popups)
  const applications = await getApplications();
  const citiesMap = new Map<number, PopupCity>();

  for (const app of applications) {
    if (app.popups && app.popup_city_id && !citiesMap.has(app.popup_city_id)) {
      citiesMap.set(app.popup_city_id, {
        id: app.popups.id,
        name: app.popups.name,
        slug: app.popups.name.toLowerCase().replace(/\s+/g, '-'),
      });
    }
  }

  const cities = Array.from(citiesMap.values());
  setCache(cacheKey, cities);
  return cities;
}

// Dashboard data fetcher (aggregates everything)

export async function getDashboardData(): Promise<DashboardData> {
  // Check cache first
  const cacheKey = 'dashboard-data';
  const cached = getCached<DashboardData>(cacheKey);
  if (cached) {
    console.log('Using cached dashboard data');
    return cached;
  }

  console.log('Fetching fresh dashboard data...');
  
  // Fetch all base data in parallel for speed
  const [applications, attendees, products, payments, paymentProducts] = await Promise.all([
    getApplications(),
    getAttendees(),
    getProducts(),
    getPayments(),
    getPaymentProducts(),
  ]);
  
  // NOTE: We skip fetching attendee_products (linked products) because:
  // 1. It requires N API calls (one per attendee) which is too slow
  // 2. payment_products already contains all purchased product data
  // 3. attendee_products is legacy/manual assignment data
  const productsMap = new Map<number, LinkedProduct[]>();
  
  // Group payment products by payment_id first (need this for payment status)
  const paymentProductsByPayment = paymentProducts.reduce((acc, pp) => {
    if (!acc[pp.payment_id]) {
      acc[pp.payment_id] = [];
    }
    acc[pp.payment_id].push(pp);
    return acc;
  }, {} as Record<number, PaymentProduct[]>);

  // Create payments with products for status lookup
  const paymentsWithProducts: PaymentWithProducts[] = payments.map(payment => ({
    ...payment,
    paymentProducts: paymentProductsByPayment[payment.id] || [],
  }));

  // Build per-attendee product maps from payment data
  // NOTE: We only track approved payments now. Pending payments in the DB are meaningless.
  // inCartByAttendee is kept empty for future cart feature.
  const soldByAttendee = new Map<number, AttendeeProductWithStatus[]>();
  const inCartByAttendee = new Map<number, AttendeeProductWithStatus[]>();

  for (const payment of paymentsWithProducts) {
    // Only process approved payments - pending payments are meaningless in current DB
    if (payment.status !== 'approved') continue;
    
    for (const pp of payment.paymentProducts) {
      const existing = soldByAttendee.get(pp.attendee_id) || [];
      existing.push({
        id: pp.product_id,
        name: pp.product_name,
        price: pp.product_price,
        quantity: pp.quantity,
        category: pp.product_category || 'other',
        status: 'sold',
      });
      soldByAttendee.set(pp.attendee_id, existing);
    }
  }

  // Calculate journey stage for each attendee
  // NOTE: in_cart stage is kept for future cart feature but currently won't be triggered
  function calculateJourneyStage(
    soldProducts: AttendeeProductWithStatus[],
    _inCartProducts: AttendeeProductWithStatus[]
  ): { stage: JourneyStage; hasPass: boolean; hasLodging: boolean } {
    // Check sold products (approved payments only)
    const soldPass = soldProducts.some(p => p.category === 'month');
    const soldLodging = soldProducts.some(p => p.category === 'lodging');
    
    const hasPass = soldPass;
    const hasLodging = soldLodging;
    
    // Determine stage based on what they've PAID for
    if (soldPass && soldLodging) {
      return { stage: 'confirmed', hasPass: true, hasLodging: true };
    }
    
    if (soldPass || soldLodging) {
      return { stage: 'partial', hasPass, hasLodging };
    }
    
    return { stage: 'accepted', hasPass: false, hasLodging: false };
  }

  const attendeesWithProducts: AttendeeWithProducts[] = attendees.map(attendee => {
    const sold = soldByAttendee.get(attendee.id) || [];
    const inCart = inCartByAttendee.get(attendee.id) || [];
    const { stage, hasPass, hasLodging } = calculateJourneyStage(sold, inCart);
    
    return {
      ...attendee,
      purchasedProducts: productsMap.get(attendee.id) || [],
      soldProducts: sold,
      inCartProducts: inCart,
      journeyStage: stage,
      hasPass,
      hasLodging,
    };
  });

  // Calculate metrics
  const totalApplications = applications.length;
  const acceptedApplications = applications.filter(a => a.status === 'accepted').length;

  // === REVENUE CALCULATIONS FROM PAYMENTS ===
  // NOTE: Pending payments in DB are meaningless, so we only count approved payments.
  // Pending metrics are hardcoded to 0 but kept in the structure for future cart feature.

  const approvedPayments = paymentsWithProducts.filter(p => p.status === 'approved');

  const approvedRevenue = approvedPayments.reduce((sum, p) => sum + p.amount, 0);

  const revenue: RevenueMetrics = {
    approvedRevenue,
    pendingRevenue: 0,  // Hardcoded - pending payments in DB are meaningless
    totalRevenue: approvedRevenue,
    approvedPaymentsCount: approvedPayments.length,
    pendingPaymentsCount: 0,  // Hardcoded - pending payments in DB are meaningless
  };

  // Get attendee IDs with approved payments only
  const attendeeIdsWithApproved = new Set(
    approvedPayments.flatMap(p => p.paymentProducts.map(pp => pp.attendee_id))
  );

  const paidAttendees = attendeeIdsWithApproved.size;
  const pendingAttendees = 0;  // Hardcoded - pending payments in DB are meaningless

  // === PRODUCT SALES AGGREGATION ===
  
  // Build a map of actual revenue from payment_products (price at time of purchase)
  // IMPORTANT: Discount codes are applied at the payment level, so we distribute
  // the discount proportionally across payment products
  // NOTE: Only approved payments - pending payments in DB are meaningless
  const actualRevenueByProduct = new Map<number, { 
    revenue: number; 
    quantity: number;
    hasPending: boolean;  // Kept for future cart feature, will always be false
    hasApproved: boolean;
  }>();

  for (const payment of approvedPayments) {
    // Calculate the list price total for this payment to distribute discount
    const listPriceTotal = payment.paymentProducts.reduce(
      (sum, pp) => sum + pp.product_price * pp.quantity, 0
    );
    // Discount multiplier: if there's a discount, use actual amount / list total
    const discountMultiplier = listPriceTotal > 0 ? payment.amount / listPriceTotal : 1;
    
    for (const pp of payment.paymentProducts) {
      const existing = actualRevenueByProduct.get(pp.product_id) || {
        revenue: 0,
        quantity: 0,
        hasPending: false,
        hasApproved: false,
      };
      // Apply discount multiplier to get actual revenue (not list price)
      existing.revenue += pp.product_price * pp.quantity * discountMultiplier;
      existing.quantity += pp.quantity;
      existing.hasApproved = true;
      actualRevenueByProduct.set(pp.product_id, existing);
    }
  }

  // Product sales from attendee_products (assigned products)
  const productSalesMap = new Map<number, { product: Product; quantity: number }>();
  
  for (const attendee of attendeesWithProducts) {
    for (const linkedProduct of attendee.purchasedProducts) {
      const product = products.find(p => p.id === linkedProduct.id);
      if (product) {
        const existing = productSalesMap.get(product.id);
        if (existing) {
          existing.quantity += 1;
        } else {
          productSalesMap.set(product.id, { product, quantity: 1 });
        }
      }
    }
  }

  const productSales: ProductSaleRecord[] = Array.from(productSalesMap.values()).map(({ product, quantity }) => {
    const actualData = actualRevenueByProduct.get(product.id);
    return {
      product,
      quantity,
      revenue: product.price * quantity,  // At current price
      actualRevenue: actualData?.revenue || 0,  // At purchase price
      hasPendingPayments: actualData?.hasPending || false,
      hasApprovedPayments: actualData?.hasApproved || false,
    };
  });

  // Payments with discounts (coupon codes used)
  const paymentsWithDiscounts = paymentsWithProducts.filter(
    p => p.coupon_code || p.discount_value > 0
  );

  // Status breakdown
  const applicationsByStatus = applications.reduce((acc, app) => {
    acc[app.status] = (acc[app.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Group attendees by application for the full view
  const attendeesByApp = attendeesWithProducts.reduce((acc, att) => {
    if (!acc[att.application_id]) {
      acc[att.application_id] = [];
    }
    acc[att.application_id].push(att);
    return acc;
  }, {} as Record<number, AttendeeWithProducts[]>);

  const applicationsWithDetails: ApplicationWithDetails[] = applications.map((app) => ({
    ...app,
    attendeesList: attendeesByApp[app.id] || [],
  }));

  const result = {
    metrics: {
      totalApplications,
      acceptedApplications,
      paidAttendees,
      pendingAttendees,
      revenue,
      applicationsByStatus,
      productSales,
      paymentsWithDiscounts,
    },
    applications: applicationsWithDetails,
    attendees: attendeesWithProducts,
    products,
    payments: paymentsWithProducts,
  };

  // Cache the result
  setCache(cacheKey, result);
  console.log('Dashboard data cached');
  
  return result;
}
