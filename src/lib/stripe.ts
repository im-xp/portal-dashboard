/**
 * Stripe client for read-only charge sync.
 *
 * Uses fetch directly against /v1/charges — no npm dependency on the stripe
 * package. Restricted keys with charges:read scope are sufficient.
 *
 * Auth: HTTP Basic with the key as username and empty password.
 */

const STRIPE_HOST = 'api.stripe.com';
const CHARGES_PAGE_SIZE = 100; // Stripe max

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;

export type StripeAccountKey = 'portal' | 'iceland';

export interface StripeAccountConfig {
  accountKey: StripeAccountKey;
  accountId: string;
  label: string;
  apiKey: string;
}

export interface StripeCharge {
  id: string;
  object: 'charge';
  amount: number;
  amount_refunded: number;
  currency: string;
  status: string;
  refunded: boolean;
  description: string | null;
  statement_descriptor: string | null;
  payment_intent: string | null;
  invoice: string | null;
  customer: string | null;
  billing_details: {
    email: string | null;
    name: string | null;
  } | null;
  metadata: Record<string, string> | null;
  created: number;
}

export interface StripeChargeRow {
  id: string;
  account_key: StripeAccountKey;
  account_id: string;
  amount_cents: number;
  currency: string;
  amount_refunded_cents: number;
  refunded: boolean;
  status: string;
  description: string | null;
  statement_descriptor: string | null;
  payment_intent_id: string | null;
  invoice_id: string | null;
  customer_id: string | null;
  billing_email: string | null;
  billing_name: string | null;
  metadata: Record<string, string> | null;
  created_at: string;
  synced_at: string;
}

const ACCOUNT_META: Record<StripeAccountKey, { accountId: string; label: string; envVar: string }> = {
  portal: {
    accountId: 'acct_1ST3U3BiqMeveVBC',
    label: 'The Portal',
    envVar: 'STRIPE_KEY_PORTAL',
  },
  iceland: {
    accountId: 'acct_1SUU6nDMeFk2ZRT3',
    label: 'Iceland Eclipse',
    envVar: 'STRIPE_KEY_ICELAND',
  },
};

export function stripeAccounts(): StripeAccountConfig[] {
  const configs: StripeAccountConfig[] = [];
  for (const key of Object.keys(ACCOUNT_META) as StripeAccountKey[]) {
    const meta = ACCOUNT_META[key];
    const apiKey = process.env[meta.envVar];
    if (!apiKey) continue;
    configs.push({
      accountKey: key,
      accountId: meta.accountId,
      label: meta.label,
      apiKey,
    });
  }
  return configs;
}

export function stripeAccountConfigured(key: StripeAccountKey): boolean {
  return !!process.env[ACCOUNT_META[key].envVar];
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stripeGet<T>(apiKey: string, path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`https://${STRIPE_HOST}${path}`, {
        headers: {
          Authorization: authHeader(apiKey),
          'Stripe-Version': '2024-06-20',
        },
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`Stripe ${response.status} on ${path}`);
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Stripe ${response.status} on ${path}: ${text}`);
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES - 1) break;
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

/**
 * Fetch all charges for an account, paginated via starting_after.
 * If sinceCreatedAt is provided, only fetches charges created strictly after it.
 */
export async function fetchAllCharges(
  cfg: StripeAccountConfig,
  sinceCreatedAt?: number
): Promise<StripeCharge[]> {
  const charges: StripeCharge[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const params = new URLSearchParams();
    params.set('limit', String(CHARGES_PAGE_SIZE));
    if (startingAfter) params.set('starting_after', startingAfter);
    if (sinceCreatedAt) params.set('created[gt]', String(sinceCreatedAt));

    const page = await stripeGet<StripeList<StripeCharge>>(
      cfg.apiKey,
      `/v1/charges?${params.toString()}`
    );

    charges.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return charges;
}

export function chargeToDbRow(cfg: StripeAccountConfig, c: StripeCharge): StripeChargeRow {
  return {
    id: c.id,
    account_key: cfg.accountKey,
    account_id: cfg.accountId,
    amount_cents: c.amount,
    currency: c.currency,
    amount_refunded_cents: c.amount_refunded ?? 0,
    refunded: !!c.refunded,
    status: c.status,
    description: c.description ?? null,
    statement_descriptor: c.statement_descriptor ?? null,
    payment_intent_id: c.payment_intent ?? null,
    invoice_id: c.invoice ?? null,
    customer_id: c.customer ?? null,
    billing_email: c.billing_details?.email ?? null,
    billing_name: c.billing_details?.name ?? null,
    metadata: c.metadata && Object.keys(c.metadata).length > 0 ? c.metadata : null,
    created_at: new Date(c.created * 1000).toISOString(),
    synced_at: new Date().toISOString(),
  };
}
