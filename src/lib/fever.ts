/**
 * Fever API client for order data sync
 *
 * API Flow:
 * 1. POST /v1/auth/token - Get bearer token
 * 2. POST /v1/reports/order-items/search - Start search, get search_id
 * 3. GET /v1/reports/order-items/search/{search_id} - Poll until partition_info appears
 * 4. GET /v1/reports/order-items/search/{search_id}?page={n} - Fetch each partition
 */

const FEVER_HOST = process.env.FEVER_HOST || 'data-reporting-api.prod.feverup.com';
const FEVER_USERNAME = process.env.FEVER_USERNAME || '';
const FEVER_PASSWORD = process.env.FEVER_PASSWORD || '';
const FEVER_PLAN_IDS = process.env.FEVER_PLAN_IDS || '';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;

export interface FeverOrder {
  feverOrderId: string;
  parentOrderId: string | null;
  orderCreatedAt: Date | null;
  orderUpdatedAt: Date | null;
  surcharge: number | null;
  currency: string | null;
  purchaseChannel: string | null;
  paymentMethod: string | null;
  billingZipCode: string | null;
  assignedSeats: string | null;
  buyerId: string | null;
  buyerEmail: string | null;
  buyerFirstName: string | null;
  buyerLastName: string | null;
  buyerDob: string | null;
  buyerLanguage: string | null;
  buyerMarketingPref: boolean | null;
  purchaseCity: string | null;
  purchaseCountry: string | null;
  purchaseRegion: string | null;
  purchasePostal: string | null;
  purchaseQuality: string | null;
  partnerId: string | null;
  partnerName: string | null;
  planId: string | null;
  planName: string | null;
  couponName: string | null;
  couponCode: string | null;
  businessId: string | null;
  businessName: string | null;
  bookingQuestions: Record<string, unknown> | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmMedium: string | null;
  utmSource: string | null;
  utmTerm: string | null;
  utmReferringDomain: string | null;
}

export interface FeverOrderItem {
  feverOrderId: string;
  feverItemId: string;
  status: string | null;
  createdAt: Date | null;
  modifiedAt: Date | null;
  purchaseDate: Date | null;
  cancellationDate: Date | null;
  cancellationType: string | null;
  discount: number | null;
  surcharge: number | null;
  unitaryPrice: number | null;
  isInvite: boolean | null;
  ratingValue: number | null;
  ratingComment: string | null;
  ownerId: string | null;
  ownerEmail: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerDob: string | null;
  ownerLanguage: string | null;
  ownerMarketingPref: boolean | null;
  planCodeId: string | null;
  planCodeBarcode: string | null;
  planCodeCreated: Date | null;
  planCodeModified: Date | null;
  planCodeRedeemed: Date | null;
  planCodeIsCancelled: boolean | null;
  planCodeIsValidated: boolean | null;
  validatedDate: Date | null;
  sessionId: string | null;
  sessionName: string | null;
  sessionStart: Date | null;
  sessionEnd: Date | null;
  sessionFirstPurchasable: Date | null;
  sessionIsAddon: boolean | null;
  sessionIsShopProduct: boolean | null;
  sessionIsWaitList: boolean | null;
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  venueTimezone: string | null;
}

export interface FeverSyncResult {
  orders: FeverOrder[];
  items: FeverOrderItem[];
  totalOrders: number;
  totalItems: number;
}

interface FeverApiOrder {
  id: string;
  parent_order_id?: string;
  created_date_utc?: string;
  updated_date_utc?: string;
  surcharge?: number;
  currency?: string;
  purchase_channel?: string;
  payment_method?: string;
  billing_zip_code?: string;
  assigned_seats?: string;
  buyer?: {
    id?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    date_of_birthday?: string;
    language?: string;
    marketing_preference?: boolean;
  };
  purchase_location_source?: {
    city_name?: string;
    country_code?: string;
    region_code?: string;
    postal_code?: string;
    quality?: string;
  };
  partner?: { id?: string; name?: string };
  plan?: { id?: string; name?: string };
  coupon?: { name?: string; code?: string };
  business?: { id?: string; name?: string };
  booking_questions?: Record<string, unknown>;
  utm?: {
    campaign?: string;
    content?: string;
    medium?: string;
    source?: string;
    term?: string;
    referring_domain?: string;
  };
  order_items?: FeverApiItem[];
}

interface FeverApiItem {
  id?: string;
  status?: string;
  created_date_utc?: string;
  modified_date_utc?: string;
  purchase_date_utc?: string;
  cancellation_date_utc?: string;
  cancellation_type?: string;
  validated_date_utc?: string;
  discount?: number;
  surcharge?: number;
  unitary_price?: number;
  is_invite?: boolean;
  rating_value?: number;
  rating_comment?: string;
  owner?: {
    id?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    date_of_birthday?: string;
    language?: string;
    marketing_preference?: boolean;
  };
  plan_code?: {
    id?: string;
    cd_barcode?: string;
    created_date_utc?: string;
    modified_date_utc?: string;
    redeemed_date_utc?: string;
    is_cancelled?: boolean;
    is_validated?: boolean;
  };
  session?: {
    id?: string;
    name?: string;
    start_date_utc?: string;
    end_date_utc?: string;
    first_purchasable_date_utc?: string;
    is_addon?: boolean;
    is_shop_product?: boolean;
    is_wait_list?: boolean;
    venue?: {
      name?: string;
      city?: string;
      country?: string;
      timezone?: string;
    };
  };
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function parseDateOnly(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function parseNumber(value: number | string | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(num) ? null : num;
}

function parseBoolean(value: boolean | string | undefined | null): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}

function parseString(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function transformOrder(apiOrder: FeverApiOrder): FeverOrder {
  return {
    feverOrderId: apiOrder.id,
    parentOrderId: parseString(apiOrder.parent_order_id),
    orderCreatedAt: parseDate(apiOrder.created_date_utc),
    orderUpdatedAt: parseDate(apiOrder.updated_date_utc),
    surcharge: parseNumber(apiOrder.surcharge),
    currency: parseString(apiOrder.currency),
    purchaseChannel: parseString(apiOrder.purchase_channel),
    paymentMethod: parseString(apiOrder.payment_method),
    billingZipCode: parseString(apiOrder.billing_zip_code),
    assignedSeats: parseString(apiOrder.assigned_seats),
    buyerId: parseString(apiOrder.buyer?.id),
    buyerEmail: parseString(apiOrder.buyer?.email),
    buyerFirstName: parseString(apiOrder.buyer?.first_name),
    buyerLastName: parseString(apiOrder.buyer?.last_name),
    buyerDob: parseDateOnly(apiOrder.buyer?.date_of_birthday),
    buyerLanguage: parseString(apiOrder.buyer?.language),
    buyerMarketingPref: parseBoolean(apiOrder.buyer?.marketing_preference),
    purchaseCity: parseString(apiOrder.purchase_location_source?.city_name),
    purchaseCountry: parseString(apiOrder.purchase_location_source?.country_code),
    purchaseRegion: parseString(apiOrder.purchase_location_source?.region_code),
    purchasePostal: parseString(apiOrder.purchase_location_source?.postal_code),
    purchaseQuality: parseString(apiOrder.purchase_location_source?.quality),
    partnerId: parseString(apiOrder.partner?.id),
    partnerName: parseString(apiOrder.partner?.name),
    planId: parseString(apiOrder.plan?.id),
    planName: parseString(apiOrder.plan?.name),
    couponName: parseString(apiOrder.coupon?.name),
    couponCode: parseString(apiOrder.coupon?.code),
    businessId: parseString(apiOrder.business?.id),
    businessName: parseString(apiOrder.business?.name),
    bookingQuestions: apiOrder.booking_questions || null,
    utmCampaign: parseString(apiOrder.utm?.campaign),
    utmContent: parseString(apiOrder.utm?.content),
    utmMedium: parseString(apiOrder.utm?.medium),
    utmSource: parseString(apiOrder.utm?.source),
    utmTerm: parseString(apiOrder.utm?.term),
    utmReferringDomain: parseString(apiOrder.utm?.referring_domain),
  };
}

function transformItem(apiItem: FeverApiItem, orderId: string): FeverOrderItem {
  return {
    feverOrderId: orderId,
    feverItemId: apiItem.id || '',
    status: parseString(apiItem.status),
    createdAt: parseDate(apiItem.created_date_utc),
    modifiedAt: parseDate(apiItem.modified_date_utc),
    purchaseDate: parseDate(apiItem.purchase_date_utc),
    cancellationDate: parseDate(apiItem.cancellation_date_utc),
    cancellationType: parseString(apiItem.cancellation_type),
    discount: parseNumber(apiItem.discount),
    surcharge: parseNumber(apiItem.surcharge),
    unitaryPrice: parseNumber(apiItem.unitary_price),
    isInvite: parseBoolean(apiItem.is_invite),
    ratingValue: parseNumber(apiItem.rating_value),
    ratingComment: parseString(apiItem.rating_comment),
    ownerId: parseString(apiItem.owner?.id),
    ownerEmail: parseString(apiItem.owner?.email),
    ownerFirstName: parseString(apiItem.owner?.first_name),
    ownerLastName: parseString(apiItem.owner?.last_name),
    ownerDob: parseDateOnly(apiItem.owner?.date_of_birthday),
    ownerLanguage: parseString(apiItem.owner?.language),
    ownerMarketingPref: parseBoolean(apiItem.owner?.marketing_preference),
    planCodeId: parseString(apiItem.plan_code?.id),
    planCodeBarcode: parseString(apiItem.plan_code?.cd_barcode),
    planCodeCreated: parseDate(apiItem.plan_code?.created_date_utc),
    planCodeModified: parseDate(apiItem.plan_code?.modified_date_utc),
    planCodeRedeemed: parseDate(apiItem.plan_code?.redeemed_date_utc),
    planCodeIsCancelled: parseBoolean(apiItem.plan_code?.is_cancelled),
    planCodeIsValidated: parseBoolean(apiItem.plan_code?.is_validated),
    validatedDate: parseDate(apiItem.validated_date_utc),
    sessionId: parseString(apiItem.session?.id),
    sessionName: parseString(apiItem.session?.name),
    sessionStart: parseDate(apiItem.session?.start_date_utc),
    sessionEnd: parseDate(apiItem.session?.end_date_utc),
    sessionFirstPurchasable: parseDate(apiItem.session?.first_purchasable_date_utc),
    sessionIsAddon: parseBoolean(apiItem.session?.is_addon),
    sessionIsShopProduct: parseBoolean(apiItem.session?.is_shop_product),
    sessionIsWaitList: parseBoolean(apiItem.session?.is_wait_list),
    venueName: parseString(apiItem.session?.venue?.name),
    venueCity: parseString(apiItem.session?.venue?.city),
    venueCountry: parseString(apiItem.session?.venue?.country),
    venueTimezone: parseString(apiItem.session?.venue?.timezone),
  };
}

async function getAuthToken(): Promise<string> {
  if (!FEVER_USERNAME || !FEVER_PASSWORD) {
    throw new Error('FEVER_USERNAME and FEVER_PASSWORD env vars required');
  }

  const response = await fetch(`https://${FEVER_HOST}/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: FEVER_USERNAME,
      password: FEVER_PASSWORD,
    }),
  });

  if (!response.ok) {
    throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('No access_token in auth response');
  }

  return data.access_token;
}

async function startSearch(
  token: string,
  options?: { dateFrom?: string; dateTo?: string }
): Promise<string> {
  const planIds = FEVER_PLAN_IDS.split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));

  if (planIds.length === 0) {
    throw new Error('FEVER_PLAN_IDS env var required (comma-separated plan IDs)');
  }

  const body: Record<string, unknown> = { plan_ids: planIds };

  if (options?.dateFrom) {
    body.date_field = 'CREATED_DATE_UTC';
    body.date_from = options.dateFrom;
  }
  if (options?.dateTo) {
    body.date_to = options.dateTo;
  }

  const response = await fetch(`https://${FEVER_HOST}/v1/reports/order-items/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Search init failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.search_id) {
    throw new Error('No search_id in response');
  }

  return data.search_id;
}

async function pollForResults(token: string, searchId: string): Promise<number[]> {
  const pollUrl = `https://${FEVER_HOST}/v1/reports/order-items/search/${searchId}`;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Poll failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.partition_info) {
      const partitions: number[] = [];
      for (const p of data.partition_info) {
        const partNum =
          typeof p === 'number'
            ? p
            : p.partition_num ?? p.partition ?? p.page ?? p.number ?? 0;
        partitions.push(parseInt(String(partNum), 10));
      }
      return [...new Set(partitions.filter((n) => n >= 0))].sort((a, b) => a - b);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timeout waiting for results after ${MAX_POLL_ATTEMPTS} attempts`);
}

async function fetchPartition(
  token: string,
  searchId: string,
  page: number
): Promise<FeverApiOrder[]> {
  const url = `https://${FEVER_HOST}/v1/reports/order-items/search/${searchId}?page=${page}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Partition fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || [];
}

export async function fetchFeverOrders(options?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<FeverSyncResult> {
  console.log('[Fever] Starting order fetch...');

  const token = await getAuthToken();
  console.log('[Fever] Authenticated');

  const searchId = await startSearch(token, options);
  console.log(`[Fever] Search started: ${searchId}`);

  const partitions = await pollForResults(token, searchId);
  console.log(`[Fever] Found ${partitions.length} partitions`);

  const allApiOrders: FeverApiOrder[] = [];
  for (const page of partitions) {
    const pageOrders = await fetchPartition(token, searchId, page);
    allApiOrders.push(...pageOrders);
  }
  console.log(`[Fever] Fetched ${allApiOrders.length} orders from API`);

  const orders: FeverOrder[] = [];
  const items: FeverOrderItem[] = [];

  for (const apiOrder of allApiOrders) {
    orders.push(transformOrder(apiOrder));

    const orderItems = apiOrder.order_items || [];
    for (const apiItem of orderItems) {
      items.push(transformItem(apiItem, apiOrder.id));
    }
  }

  console.log(`[Fever] Transformed: ${orders.length} orders, ${items.length} items`);

  return {
    orders,
    items,
    totalOrders: orders.length,
    totalItems: items.length,
  };
}

export function orderToDbRow(order: FeverOrder): Record<string, unknown> {
  return {
    fever_order_id: order.feverOrderId,
    parent_order_id: order.parentOrderId,
    order_created_at: order.orderCreatedAt?.toISOString() ?? null,
    order_updated_at: order.orderUpdatedAt?.toISOString() ?? null,
    surcharge: order.surcharge,
    currency: order.currency,
    purchase_channel: order.purchaseChannel,
    payment_method: order.paymentMethod,
    billing_zip_code: order.billingZipCode,
    assigned_seats: order.assignedSeats,
    buyer_id: order.buyerId,
    buyer_email: order.buyerEmail,
    buyer_first_name: order.buyerFirstName,
    buyer_last_name: order.buyerLastName,
    buyer_dob: order.buyerDob,
    buyer_language: order.buyerLanguage,
    buyer_marketing_pref: order.buyerMarketingPref,
    purchase_city: order.purchaseCity,
    purchase_country: order.purchaseCountry,
    purchase_region: order.purchaseRegion,
    purchase_postal: order.purchasePostal,
    purchase_quality: order.purchaseQuality,
    partner_id: order.partnerId,
    partner_name: order.partnerName,
    plan_id: order.planId,
    plan_name: order.planName,
    coupon_name: order.couponName,
    coupon_code: order.couponCode,
    business_id: order.businessId,
    business_name: order.businessName,
    booking_questions: order.bookingQuestions,
    utm_campaign: order.utmCampaign,
    utm_content: order.utmContent,
    utm_medium: order.utmMedium,
    utm_source: order.utmSource,
    utm_term: order.utmTerm,
    utm_referring_domain: order.utmReferringDomain,
    synced_at: new Date().toISOString(),
  };
}

export function itemToDbRow(item: FeverOrderItem): Record<string, unknown> {
  return {
    fever_order_id: item.feverOrderId,
    fever_item_id: item.feverItemId,
    status: item.status,
    created_at: item.createdAt?.toISOString() ?? null,
    modified_at: item.modifiedAt?.toISOString() ?? null,
    purchase_date: item.purchaseDate?.toISOString() ?? null,
    cancellation_date: item.cancellationDate?.toISOString() ?? null,
    cancellation_type: item.cancellationType,
    discount: item.discount,
    surcharge: item.surcharge,
    unitary_price: item.unitaryPrice,
    is_invite: item.isInvite,
    rating_value: item.ratingValue,
    rating_comment: item.ratingComment,
    owner_id: item.ownerId,
    owner_email: item.ownerEmail,
    owner_first_name: item.ownerFirstName,
    owner_last_name: item.ownerLastName,
    owner_dob: item.ownerDob,
    owner_language: item.ownerLanguage,
    owner_marketing_pref: item.ownerMarketingPref,
    plan_code_id: item.planCodeId,
    plan_code_barcode: item.planCodeBarcode,
    plan_code_created: item.planCodeCreated?.toISOString() ?? null,
    plan_code_modified: item.planCodeModified?.toISOString() ?? null,
    plan_code_redeemed: item.planCodeRedeemed?.toISOString() ?? null,
    plan_code_is_cancelled: item.planCodeIsCancelled,
    plan_code_is_validated: item.planCodeIsValidated,
    validated_date: item.validatedDate?.toISOString() ?? null,
    session_id: item.sessionId,
    session_name: item.sessionName,
    session_start: item.sessionStart?.toISOString() ?? null,
    session_end: item.sessionEnd?.toISOString() ?? null,
    session_first_purchasable: item.sessionFirstPurchasable?.toISOString() ?? null,
    session_is_addon: item.sessionIsAddon,
    session_is_shop_product: item.sessionIsShopProduct,
    session_is_wait_list: item.sessionIsWaitList,
    venue_name: item.venueName,
    venue_city: item.venueCity,
    venue_country: item.venueCountry,
    venue_timezone: item.venueTimezone,
  };
}
