import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  stripeAccounts,
  fetchAllCharges,
  chargeToDbRow,
  type StripeAccountConfig,
  type StripeAccountKey,
} from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AccountStats {
  accountKey: StripeAccountKey;
  label: string;
  chargesProcessed: number;
  chargesInserted: number;
  chargesUpdated: number;
  error?: string;
}

interface SyncStats {
  accountsProcessed: number;
  charges: {
    processed: number;
    inserted: number;
    updated: number;
  };
  accounts: AccountStats[];
  errors: string[];
}

async function syncAccount(cfg: StripeAccountConfig, isManual: boolean): Promise<AccountStats> {
  const stats: AccountStats = {
    accountKey: cfg.accountKey,
    label: cfg.label,
    chargesProcessed: 0,
    chargesInserted: 0,
    chargesUpdated: 0,
  };

  const { data: syncState, error: stateError } = await supabase
    .from('stripe_sync_state')
    .select('*')
    .eq('account_key', cfg.accountKey)
    .single();

  if (stateError) {
    console.error(`[Stripe Sync] ${cfg.accountKey}: failed to read sync state:`, stateError);
  }

  const lastCursor = isManual ? undefined : syncState?.last_charge_created_at;
  const sinceCreatedAt = lastCursor ? Math.floor(new Date(lastCursor).getTime() / 1000) : undefined;

  console.log(
    `[Stripe Sync] ${cfg.accountKey}: fetching charges${sinceCreatedAt ? ` since ${lastCursor}` : ' (all time)'}`
  );

  let charges;
  try {
    charges = await fetchAllCharges(cfg, sinceCreatedAt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.error = msg;
    await supabase
      .from('stripe_sync_state')
      .update({ last_error: msg, updated_at: new Date().toISOString() })
      .eq('account_key', cfg.accountKey);
    return stats;
  }

  console.log(`[Stripe Sync] ${cfg.accountKey}: fetched ${charges.length} charges`);

  if (charges.length === 0) {
    await supabase
      .from('stripe_sync_state')
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_key', cfg.accountKey);
    return stats;
  }

  const chargeIds = charges.map((c) => c.id);
  const existingIds = new Set<string>();
  const BATCH_SIZE = 500;
  for (let i = 0; i < chargeIds.length; i += BATCH_SIZE) {
    const batch = chargeIds.slice(i, i + BATCH_SIZE);
    const { data: existing } = await supabase
      .from('stripe_charges')
      .select('id')
      .in('id', batch);
    existing?.forEach((e) => existingIds.add(e.id));
  }

  const UPSERT_BATCH = 100;
  for (let i = 0; i < charges.length; i += UPSERT_BATCH) {
    const batch = charges.slice(i, i + UPSERT_BATCH);
    const rows = batch.map((c) => chargeToDbRow(cfg, c));

    const { error: upsertError } = await supabase
      .from('stripe_charges')
      .upsert(rows, { onConflict: 'id' });

    if (upsertError) {
      const msg = `Upsert batch ${i}: ${upsertError.message}`;
      stats.error = stats.error ? `${stats.error}; ${msg}` : msg;
      continue;
    }

    for (const c of batch) {
      stats.chargesProcessed++;
      if (existingIds.has(c.id)) {
        stats.chargesUpdated++;
      } else {
        stats.chargesInserted++;
      }
    }
  }

  let latestCreatedAt = syncState?.last_charge_created_at as string | null | undefined;
  let latestChargeId = syncState?.last_charge_id as string | null | undefined;
  for (const c of charges) {
    const ts = new Date(c.created * 1000).toISOString();
    if (!latestCreatedAt || ts > latestCreatedAt) {
      latestCreatedAt = ts;
      latestChargeId = c.id;
    }
  }

  await supabase
    .from('stripe_sync_state')
    .update({
      last_synced_at: new Date().toISOString(),
      last_charge_created_at: latestCreatedAt,
      last_charge_id: latestChargeId,
      charges_synced: (syncState?.charges_synced || 0) + stats.chargesInserted,
      last_error: stats.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('account_key', cfg.accountKey);

  return stats;
}

async function runSync(isManual = false): Promise<NextResponse> {
  const stats: SyncStats = {
    accountsProcessed: 0,
    charges: { processed: 0, inserted: 0, updated: 0 },
    accounts: [],
    errors: [],
  };

  const accounts = stripeAccounts();
  if (accounts.length === 0) {
    return NextResponse.json(
      {
        error: 'No Stripe accounts configured',
        configured: false,
        hint: 'Set STRIPE_KEY_PORTAL and/or STRIPE_KEY_ICELAND',
      },
      { status: 503 }
    );
  }

  try {
    for (const cfg of accounts) {
      const accountStats = await syncAccount(cfg, isManual);
      stats.accounts.push(accountStats);
      stats.accountsProcessed++;
      stats.charges.processed += accountStats.chargesProcessed;
      stats.charges.inserted += accountStats.chargesInserted;
      stats.charges.updated += accountStats.chargesUpdated;
      if (accountStats.error) stats.errors.push(`${accountStats.accountKey}: ${accountStats.error}`);
    }

    console.log('[Stripe Sync] Complete:', stats);

    return NextResponse.json({
      success: stats.errors.length === 0,
      stats,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Stripe Sync] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function buildStatus() {
  const { data: syncStates } = await supabase.from('stripe_sync_state').select('*');
  const { count: chargeCount } = await supabase
    .from('stripe_charges')
    .select('*', { count: 'exact', head: true });

  const byAccount: Record<string, { count: number }> = {};
  for (const key of ['portal', 'iceland']) {
    const { count } = await supabase
      .from('stripe_charges')
      .select('*', { count: 'exact', head: true })
      .eq('account_key', key);
    byAccount[key] = { count: count || 0 };
  }

  return {
    status: 'ok',
    configured: {
      portal: !!process.env.STRIPE_KEY_PORTAL,
      iceland: !!process.env.STRIPE_KEY_ICELAND,
    },
    totalCharges: chargeCount || 0,
    byAccount,
    syncStates,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get('status') === 'true') {
    return NextResponse.json(await buildStatus());
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return runSync(false);
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const isManual = searchParams.get('manual') === 'true';

  return runSync(isManual);
}
