import { NextRequest, NextResponse } from 'next/server';
import * as postmark from 'postmark';

// Initialize Postmark client
const postmarkClient = new postmark.ServerClient(
  process.env.POSTMARK_SERVER_TOKEN || ''
);

// Team members to notify
const NOTIFY_EMAILS = (process.env.NOTIFY_EMAILS || 'jon@im-xp.com').split(',');
const FROM_EMAIL = process.env.FROM_EMAIL || 'notifications@im-xp.com';

// Webhook secret for verification (optional but recommended)
const WEBHOOK_SECRET = process.env.NOCODB_WEBHOOK_SECRET || '';

interface NocoDB_WebhookPayload {
  type: 'records.after.update' | 'records.after.insert';
  data: {
    table_name: string;
    previous_rows?: Array<Record<string, unknown>>;
    rows: Array<{
      id: number;
      application_id: number;
      status: string;
      amount: number;
      currency: string;
      coupon_code?: string;
      discount_value?: number;
      created_at: string;
      updated_at: string;
      // Linked fields from NocoDB
      applications?: {
        id: number;
        first_name: string;
        last_name?: string;
        email?: string;
      };
    }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    // Optional: Verify webhook secret
    const authHeader = request.headers.get('x-webhook-secret');
    if (WEBHOOK_SECRET && authHeader !== WEBHOOK_SECRET) {
      console.error('Webhook secret mismatch');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload: NocoDB_WebhookPayload = await request.json();
    console.log('Received NocoDB webhook:', JSON.stringify(payload, null, 2));

    // Only process payment updates
    if (payload.data.table_name !== 'payments') {
      return NextResponse.json({ message: 'Ignored - not payments table' });
    }

    // Check if this is a status change to 'approved'
    for (let i = 0; i < payload.data.rows.length; i++) {
      const row = payload.data.rows[i];
      const previousRow = payload.data.previous_rows?.[i];

      // Only notify if status changed TO 'approved' (not if it was already approved)
      const wasApproved = previousRow?.status === 'approved';
      const isNowApproved = row.status === 'approved';

      if (isNowApproved && !wasApproved) {
        await sendPaymentNotification(row);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function sendPaymentNotification(payment: NocoDB_WebhookPayload['data']['rows'][0]) {
  const applicantName = payment.applications 
    ? `${payment.applications.first_name} ${payment.applications.last_name || ''}`.trim()
    : `Application #${payment.application_id}`;
  
  const applicantEmail = payment.applications?.email || 'unknown';
  
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: payment.currency || 'USD',
  }).format(payment.amount);

  const discountInfo = payment.coupon_code 
    ? `\nDiscount Code: ${payment.coupon_code} ($${payment.discount_value || 0} off)`
    : '';

  const subject = `🎉 New Payment: ${applicantName} - ${amount}`;
  
  const textBody = `
New payment completed!

Buyer: ${applicantName}
Email: ${applicantEmail}
Amount: ${amount}${discountInfo}

Payment ID: ${payment.id}
Time: ${new Date(payment.updated_at).toLocaleString()}

View in dashboard: ${process.env.NEXT_PUBLIC_APP_URL || 'https://your-dashboard.vercel.app'}/attendees
  `.trim();

  const htmlBody = `
    <div style="font-family: system-ui, sans-serif; max-width: 500px;">
      <h2 style="color: #16a34a;">🎉 New Payment Completed!</h2>
      
      <table style="border-collapse: collapse; width: 100%;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Buyer</td>
          <td style="padding: 8px 0; font-weight: 600;">${applicantName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Email</td>
          <td style="padding: 8px 0;">${applicantEmail}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Amount</td>
          <td style="padding: 8px 0; font-weight: 600; color: #16a34a;">${amount}</td>
        </tr>
        ${payment.coupon_code ? `
        <tr>
          <td style="padding: 8px 0; color: #666;">Discount</td>
          <td style="padding: 8px 0;">${payment.coupon_code} ($${payment.discount_value || 0} off)</td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding: 8px 0; color: #666;">Time</td>
          <td style="padding: 8px 0;">${new Date(payment.updated_at).toLocaleString()}</td>
        </tr>
      </table>
      
      <p style="margin-top: 24px;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://your-dashboard.vercel.app'}/attendees" 
           style="background: #18181b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          View in Dashboard
        </a>
      </p>
    </div>
  `;

  // Send to all team members
  for (const email of NOTIFY_EMAILS) {
    try {
      await postmarkClient.sendEmail({
        From: FROM_EMAIL,
        To: email.trim(),
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
      });
      console.log(`Payment notification sent to ${email}`);
    } catch (err) {
      console.error(`Failed to send to ${email}:`, err);
    }
  }
}

// Also handle GET for health check
export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    endpoint: 'payment-approved webhook',
    configured: !!process.env.POSTMARK_SERVER_TOKEN,
  });
}

