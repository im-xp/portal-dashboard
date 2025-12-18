import { NextRequest, NextResponse } from 'next/server';
import * as postmark from 'postmark';

// Config
const NOTIFY_EMAILS = (process.env.NOTIFY_EMAILS || 'jon@im-xp.com, theportal@icelandeclipse.com').split(',');
const FROM_EMAIL = process.env.FROM_EMAIL || 'notifications@im-xp.com';
const NOCODB_URL = (process.env.NOCODB_URL || 'https://app.nocodb.com/api/v2').trim();
const NOCODB_TOKEN = (process.env.NOCODB_TOKEN || '').trim();
const TABLE_APPLICATIONS = (process.env.NOCODB_TABLE_APPLICATIONS || 'mhiveeaf8gb9kvy').trim();
const TABLE_PAYMENT_PRODUCTS = (process.env.NOCODB_TABLE_PAYMENT_PRODUCTS || 'm9y11y6lwwxuq6k').trim();

// Postmark client
let postmarkClient: postmark.ServerClient | null = null;
function getPostmarkClient(): postmark.ServerClient | null {
  if (!process.env.POSTMARK_SERVER_TOKEN) return null;
  if (!postmarkClient) {
    postmarkClient = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
  }
  return postmarkClient;
}

// Fetch from NocoDB API
async function fetchFromNocoDB(endpoint: string): Promise<Record<string, unknown> | null> {
  const url = `${NOCODB_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    
    // Extract rows from NocoDB webhook format
    // Format: { type, data: { rows: [...], previous_rows: [...] } }
    const rows = payload?.data?.rows || payload?.rows || (Array.isArray(payload) ? payload : [payload]);
    const previousRows = payload?.data?.previous_rows || payload?.previous_rows || [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const prev = previousRows[i];
      
      // Only process if status changed TO 'approved'
      if (row?.status === 'approved' && prev?.status !== 'approved') {
        await sendEmail(row);
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function sendEmail(payment: Record<string, unknown>) {
  // 1. EXTRACT PAYMENT ID
  const paymentId = Number(payment.id) || 0;
  
  // 2. GET APPLICANT NAME AND EMAIL
  // First try embedded data from webhook
  const embedded = payment.applications as Record<string, unknown> | null;
  let name = '';
  let email = '';
  
  if (embedded) {
    name = String(embedded.first_name || '');
    if (embedded.last_name) name += ' ' + String(embedded.last_name);
    email = String(embedded.email || '');
  }
  
  // If we have embedded.id but missing name/email, fetch full application
  const appId = embedded?.id || payment.application_id;
  if (appId && (!name || !email)) {
    const appData = await fetchFromNocoDB(`/tables/${TABLE_APPLICATIONS}/records?where=(id,eq,${appId})`);
    const app = (appData as { list?: Record<string, unknown>[] })?.list?.[0];
    if (app) {
      if (!name) {
        name = String(app.first_name || '');
        if (app.last_name) name += ' ' + String(app.last_name);
      }
      if (!email) {
        email = String(app.email || '');
      }
    }
  }
  
  name = name.trim() || 'Unknown';
  email = email.trim() || 'unknown';
  
  // 3. GET ITEMS PURCHASED
  const items: string[] = [];
  if (paymentId > 0) {
    const ppData = await fetchFromNocoDB(`/tables/${TABLE_PAYMENT_PRODUCTS}/records?where=(payment_id,eq,${paymentId})`);
    const ppList = (ppData as { list?: Record<string, unknown>[] })?.list || [];
    for (const pp of ppList) {
      const productName = String(pp.product_name || 'Item');
      const qty = Number(pp.quantity) || 1;
      const price = Number(pp.product_price) || 0;
      items.push(`${productName}${qty > 1 ? ` x${qty}` : ''} - $${price.toFixed(2)}`);
    }
  }
  
  // 4. FORMAT AMOUNT
  const amount = Number(payment.amount) || 0;
  const currency = String(payment.currency || 'USD');
  const formattedAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  
  // 5. BUILD EMAIL CONTENT
  const subject = `🎉 New Payment: ${name} - ${formattedAmount}`;
  
  const itemsHtml = items.length > 0
    ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top;">Items</td><td style="padding:8px 0;">${items.map(i => `<div>• ${i}</div>`).join('')}</td></tr>`
    : '';
  
  const htmlBody = `
<div style="font-family:system-ui,sans-serif;max-width:500px;">
  <h2 style="color:#16a34a;">🎉 New Payment Completed!</h2>
  <table style="border-collapse:collapse;width:100%;">
    <tr><td style="padding:8px 0;color:#666;">Buyer</td><td style="padding:8px 0;font-weight:600;">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;">${email}</td></tr>
    ${itemsHtml}
    <tr><td style="padding:8px 0;color:#666;">Total</td><td style="padding:8px 0;font-weight:600;color:#16a34a;">${formattedAmount}</td></tr>
  </table>
  <p style="margin-top:24px;">
    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://portal-dashboard-imxp.vercel.app'}/people" 
       style="background:#18181b;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">
      View in Dashboard
    </a>
  </p>
</div>`;

  const textBody = `New Payment: ${name} (${email}) - ${formattedAmount}\nItems: ${items.join(', ') || 'None listed'}`;

  // 6. SEND EMAIL
  const client = getPostmarkClient();
  if (!client) {
    console.log('Postmark not configured');
    return;
  }
  
  for (const to of NOTIFY_EMAILS) {
    try {
      await client.sendEmail({
        From: FROM_EMAIL,
        To: to.trim(),
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
      });
      console.log(`Email sent to ${to}: ${name}, ${email}, ${items.length} items, ${formattedAmount}`);
    } catch (err) {
      console.error(`Failed to send to ${to}:`, err);
    }
  }
}

export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    configured: !!process.env.POSTMARK_SERVER_TOKEN,
  });
}
