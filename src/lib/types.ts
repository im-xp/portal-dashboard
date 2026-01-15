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
  status: 'pending' | 'approved' | 'expired' | 'failed';
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

export interface AttendeeWithProducts extends Attendee {
  purchasedProducts: LinkedProduct[];  // From attendee_products (legacy/assigned)
  soldProducts: AttendeeProductWithStatus[];      // From approved payments
  inCartProducts: AttendeeProductWithStatus[];    // From pending payments
  journeyStage: JourneyStage;          // Where they are in the conversion funnel
  hasPass: boolean;                    // Has purchased a "month" category product
  hasLodging: boolean;                 // Has purchased a "lodging" category product
}

export interface ApplicationWithDetails extends Application {
  attendeesList: AttendeeWithProducts[];
}

// Dashboard aggregate types

export interface RevenueMetrics {
  approvedRevenue: number;      // Actually paid
  pendingRevenue: number;       // Checkout started but not completed
  totalRevenue: number;         // Sum of both
  approvedPaymentsCount: number;
  pendingPaymentsCount: number;
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
  pendingAttendees: number;     // Attendees with pending payments
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

