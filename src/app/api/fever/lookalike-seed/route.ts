import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  buildCsv,
  fileNameForSeedType,
  mergeBestSeedRows,
  normalizeEmail,
  toSeedRow,
  type SeedRow,
  type SeedType,
} from '@/lib/fever-lookalike-seed';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 1000;
const META_HEADERS = ['email', 'fn', 'ln', 'doby', 'dobm', 'dobd', 'ct', 'st', 'zp', 'country'];
const GENERIC_EXPORT_ERROR = 'Failed to build seed export.';

const feverSupabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  '';
const feverSupabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

interface BuyerOrderRow {
  buyer_email: string | null;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_dob: string | null;
  purchase_city: string | null;
  purchase_region: string | null;
  purchase_postal: string | null;
  billing_zip_code: string | null;
  purchase_country: string | null;
}

interface OwnerItemRow {
  owner_email: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  owner_dob: string | null;
  fever_orders:
    | {
        purchase_city: string | null;
        purchase_region: string | null;
        purchase_postal: string | null;
        billing_zip_code: string | null;
        purchase_country: string | null;
      }
    | {
        purchase_city: string | null;
        purchase_region: string | null;
        purchase_postal: string | null;
        billing_zip_code: string | null;
        purchase_country: string | null;
      }[]
    | null;
}

interface EmailOnlyRow {
  buyer_email?: string | null;
  owner_email?: string | null;
}

function createFeverReadOnlySupabaseClient() {
  if (!feverSupabaseUrl || !feverSupabaseAnonKey) {
    return null;
  }

  return createClient(feverSupabaseUrl, feverSupabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getSeedType(value: string | null): SeedType | null {
  if (value === 'buyers' || value === 'owners' || value === 'exclusion') {
    return value;
  }

  return null;
}

function getOrderGeo(row: OwnerItemRow['fever_orders']) {
  if (!row) {
    return null;
  }

  return Array.isArray(row) ? row[0] ?? null : row;
}

async function fetchAllBuyerRows(
  supabase: NonNullable<ReturnType<typeof createFeverReadOnlySupabaseClient>>,
  marketingOnly: boolean
): Promise<BuyerOrderRow[]> {
  const rows: BuyerOrderRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from('fever_orders')
      .select(
        'buyer_email,buyer_first_name,buyer_last_name,buyer_dob,purchase_city,purchase_region,purchase_postal,billing_zip_code,purchase_country'
      )
      .not('buyer_email', 'is', null)
      .order('fever_order_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (marketingOnly) {
      query = query.eq('buyer_marketing_pref', true);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const batch = (data || []) as BuyerOrderRow[];
    if (batch.length === 0) {
      break;
    }

    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return rows;
}

async function fetchAllOwnerRows(
  supabase: NonNullable<ReturnType<typeof createFeverReadOnlySupabaseClient>>,
  marketingOnly: boolean
): Promise<OwnerItemRow[]> {
  const rows: OwnerItemRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from('fever_order_items')
      .select(
        'owner_email,owner_first_name,owner_last_name,owner_dob,fever_orders!inner(purchase_city,purchase_region,purchase_postal,billing_zip_code,purchase_country)'
      )
      .not('owner_email', 'is', null)
      .order('fever_order_id', { ascending: true })
      .order('fever_item_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (marketingOnly) {
      query = query.eq('owner_marketing_pref', true);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const batch = (data || []) as OwnerItemRow[];
    if (batch.length === 0) {
      break;
    }

    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return rows;
}

async function fetchAllEmails(
  supabase: NonNullable<ReturnType<typeof createFeverReadOnlySupabaseClient>>,
  table: 'fever_orders' | 'fever_order_items',
  column: 'buyer_email' | 'owner_email'
) {
  const rows: string[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select(column)
      .not(column, 'is', null);

    query =
      table === 'fever_orders'
        ? query.order('fever_order_id', { ascending: true })
        : query.order('fever_order_id', { ascending: true }).order('fever_item_id', { ascending: true });

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const batch = (data || []) as EmailOnlyRow[];
    if (batch.length === 0) {
      break;
    }

    for (const row of batch) {
      const email = normalizeEmail(row[column]);
      if (email) {
        rows.push(email);
      }
    }

    if (batch.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return rows;
}

function rowsToCsv(rows: SeedRow[]) {
  return buildCsv(
    META_HEADERS,
    rows.map((row) => META_HEADERS.map((header) => row[header as keyof SeedRow]))
  );
}

async function buildBuyersSeed(
  supabase: NonNullable<ReturnType<typeof createFeverReadOnlySupabaseClient>>
): Promise<{ csv: string; buyerEmails: Set<string> }> {
  const buyerOrders = await fetchAllBuyerRows(supabase, true);
  const seedRows = mergeBestSeedRows(
    buyerOrders
      .map((row) =>
        toSeedRow({
          email: row.buyer_email,
          firstName: row.buyer_first_name,
          lastName: row.buyer_last_name,
          dob: row.buyer_dob,
          city: row.purchase_city,
          region: row.purchase_region,
          postal: row.purchase_postal,
          postalFallback: row.billing_zip_code,
          country: row.purchase_country,
        })
      )
      .filter((row): row is SeedRow => row !== null)
  );

  return {
    csv: rowsToCsv(seedRows),
    buyerEmails: new Set(seedRows.map((row) => row.email)),
  };
}

async function buildOwnersSeed(
  supabase: NonNullable<ReturnType<typeof createFeverReadOnlySupabaseClient>>
): Promise<string> {
  const [buyerEmails, ownerItems] = await Promise.all([
    fetchAllEmails(supabase, 'fever_orders', 'buyer_email'),
    fetchAllOwnerRows(supabase, true),
  ]);
  const buyerEmailSet = new Set(buyerEmails);

  const seedRows = mergeBestSeedRows(
    ownerItems
      .map((row) => {
        const orderGeo = getOrderGeo(row.fever_orders);
        return toSeedRow({
          email: row.owner_email,
          firstName: row.owner_first_name,
          lastName: row.owner_last_name,
          dob: row.owner_dob,
          city: orderGeo?.purchase_city,
          region: orderGeo?.purchase_region,
          postal: orderGeo?.purchase_postal,
          postalFallback: orderGeo?.billing_zip_code,
          country: orderGeo?.purchase_country,
        });
      })
      .filter((row): row is SeedRow => row !== null)
      .filter((row) => !buyerEmailSet.has(row.email))
  );

  return rowsToCsv(seedRows);
}

async function buildExclusionCsv(
  supabase: NonNullable<ReturnType<typeof createFeverReadOnlySupabaseClient>>
): Promise<string> {
  const [buyerEmails, ownerEmails] = await Promise.all([
    fetchAllEmails(supabase, 'fever_orders', 'buyer_email'),
    fetchAllEmails(supabase, 'fever_order_items', 'owner_email'),
  ]);

  const uniqueEmails = Array.from(new Set([...buyerEmails, ...ownerEmails])).sort((a, b) => a.localeCompare(b));
  return buildCsv(['email'], uniqueEmails.map((email) => [email]));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = getSeedType(searchParams.get('type'));

  if (!type) {
    return NextResponse.json({ error: 'Invalid type. Use buyers, owners, or exclusion.' }, { status: 400 });
  }

  const supabase = createFeverReadOnlySupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: GENERIC_EXPORT_ERROR }, { status: 500 });
  }

  try {
    const csv =
      type === 'buyers'
        ? (await buildBuyersSeed(supabase)).csv
        : type === 'owners'
          ? await buildOwnersSeed(supabase)
          : await buildExclusionCsv(supabase);

    const dateStamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileNameForSeedType(type, dateStamp)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    console.error('[Fever Lookalike Seed] Export failed');
    return NextResponse.json({ error: GENERIC_EXPORT_ERROR }, { status: 500 });
  }
}
