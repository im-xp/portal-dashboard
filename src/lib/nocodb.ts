import { createClient, type RedisClientType } from 'redis';
import type {
  NocoDBResponse,
  Application,
  Attendee,
  Product,
  LinkedProduct,
  AttendeeWithProducts,
  AttendeeProductWithStatus,
  AttendeeInstallmentInfo,
  ApplicationWithDetails,
  Payment,
  PaymentProduct,
  PaymentWithProducts,
  RevenueMetrics,
  ProductSaleRecord,
  JourneyStage,
  DashboardData,
  PopupCity,
  VolunteerApplication,
  VolunteerCustomData,
  VolunteerDashboardData,
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

// Redis cache with TTL (shared across all serverless instances)
const CACHE_TTL = 600; // 10 minutes fresh
const STALE_TTL = 3600; // 1 hour stale fallback (safety net for NocoDB outages)
const REDIS_URL = process.env.REDIS_URL;

let redisClient: RedisClientType | null = null;

async function getRedis(): Promise<RedisClientType | null> {
  if (!REDIS_URL) {
    console.warn('REDIS_URL not set, caching disabled');
    return null;
  }

  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => console.error('Redis error:', err));
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  return redisClient;
}

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('Cache get failed:', e);
    return null;
  }
}

async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    const json = JSON.stringify(data);
    await Promise.all([
      redis.setEx(key, CACHE_TTL, json),
      redis.setEx(`${key}:stale`, STALE_TTL, json),
    ]);
  } catch (e) {
    console.error('Cache set failed:', e);
  }
}

async function getStaleCached<T>(key: string): Promise<T | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const data = await redis.get(`${key}:stale`);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('Stale cache get failed:', e);
    return null;
  }
}

export async function clearCache(): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.del([
      'dashboard-data', 'dashboard-data:stale',
      'popup-cities', 'popup-cities:stale',
      'volunteer-data', 'volunteer-data:stale',
    ]);
  } catch (e) {
    console.error('Cache clear failed:', e);
  }
}

const FETCH_TIMEOUT = 10000;

async function nocoFetch<T>(endpoint: string, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(`${NOCODB_URL}${endpoint}`, {
        headers: {
          'xc-token': NOCODB_TOKEN,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (res.status === 429) {
        if (attempt === retries) throw new Error(`NocoDB rate limited on ${endpoint}`);
        await delay(1000 * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
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
      if (error instanceof DOMException && error.name === 'AbortError') {
        const wrapped = new Error(`NocoDB timeout on ${endpoint} (${FETCH_TIMEOUT}ms)`);
        if (attempt === retries) throw wrapped;
        await delay(1000 * (attempt + 1));
        continue;
      }
      if (attempt === retries) throw error;
      await delay(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('NocoDB API: Max retries exceeded');
}

// Paginated fetcher - NocoDB caps at 100 records per page
async function nocoFetchAll<T>(tableId: string, params = ''): Promise<T[]> {
  const PAGE_SIZE = 100;
  const all: T[] = [];
  let offset = 0;

  while (true) {
    const sep = params ? '&' : '';
    const response = await nocoFetch<NocoDBResponse<T>>(
      `/tables/${tableId}/records?limit=${PAGE_SIZE}&offset=${offset}${sep}${params}`
    );
    all.push(...response.list);
    if (response.pageInfo.isLastPage || response.list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

// Base fetchers

const VOLUNTEER_POPUP_CITY_ID = 3;

export async function getApplications(): Promise<Application[]> {
  return nocoFetchAll<Application>(
    TABLES.applications,
    `where=(popup_city_id,neq,${VOLUNTEER_POPUP_CITY_ID})`
  );
}

export async function getAttendees(): Promise<Attendee[]> {
  return nocoFetchAll<Attendee>(TABLES.attendees);
}

export async function getProducts(): Promise<Product[]> {
  return nocoFetchAll<Product>(TABLES.products);
}

export async function getPayments(): Promise<Payment[]> {
  return nocoFetchAll<Payment>(TABLES.payments);
}

export async function getPaymentProducts(): Promise<PaymentProduct[]> {
  return nocoFetchAll<PaymentProduct>(TABLES.paymentProducts);
}

export async function getPopupCities(): Promise<PopupCity[]> {
  const cacheKey = 'popup-cities';
  const cached = await getCached<PopupCity[]>(cacheKey);
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
  await setCache(cacheKey, cities);
  return cities;
}

// Dashboard data fetcher with stale-while-revalidate

export async function getDashboardData(): Promise<DashboardData> {
  const cacheKey = 'dashboard-data';

  const cached = await getCached<DashboardData>(cacheKey);
  if (cached) return cached;

  const stale = await getStaleCached<DashboardData>(cacheKey);
  if (stale) {
    triggerBackgroundRefresh();
    return stale;
  }

  return refreshDashboardCache();
}

async function triggerBackgroundRefresh(): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    const locked = await redis.set('dashboard-refresh-lock', '1', { NX: true, EX: 30 });
    if (!locked) return;
    refreshDashboardCache().catch(err =>
      console.error('Background dashboard refresh failed:', err)
    );
  } catch {
    // Lock acquisition failed, skip
  }
}

export async function refreshDashboardCache(): Promise<DashboardData> {
  const data = await fetchFreshDashboardData();
  await setCache('dashboard-data', data);
  return data;
}

async function fetchFreshDashboardData(): Promise<DashboardData> {
  console.log('Fetching fresh dashboard data...');

  // Fetch sequentially to avoid NocoDB rate limits (429 on concurrent requests)
  const fetchers = [
    getApplications,
    getAttendees,
    getProducts,
    getPayments,
    getPaymentProducts,
  ] as const;

  const results: [Application[], Attendee[], Product[], Payment[], PaymentProduct[]] = [[], [], [], [], []];
  const errors: string[] = [];

  const tableNames = ['applications', 'attendees', 'products', 'payments', 'paymentProducts'];
  for (let i = 0; i < fetchers.length; i++) {
    if (i > 0) await delay(500);
    try {
      results[i] = await fetchers[i]() as (typeof results)[number];
      console.log(`  ${tableNames[i]}: ${results[i].length} records`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${tableNames[i]}: FAILED - ${msg}`);
      errors.push(msg);
    }
  }

  if (errors.length > 0) {
    console.error(`NocoDB: ${errors.length}/5 tables failed:`, errors);
  }
  if (errors.length === fetchers.length) {
    throw new Error('All NocoDB tables failed to fetch');
  }

  const [applications, attendees, products, payments, paymentProducts] = results;

  const productsMap = new Map<number, LinkedProduct[]>();
  
  // Group payment products by payment_id first (need this for payment status)
  const paymentProductsByPayment = paymentProducts.reduce((acc, pp) => {
    if (!acc[pp.payment_id]) {
      acc[pp.payment_id] = [];
    }
    acc[pp.payment_id].push(pp);
    return acc;
  }, {} as Record<number, PaymentProduct[]>);

  // Normalize installment fields (NocoDB may return null/undefined for new columns)
  const paymentsWithProducts: PaymentWithProducts[] = payments.map(payment => ({
    ...payment,
    is_installment_plan: payment.is_installment_plan ?? false,
    installments_paid: payment.installments_paid ?? 0,
    installments_total: payment.installments_total ?? null,
    paymentProducts: paymentProductsByPayment[payment.id] || [],
  }));

  // Build per-attendee product maps and installment info from payment data
  const soldByAttendee = new Map<number, AttendeeProductWithStatus[]>();
  const inCartByAttendee = new Map<number, AttendeeProductWithStatus[]>();
  const installmentByAttendee = new Map<number, AttendeeInstallmentInfo>();

  for (const payment of paymentsWithProducts) {
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

      if (payment.is_installment_plan && !installmentByAttendee.has(pp.attendee_id)) {
        installmentByAttendee.set(pp.attendee_id, {
          paymentId: payment.id,
          totalAmount: payment.amount,
          installmentsPaid: payment.installments_paid,
          installmentsTotal: payment.installments_total,
        });
      }
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
      installmentPlan: installmentByAttendee.get(attendee.id) ?? null,
    };
  });

  // Calculate metrics
  const totalApplications = applications.length;
  const acceptedApplications = applications.filter(a => a.status === 'accepted').length;

  // === REVENUE CALCULATIONS FROM PAYMENTS ===

  const approvedPayments = paymentsWithProducts.filter(p => p.status === 'approved');
  const approvedRevenue = approvedPayments.reduce((sum, p) => sum + p.amount, 0);

  // Installment plan metrics
  const approvedInstallmentPlans = approvedPayments.filter(p => p.is_installment_plan);
  const activeInstallmentPlans = approvedInstallmentPlans.filter(
    p => p.installments_total !== null && p.installments_paid < p.installments_total
  );
  const completedInstallmentPlans = approvedInstallmentPlans.filter(
    p => p.installments_total !== null && p.installments_paid >= p.installments_total
  );
  const installmentCommittedRevenue = approvedInstallmentPlans.reduce(
    (sum, p) => sum + p.amount, 0
  );

  const revenue: RevenueMetrics = {
    approvedRevenue,
    totalRevenue: approvedRevenue,
    approvedPaymentsCount: approvedPayments.length,
    installmentPlansActive: activeInstallmentPlans.length,
    installmentPlansCompleted: completedInstallmentPlans.length,
    installmentCommittedRevenue,
  };

  const attendeeIdsWithApproved = new Set(
    approvedPayments.flatMap(p => p.paymentProducts.map(pp => pp.attendee_id))
  );

  const paidAttendees = attendeeIdsWithApproved.size;

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

  return {
    metrics: {
      totalApplications,
      acceptedApplications,
      paidAttendees,
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
}

// Volunteer data fetcher

interface RawVolunteerApp {
  id: number;
  email: string;
  status: string;
  residence: string | null;
  custom_data: string | VolunteerCustomData | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

function parseCustomData(raw: string | VolunteerCustomData | null): VolunteerCustomData {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function getVolunteerData(): Promise<VolunteerDashboardData> {
  const cacheKey = 'volunteer-data';

  const cached = await getCached<VolunteerDashboardData>(cacheKey);
  if (cached) return cached;

  const stale = await getStaleCached<VolunteerDashboardData>(cacheKey);
  if (stale) {
    refreshVolunteerCache().catch(err =>
      console.error('Background volunteer refresh failed:', err)
    );
    return stale;
  }

  return refreshVolunteerCache();
}

async function refreshVolunteerCache(): Promise<VolunteerDashboardData> {
  const cacheKey = 'volunteer-data';
  const rawApps = await nocoFetchAll<RawVolunteerApp>(
    TABLES.applications,
    `where=(popup_city_id,eq,${VOLUNTEER_POPUP_CITY_ID})`
  );

  const applications: VolunteerApplication[] = rawApps.map(app => ({
    id: app.id,
    email: app.email,
    status: app.status,
    residence: app.residence,
    custom_data: parseCustomData(app.custom_data),
    created_at: app.created_at,
    updated_at: app.updated_at,
    submitted_at: app.submitted_at,
  }));

  const metrics = {
    total: applications.length,
    drafts: applications.filter(a => a.status === 'draft').length,
    inReview: applications.filter(a => a.status === 'in review').length,
    approved: applications.filter(a => a.status === 'accepted').length,
    rejected: applications.filter(a => a.status === 'rejected').length,
  };

  const data: VolunteerDashboardData = { metrics, applications };
  await setCache(cacheKey, data);
  return data;
}
