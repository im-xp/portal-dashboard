-- Add UTM tracking fields to fever_orders
ALTER TABLE fever_orders
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_referring_domain text;

-- Add validated_date to fever_order_items
ALTER TABLE fever_order_items
  ADD COLUMN IF NOT EXISTS validated_date timestamptz;

-- Update the flat view to include new fields
DROP VIEW IF EXISTS fever_sales_flat;
CREATE VIEW fever_sales_flat AS
SELECT
  o.fever_order_id,
  o.order_created_at,
  o.order_updated_at,
  o.buyer_email,
  o.buyer_first_name,
  o.buyer_last_name,
  o.buyer_dob,
  o.buyer_language,
  o.buyer_marketing_pref,
  o.currency,
  o.payment_method,
  o.purchase_channel,
  o.purchase_city,
  o.purchase_region,
  o.purchase_country,
  o.purchase_postal,
  o.plan_id,
  o.plan_name,
  o.partner_name,
  o.coupon_code,
  o.coupon_name,
  o.booking_questions,
  o.utm_campaign,
  o.utm_content,
  o.utm_medium,
  o.utm_source,
  o.utm_term,
  o.utm_referring_domain,
  i.fever_item_id,
  i.session_name,
  i.session_start,
  i.session_end,
  i.session_is_addon,
  i.status as item_status,
  i.unitary_price,
  i.surcharge as item_surcharge,
  i.discount,
  i.owner_email,
  i.owner_first_name,
  i.owner_last_name,
  i.plan_code_barcode,
  i.plan_code_is_validated,
  i.validated_date,
  i.venue_name,
  i.venue_city
FROM fever_orders o
JOIN fever_order_items i ON o.fever_order_id = i.fever_order_id;
