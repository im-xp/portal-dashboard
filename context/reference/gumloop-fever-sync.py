"""
Gumloop Fever Order Sync - Reference Implementation

This is the original Gumloop code for fetching orders from the Fever API.
Kept for reference while implementing the TypeScript version in src/lib/fever.ts

API Flow:
1. POST /v1/auth/token - Get bearer token
2. POST /v1/reports/order-items/search - Start search, get search_id
3. GET /v1/reports/order-items/search/{search_id} - Poll until partition_info appears
4. GET /v1/reports/order-items/search/{search_id}?page={n} - Fetch each partition

Data Structure:
- Orders contain order_items (1:many)
- Each item has: owner, plan_code, session (with venue)
- Order has: buyer, purchase_location_source, partner, plan, coupon, business
"""

def main(params: dict):
    import requests, time, sys, logging, json as _json

    # --- consume declared params so Gumloop won't warn about unused inputs ---
    _ = (
        params.get("Host"),
        params.get("Fever Username"),
        params.get("Fever Password"),
        params.get("Plan IDs"),
        params.get("Date Field"),
        params.get("Date From"),
        params.get("Date To"),
    )

    # --- hard-coded config ---
    HOST = "data-reporting-api.prod.feverup.com"
    USERNAME = "shapiro.jon@gmail.com"
    PASSWORD = "obwug73b98qb9qb38b!#DJWN"
    BEARER = ""  # leave empty to login with username/password
    PLAN_IDS = "420002,474974,416569,480359,474902,433336"
    DATE_FIELD = ""  # e.g., "CREATED_DATE_UTC"
    DATE_FROM = ""   # e.g., "2024-01-01"
    DATE_TO = ""     # e.g., "2025-10-09"

    log = logging.getLogger("gumloop")
    if not log.handlers:
        log.addHandler(logging.StreamHandler(sys.stdout))
    log.setLevel(logging.INFO)

    # --- helper: safe nested getter returning "" for missing/None/"" ---
    def _g(d, *ks):
        cur = d
        for k in ks:
            if not isinstance(cur, dict):
                return ""
            cur = cur.get(k)
        return "" if cur in (None, "") else str(cur)

    # --- declare output schema (lists per column) ---
    variable_names = [
        "order_id","parent_order_id","order_created_date_utc","order_updated_date_utc",
        "surcharge","currency","purchase_channel","payment_method","billing_zip_code",
        "assigned_seats","buyer_id","buyer_email","buyer_first_name","buyer_last_name",
        "buyer_date_of_birthday","buyer_language","buyer_marketing_preference",
        "purchase_city","purchase_country_code","purchase_region_code",
        "purchase_postal_code","purchase_quality","partner_id","partner_name",
        "plan_id","plan_name","coupon_name","coupon_code","business_id","business_name",
        "booking_questions","item_id","item_status","item_created_date_utc",
        "item_modified_date_utc","item_purchase_date_utc","item_cancellation_date_utc",
        "item_cancellation_type","item_discount","item_surcharge","item_unitary_price",
        "item_is_invite","item_rating_value","item_rating_comment","owner_id",
        "owner_email","owner_first_name","owner_last_name","owner_date_of_birthday",
        "owner_language","owner_marketing_preference","plan_code_id","plan_code_barcode",
        "plan_code_created_date_utc","plan_code_modified_date_utc",
        "plan_code_redeemed_date_utc","plan_code_is_cancelled","plan_code_is_validated",
        "session_id","session_name","session_start_date_utc","session_end_date_utc",
        "session_first_purchasable_date_utc","session_is_addon","session_is_shop_product",
        "session_is_wait_list","venue_name","venue_city","venue_country","venue_timezone"
    ]
    outputs = {k: [] for k in variable_names}

    # --- default empty unpack so return always works even on error ---
    def _unpack_and_return():
        (
            order_id, parent_order_id, order_created_date_utc, order_updated_date_utc,
            surcharge, currency, purchase_channel, payment_method, billing_zip_code,
            assigned_seats, buyer_id, buyer_email, buyer_first_name, buyer_last_name,
            buyer_date_of_birthday, buyer_language, buyer_marketing_preference,
            purchase_city, purchase_country_code, purchase_region_code,
            purchase_postal_code, purchase_quality, partner_id, partner_name,
            plan_id, plan_name, coupon_name, coupon_code, business_id, business_name,
            booking_questions, item_id, item_status, item_created_date_utc,
            item_modified_date_utc, item_purchase_date_utc, item_cancellation_date_utc,
            item_cancellation_type, item_discount, item_surcharge, item_unitary_price,
            item_is_invite, item_rating_value, item_rating_comment, owner_id,
            owner_email, owner_first_name, owner_last_name, owner_date_of_birthday,
            owner_language, owner_marketing_preference, plan_code_id, plan_code_barcode,
            plan_code_created_date_utc, plan_code_modified_date_utc,
            plan_code_redeemed_date_utc, plan_code_is_cancelled, plan_code_is_validated,
            session_id, session_name, session_start_date_utc, session_end_date_utc,
            session_first_purchasable_date_utc, session_is_addon, session_is_shop_product,
            session_is_wait_list, venue_name, venue_city, venue_country, venue_timezone
        ) = [outputs[name] for name in variable_names]
        # NOTE: Gumloop appends the giant tuple return; if you see it here, keep it.
        return order_id, parent_order_id, order_created_date_utc, order_updated_date_utc, surcharge, currency, purchase_channel, payment_method, billing_zip_code, assigned_seats, buyer_id, buyer_email, buyer_first_name, buyer_last_name, buyer_date_of_birthday, buyer_language, buyer_marketing_preference, purchase_city, purchase_country_code, purchase_region_code, purchase_postal_code, purchase_quality, partner_id, partner_name, plan_id, plan_name, coupon_name, coupon_code, business_id, business_name, booking_questions, item_id, item_status, item_created_date_utc, item_modified_date_utc, item_purchase_date_utc, item_cancellation_date_utc, item_cancellation_type, item_discount, item_surcharge, item_unitary_price, item_is_invite, item_rating_value, item_rating_comment, owner_id, owner_email, owner_first_name, owner_last_name, owner_date_of_birthday, owner_language, owner_marketing_preference, plan_code_id, plan_code_barcode, plan_code_created_date_utc, plan_code_modified_date_utc, plan_code_redeemed_date_utc, plan_code_is_cancelled, plan_code_is_validated, session_id, session_name, session_start_date_utc, session_end_date_utc, session_first_purchasable_date_utc, session_is_addon, session_is_shop_product, session_is_wait_list, venue_name, venue_city, venue_country, venue_timezone

    # --- Auth ---
    try:
        session = requests.Session()
        token = (BEARER or "").strip()
        if not token:
            log.info("Logging in for token…")
            r = session.post(
                f"https://{HOST}/v1/auth/token",
                data={"username": USERNAME, "password": PASSWORD},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30,
            )
            r.raise_for_status()
            token = r.json().get("access_token", "")
        if not token:
            log.error("Auth failed (no token)")
            return _unpack_and_return()
        session.headers.update({"Authorization": f"Bearer {token}"})
    except Exception as e:
        log.error(f"Auth error: {e}")
        return _unpack_and_return()

    # --- Start search ---
    try:
        ids = [int(x) for x in PLAN_IDS.split(",") if x.strip().isdigit()]
        if not ids:
            log.error("No valid plan IDs after parsing")
            return _unpack_and_return()

        body = {"plan_ids": ids}
        if DATE_FIELD: body["date_field"] = DATE_FIELD
        if DATE_FROM:  body["date_from"]  = DATE_FROM
        if DATE_TO:    body["date_to"]    = DATE_TO

        r = session.post(f"https://{HOST}/v1/reports/order-items/search", json=body, timeout=60)
        r.raise_for_status()
        sid = r.json().get("search_id")
        if not sid:
            log.error("No search_id in response")
            return _unpack_and_return()
        log.info(f"Search ID: {sid}")
    except Exception as e:
        log.error(f"Search init error: {e}")
        return _unpack_and_return()

    # --- Poll for completion ---
    try:
        poll_url = f"https://{HOST}/v1/reports/order-items/search/{sid}"
        parts = None
        for _ in range(60):
            j = session.get(poll_url, timeout=30).json()
            pinfo = j.get("partition_info")
            if pinfo:
                parts = []
                for p in pinfo:
                    if isinstance(p, dict):
                        parts.append(int(p.get("partition_num", p.get("partition", p.get("page", p.get("number", 0))))))
                    else:
                        parts.append(int(p))
                parts = sorted(set([p for p in parts if p >= 0])) or [0]
                break
            time.sleep(2)
        if not parts:
            log.error("Timeout waiting for results")
            return _unpack_and_return()
    except Exception as e:
        log.error(f"Polling error: {e}")
        return _unpack_and_return()

    # --- Fetch all partitions ---
    try:
        orders = []
        for p in parts:
            data = session.get(poll_url, params={"page": p}, timeout=60).json().get("data", [])
            orders += data
        log.info(f"Fetched {len(orders)} orders (pre item-expansion)")
    except Exception as e:
        log.error(f"Partition fetch error: {e}")
        return _unpack_and_return()

    # --- Explicit flatten (JQ-style mapping) into outputs ---
    try:
        for o in orders:
            items = o.get("order_items") or [{}]
            for it in items:
                # order-level
                outputs["order_id"].append(_g(o, "id"))
                outputs["parent_order_id"].append(_g(o, "parent_order_id"))
                outputs["order_created_date_utc"].append(_g(o, "created_date_utc"))
                outputs["order_updated_date_utc"].append(_g(o, "updated_date_utc"))
                outputs["surcharge"].append(_g(o, "surcharge"))
                outputs["currency"].append(_g(o, "currency"))
                outputs["purchase_channel"].append(_g(o, "purchase_channel"))
                outputs["payment_method"].append(_g(o, "payment_method"))
                outputs["billing_zip_code"].append(_g(o, "billing_zip_code"))
                outputs["assigned_seats"].append(_g(o, "assigned_seats"))

                # buyer
                outputs["buyer_id"].append(_g(o, "buyer", "id"))
                outputs["buyer_email"].append(_g(o, "buyer", "email"))
                outputs["buyer_first_name"].append(_g(o, "buyer", "first_name"))
                outputs["buyer_last_name"].append(_g(o, "buyer", "last_name"))
                outputs["buyer_date_of_birthday"].append(_g(o, "buyer", "date_of_birthday"))
                outputs["buyer_language"].append(_g(o, "buyer", "language"))
                outputs["buyer_marketing_preference"].append(_g(o, "buyer", "marketing_preference"))

                # purchase location
                outputs["purchase_city"].append(_g(o, "purchase_location_source", "city_name"))
                outputs["purchase_country_code"].append(_g(o, "purchase_location_source", "country_code"))
                outputs["purchase_region_code"].append(_g(o, "purchase_location_source", "region_code"))
                outputs["purchase_postal_code"].append(_g(o, "purchase_location_source", "postal_code"))
                outputs["purchase_quality"].append(_g(o, "purchase_location_source", "quality"))

                # partner
                outputs["partner_id"].append(_g(o, "partner", "id"))
                outputs["partner_name"].append(_g(o, "partner", "name"))

                # plan (order-level)
                outputs["plan_id"].append(_g(o, "plan", "id"))
                outputs["plan_name"].append(_g(o, "plan", "name"))

                # coupon
                outputs["coupon_name"].append(_g(o, "coupon", "name"))
                outputs["coupon_code"].append(_g(o, "coupon", "code"))

                # business
                outputs["business_id"].append(_g(o, "business", "id"))
                outputs["business_name"].append(_g(o, "business", "name"))

                # booking questions
                bq = o.get("booking_questions")
                outputs["booking_questions"].append(_json.dumps(bq) if bq not in (None, "") else "")

                # item-level
                outputs["item_id"].append(_g(it, "id"))
                outputs["item_status"].append(_g(it, "status"))
                outputs["item_created_date_utc"].append(_g(it, "created_date_utc"))
                outputs["item_modified_date_utc"].append(_g(it, "modified_date_utc"))
                outputs["item_purchase_date_utc"].append(_g(it, "purchase_date_utc"))
                outputs["item_cancellation_date_utc"].append(_g(it, "cancellation_date_utc"))
                outputs["item_cancellation_type"].append(_g(it, "cancellation_type"))
                outputs["item_discount"].append(_g(it, "discount"))
                outputs["item_surcharge"].append(_g(it, "surcharge"))
                outputs["item_unitary_price"].append(_g(it, "unitary_price"))
                outputs["item_is_invite"].append(_g(it, "is_invite"))
                outputs["item_rating_value"].append(_g(it, "rating_value"))
                outputs["item_rating_comment"].append(_g(it, "rating_comment"))

                # owner
                outputs["owner_id"].append(_g(it, "owner", "id"))
                outputs["owner_email"].append(_g(it, "owner", "email"))
                outputs["owner_first_name"].append(_g(it, "owner", "first_name"))
                outputs["owner_last_name"].append(_g(it, "owner", "last_name"))
                outputs["owner_date_of_birthday"].append(_g(it, "owner", "date_of_birthday"))
                outputs["owner_language"].append(_g(it, "owner", "language"))
                outputs["owner_marketing_preference"].append(_g(it, "owner", "marketing_preference"))

                # plan_code (item)
                outputs["plan_code_id"].append(_g(it, "plan_code", "id"))
                outputs["plan_code_barcode"].append(_g(it, "plan_code", "cd_barcode"))
                outputs["plan_code_created_date_utc"].append(_g(it, "plan_code", "created_date_utc"))
                outputs["plan_code_modified_date_utc"].append(_g(it, "plan_code", "modified_date_utc"))
                outputs["plan_code_redeemed_date_utc"].append(_g(it, "plan_code", "redeemed_date_utc"))
                outputs["plan_code_is_cancelled"].append(_g(it, "plan_code", "is_cancelled"))
                outputs["plan_code_is_validated"].append(_g(it, "plan_code", "is_validated"))

                # session
                outputs["session_id"].append(_g(it, "session", "id"))
                outputs["session_name"].append(_g(it, "session", "name"))
                outputs["session_start_date_utc"].append(_g(it, "session", "start_date_utc"))
                outputs["session_end_date_utc"].append(_g(it, "session", "end_date_utc"))
                outputs["session_first_purchasable_date_utc"].append(_g(it, "session", "first_purchasable_date_utc"))
                outputs["session_is_addon"].append(_g(it, "session", "is_addon"))
                outputs["session_is_shop_product"].append(_g(it, "session", "is_shop_product"))
                outputs["session_is_wait_list"].append(_g(it, "session", "is_wait_list"))

                # venue (inside session)
                outputs["venue_name"].append(_g(it, "session", "venue", "name"))
                outputs["venue_city"].append(_g(it, "session", "venue", "city"))
                outputs["venue_country"].append(_g(it, "session", "venue", "country"))
                outputs["venue_timezone"].append(_g(it, "session", "venue", "timezone"))
    except Exception as e:
        log.error(f"Flatten error: {e}")
        # continue to unpack whatever we have

    # --- unpack into the variables your fixed return expects ---
    (
        order_id, parent_order_id, order_created_date_utc, order_updated_date_utc,
        surcharge, currency, purchase_channel, payment_method, billing_zip_code,
        assigned_seats, buyer_id, buyer_email, buyer_first_name, buyer_last_name,
        buyer_date_of_birthday, buyer_language, buyer_marketing_preference,
        purchase_city, purchase_country_code, purchase_region_code,
        purchase_postal_code, purchase_quality, partner_id, partner_name,
        plan_id, plan_name, coupon_name, coupon_code, business_id, business_name,
        booking_questions, item_id, item_status, item_created_date_utc,
        item_modified_date_utc, item_purchase_date_utc, item_cancellation_date_utc,
        item_cancellation_type, item_discount, item_surcharge, item_unitary_price,
        item_is_invite, item_rating_value, item_rating_comment, owner_id,
        owner_email, owner_first_name, owner_last_name, owner_date_of_birthday,
        owner_language, owner_marketing_preference, plan_code_id, plan_code_barcode,
        plan_code_created_date_utc, plan_code_modified_date_utc,
        plan_code_redeemed_date_utc, plan_code_is_cancelled, plan_code_is_validated,
        session_id, session_name, session_start_date_utc, session_end_date_utc,
        session_first_purchasable_date_utc, session_is_addon, session_is_shop_product,
        session_is_wait_list, venue_name, venue_city, venue_country, venue_timezone
    ) = [outputs[name] for name in variable_names]
    return order_id, parent_order_id, order_created_date_utc, order_updated_date_utc, surcharge, currency, purchase_channel, payment_method, billing_zip_code, assigned_seats, buyer_id, buyer_email, buyer_first_name, buyer_last_name, buyer_date_of_birthday, buyer_language, buyer_marketing_preference, purchase_city, purchase_country_code, purchase_region_code, purchase_postal_code, purchase_quality, partner_id, partner_name, plan_id, plan_name, coupon_name, coupon_code, business_id, business_name, booking_questions, item_id, item_status, item_created_date_utc, item_modified_date_utc, item_purchase_date_utc, item_cancellation_date_utc, item_cancellation_type, item_discount, item_surcharge, item_unitary_price, item_is_invite, item_rating_value, item_rating_comment, owner_id, owner_email, owner_first_name, owner_last_name, owner_date_of_birthday, owner_language, owner_marketing_preference, plan_code_id, plan_code_barcode, plan_code_created_date_utc, plan_code_modified_date_utc, plan_code_redeemed_date_utc, plan_code_is_cancelled, plan_code_is_validated, session_id, session_name, session_start_date_utc, session_end_date_utc, session_first_purchasable_date_utc, session_is_addon, session_is_shop_product, session_is_wait_list, venue_name, venue_city, venue_country, venue_timezone
