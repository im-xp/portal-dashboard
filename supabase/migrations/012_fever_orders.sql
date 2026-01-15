-- Fever order import tables (materialized cache from Fever API)

-- Order-level data (one row per order)
CREATE TABLE fever_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fever_order_id TEXT UNIQUE NOT NULL,
  parent_order_id TEXT,

  -- Timestamps
  order_created_at TIMESTAMPTZ,
  order_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),

  -- Order details
  surcharge NUMERIC,
  currency TEXT,
  purchase_channel TEXT,
  payment_method TEXT,
  billing_zip_code TEXT,
  assigned_seats TEXT,

  -- Buyer (denormalized - one buyer per order)
  buyer_id TEXT,
  buyer_email TEXT,
  buyer_first_name TEXT,
  buyer_last_name TEXT,
  buyer_dob DATE,
  buyer_language TEXT,
  buyer_marketing_pref BOOLEAN,

  -- Purchase location
  purchase_city TEXT,
  purchase_country TEXT,
  purchase_region TEXT,
  purchase_postal TEXT,
  purchase_quality TEXT,

  -- References (denormalized for query convenience)
  partner_id TEXT,
  partner_name TEXT,
  plan_id TEXT,
  plan_name TEXT,
  coupon_name TEXT,
  coupon_code TEXT,
  business_id TEXT,
  business_name TEXT,

  -- Flexible storage
  booking_questions JSONB
);

CREATE INDEX idx_fever_orders_created ON fever_orders(order_created_at DESC);
CREATE INDEX idx_fever_orders_plan ON fever_orders(plan_id);
CREATE INDEX idx_fever_orders_buyer_email ON fever_orders(buyer_email);

-- Item-level data (one row per ticket/item)
CREATE TABLE fever_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fever_order_id TEXT NOT NULL REFERENCES fever_orders(fever_order_id) ON DELETE CASCADE,
  fever_item_id TEXT NOT NULL,

  -- Item details
  status TEXT,
  created_at TIMESTAMPTZ,
  modified_at TIMESTAMPTZ,
  purchase_date TIMESTAMPTZ,
  cancellation_date TIMESTAMPTZ,
  cancellation_type TEXT,

  -- Pricing
  discount NUMERIC,
  surcharge NUMERIC,
  unitary_price NUMERIC,
  is_invite BOOLEAN,

  -- Rating
  rating_value NUMERIC,
  rating_comment TEXT,

  -- Owner (person using this ticket, may differ from buyer)
  owner_id TEXT,
  owner_email TEXT,
  owner_first_name TEXT,
  owner_last_name TEXT,
  owner_dob DATE,
  owner_language TEXT,
  owner_marketing_pref BOOLEAN,

  -- Plan code (the actual ticket/barcode)
  plan_code_id TEXT,
  plan_code_barcode TEXT,
  plan_code_created TIMESTAMPTZ,
  plan_code_modified TIMESTAMPTZ,
  plan_code_redeemed TIMESTAMPTZ,
  plan_code_is_cancelled BOOLEAN,
  plan_code_is_validated BOOLEAN,

  -- Session (the event timeslot)
  session_id TEXT,
  session_name TEXT,
  session_start TIMESTAMPTZ,
  session_end TIMESTAMPTZ,
  session_first_purchasable TIMESTAMPTZ,
  session_is_addon BOOLEAN,
  session_is_shop_product BOOLEAN,
  session_is_wait_list BOOLEAN,

  -- Venue
  venue_name TEXT,
  venue_city TEXT,
  venue_country TEXT,
  venue_timezone TEXT,

  UNIQUE(fever_order_id, fever_item_id)
);

CREATE INDEX idx_fever_items_order ON fever_order_items(fever_order_id);
CREATE INDEX idx_fever_items_session ON fever_order_items(session_id);
CREATE INDEX idx_fever_items_status ON fever_order_items(status);

-- Sync state tracking (singleton)
CREATE TABLE fever_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_sync_at TIMESTAMPTZ,
  last_order_created_at TIMESTAMPTZ,
  orders_synced INTEGER DEFAULT 0,
  items_synced INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Initialize sync state
INSERT INTO fever_sync_state (id) VALUES (1);

-- Flat view for spreadsheet-style exports
CREATE VIEW fever_sales_flat AS
SELECT
  o.fever_order_id,
  o.parent_order_id,
  o.order_created_at,
  o.order_updated_at,
  o.surcharge AS order_surcharge,
  o.currency,
  o.purchase_channel,
  o.payment_method,
  o.billing_zip_code,
  o.assigned_seats,
  o.buyer_id,
  o.buyer_email,
  o.buyer_first_name,
  o.buyer_last_name,
  o.buyer_dob,
  o.buyer_language,
  o.buyer_marketing_pref,
  o.purchase_city,
  o.purchase_country,
  o.purchase_region,
  o.purchase_postal,
  o.purchase_quality,
  o.partner_id,
  o.partner_name,
  o.plan_id,
  o.plan_name,
  o.coupon_name,
  o.coupon_code,
  o.business_id,
  o.business_name,
  o.booking_questions,
  i.fever_item_id,
  i.status AS item_status,
  i.created_at AS item_created_at,
  i.modified_at AS item_modified_at,
  i.purchase_date AS item_purchase_date,
  i.cancellation_date,
  i.cancellation_type,
  i.discount,
  i.surcharge AS item_surcharge,
  i.unitary_price,
  i.is_invite,
  i.rating_value,
  i.rating_comment,
  i.owner_id,
  i.owner_email,
  i.owner_first_name,
  i.owner_last_name,
  i.owner_dob,
  i.owner_language,
  i.owner_marketing_pref,
  i.plan_code_id,
  i.plan_code_barcode,
  i.plan_code_created,
  i.plan_code_modified,
  i.plan_code_redeemed,
  i.plan_code_is_cancelled,
  i.plan_code_is_validated,
  i.session_id,
  i.session_name,
  i.session_start,
  i.session_end,
  i.session_first_purchasable,
  i.session_is_addon,
  i.session_is_shop_product,
  i.session_is_wait_list,
  i.venue_name,
  i.venue_city,
  i.venue_country,
  i.venue_timezone
FROM fever_orders o
JOIN fever_order_items i ON o.fever_order_id = i.fever_order_id;
