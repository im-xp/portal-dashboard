// NocoDB Response Types

export interface NocoDBResponse<T> {
  list: T[];
  pageInfo: {
    totalRows: number;
    page: number;
    pageSize: number;
    isFirstPage: boolean;
    isLastPage: boolean;
  };
}

// Entity Types

export interface Application {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  telegram: string | null;
  organization: string | null;
  role: string | null;
  gender: string | null;
  age: string | null;
  residence: string | null;
  status: 'draft' | 'in review' | 'accepted' | 'rejected' | 'withdrawn';
  submitted_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  citizen_id: number;
  popup_city_id: number;
  scholarship_request: boolean;
  discount_assigned: number | null;
  popups?: {
    id: number;
    name: string;
  };
  humans?: {
    id: number;
    primary_email: string;
  };
  attendees?: number; // Count
  payments?: number; // Count
}

export interface Attendee {
  id: number;
  application_id: number;
  name: string;
  email: string;
  category: 'main' | 'spouse' | 'kid' | 'baby' | 'teen';
  gender: string | null;
  check_in_code: string | null;
  poap_url: string | null;
  created_at: string;
  updated_at: string;
  applications?: {
    id: number;
    first_name: string;
  };
  products?: number; // Count of linked products
  attendee_products?: number;
}

export interface Product {
  id: number;
  name: string;
  slug: string | null;
  price: number;
  compare_price: number | null;
  description: string | null;
  category: string | null;
  attendee_category: string | null;
  is_active: boolean;
  popup_city_id: number;
  start_date: string | null;
  end_date: string | null;
  max_inventory: number | null;  // NULL = unlimited
  current_sold: number;          // Default 0
}

export interface LinkedProduct {
  id: number;
  name: string;
}

export interface Payment {
  id: number;
  application_id: number;
  external_id: string | null;
  status: 'pending' | 'approved' | 'expired' | 'failed' | 'cancelled';
  amount: number;
  currency: string;
  rate: number | null;
  source: string | null;
  checkout_url: string | null;
  coupon_code_id: number | null;
  coupon_code: string | null;
  discount_value: number;
  group_id: number | null;
  edit_passes: boolean;
  is_installment_plan: boolean;
  installments_total: number | null;
  installments_paid: number;
  created_at: string;
  updated_at: string;
  applications?: {
    id: number;
    first_name: string;
  };
}

export interface PaymentProduct {
  payment_id: number;
  product_id: number;
  attendee_id: number;
  quantity: number;
  product_name: string;
  product_description: string;
  product_price: number;
  product_category: string;
  created_at: string;
  payments?: {
    id: number;
    application_id: number;
  };
  attendees?: {
    id: number;
    application_id: number;
  };
  products?: {
    id: number;
    name: string;
  };
}

export interface PaymentWithProducts extends Payment {
  paymentProducts: PaymentProduct[];
}

// Product with payment status (for per-attendee display)
export interface AttendeeProductWithStatus {
  id: number;
  name: string;
  price: number;
  quantity: number;
  category: string;
  status: 'sold' | 'in_cart' | 'assigned';  // assigned = manual/test, no payment record
}

// Journey stages for the conversion funnel
export type JourneyStage = 
  | 'accepted'    // Application approved, no payment activity
  | 'in_cart'     // Has items in pending checkout
  | 'partial'     // Paid for pass OR lodging, but not both
  | 'confirmed';  // Has both pass AND lodging = actual attendee!

// Extended types with joined data

export interface AttendeeInstallmentInfo {
  paymentId: number;
  totalAmount: number;
  installmentsPaid: number;
  installmentsTotal: number | null;
}

export interface AttendeeWithProducts extends Attendee {
  purchasedProducts: LinkedProduct[];
  soldProducts: AttendeeProductWithStatus[];
  inCartProducts: AttendeeProductWithStatus[];
  journeyStage: JourneyStage;
  hasPass: boolean;
  hasLodging: boolean;
  installmentPlan: AttendeeInstallmentInfo | null;
}

export interface ApplicationWithDetails extends Application {
  attendeesList: AttendeeWithProducts[];
}

// Dashboard aggregate types

export interface RevenueMetrics {
  approvedRevenue: number;
  totalRevenue: number;
  approvedPaymentsCount: number;
  installmentPlansActive: number;
  installmentPlansCompleted: number;
  installmentCommittedRevenue: number;
}

export interface ProductSaleRecord {
  product: Product;
  quantity: number;
  revenue: number;              // At current price (from attendee_products)
  actualRevenue: number;        // At purchase price (from payment_products)
  hasPendingPayments: boolean;
  hasApprovedPayments: boolean;
}

export interface DashboardMetrics {
  totalApplications: number;
  acceptedApplications: number;
  paidAttendees: number;        // Attendees with approved payments
  revenue: RevenueMetrics;
  applicationsByStatus: Record<string, number>;
  productSales: ProductSaleRecord[];
  paymentsWithDiscounts: PaymentWithProducts[];  // Payments that used discount codes
}

// Return type for getDashboardData
export interface DashboardData {
  metrics: DashboardMetrics;
  applications: ApplicationWithDetails[];
  attendees: AttendeeWithProducts[];
  products: Product[];
  payments: PaymentWithProducts[];
}

// Popup Cities
export interface PopupCity {
  id: number;
  name: string;
  slug: string;
  location?: string;
}

// Fever Data Types (from Supabase cache)
export interface FeverOrder {
  fever_order_id: string;
  order_created_at: string | null;
  buyer_email: string | null;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  plan_id: string | null;
  plan_name: string | null;
  currency: string | null;
  synced_at: string;
}

export interface FeverOrderItem {
  fever_order_id: string;
  fever_item_id: string;
  status: string | null;
  unitary_price: number | null;
  session_name: string | null;
  session_start: string | null;
  venue_name: string | null;
}

export interface FeverRevenueBreakdown {
  ticketsAndAddonsRevenue: number;
  surcharge: number;
  totalGrossRevenue: number;
  discount: number;
  userPayment: number;
}

export interface FeverMetrics {
  totalRevenue: number;  // User Payment (main display value)
  orderCount: number;
  ticketCount: number;
  revenueByPlan: Record<string, { revenue: number; count: number; planName: string }>;
  breakdown: FeverRevenueBreakdown;
}

export interface FeverSyncState {
  lastSyncAt: string | null;
  lastOrderCreatedAt: string | null;
  orderCount: number;
  itemCount: number;
}

export interface FeverOrderItem {
  fever_order_id: string;
  fever_item_id: string;
  status: string | null;
  created_at: string | null;
  modified_at: string | null;
  purchase_date: string | null;
  cancellation_date: string | null;
  cancellation_type: string | null;
  validated_date: string | null;
  discount: number | null;
  surcharge: number | null;
  unitary_price: number | null;
  is_invite: boolean | null;
  rating_value: number | null;
  rating_comment: string | null;
  owner_id: string | null;
  owner_email: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  owner_dob: string | null;
  owner_language: string | null;
  owner_marketing_pref: boolean | null;
  plan_code_id: string | null;
  plan_code_barcode: string | null;
  plan_code_created: string | null;
  plan_code_modified: string | null;
  plan_code_redeemed: string | null;
  plan_code_is_cancelled: boolean | null;
  plan_code_is_validated: boolean | null;
  session_id: string | null;
  session_name: string | null;
  session_start: string | null;
  session_end: string | null;
  session_first_purchasable: string | null;
  session_is_addon: boolean | null;
  session_is_shop_product: boolean | null;
  session_is_wait_list: boolean | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_country: string | null;
  venue_timezone: string | null;
}

export interface BookingQuestion {
  id: string;
  question: string;
  answers: string[];
  index: number;
}

export interface FeverOrderWithItems {
  fever_order_id: string;
  parent_order_id: string | null;
  order_created_at: string | null;
  order_updated_at: string | null;
  surcharge: number | null;
  currency: string | null;
  purchase_channel: string | null;
  payment_method: string | null;
  billing_zip_code: string | null;
  assigned_seats: string | null;
  buyer_id: string | null;
  buyer_email: string | null;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_dob: string | null;
  buyer_language: string | null;
  buyer_marketing_pref: boolean | null;
  purchase_city: string | null;
  purchase_country: string | null;
  purchase_region: string | null;
  purchase_postal: string | null;
  purchase_quality: string | null;
  partner_id: string | null;
  partner_name: string | null;
  plan_id: string | null;
  plan_name: string | null;
  coupon_name: string | null;
  coupon_code: string | null;
  business_id: string | null;
  business_name: string | null;
  booking_questions: BookingQuestion[] | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_medium: string | null;
  utm_source: string | null;
  utm_term: string | null;
  utm_referring_domain: string | null;
  synced_at: string | null;
  items: FeverOrderItem[];
  item_count: number;
  total_value: number;
}

export interface FeverOrdersResponse {
  orders: FeverOrderWithItems[];
  total: number;
  plans: string[];
}

