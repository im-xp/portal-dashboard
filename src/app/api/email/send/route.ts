import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

interface SendRequest {
  ticket_key: string;
  to_email: string;
  subject: string;
  body: string;
  original_subject: string;
  thread_id: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GmailSendResponse {
  id: string;
  threadId: string;
  labelIds: string[];
}

async function refreshUserToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh token: ${error}`);
  }

  const data: TokenResponse = await response.json();
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

function buildRFC2822Email(
  from: string,
  to: string,
  subject: string,
  body: string
): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const date = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@icelandeclipse.com>`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
  ].join('\r\n');

  return `${headers}\r\n\r\n${body}`;
}

function encodeBase64Url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.user.email;
    const body: SendRequest = await request.json();
    const { ticket_key, to_email, subject, body: emailBody, original_subject, thread_id } = body;

    if (!ticket_key || !to_email || !subject || !emailBody) {
      return NextResponse.json(
        { error: 'Missing required fields: ticket_key, to_email, subject, body' },
        { status: 400 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('google_access_token, google_refresh_token, token_expires_at')
      .eq('email', userEmail)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User tokens not found. Please sign in again.' },
        { status: 401 }
      );
    }

    if (!user.google_refresh_token) {
      return NextResponse.json(
        { error: 'No refresh token available. Please sign out and sign in again.' },
        { status: 401 }
      );
    }

    let accessToken = user.google_access_token;
    const tokenExpiresAt = user.token_expires_at ? new Date(user.token_expires_at) : null;
    const isTokenExpired = !tokenExpiresAt || tokenExpiresAt <= new Date(Date.now() + 60000);

    if (isTokenExpired) {
      const refreshed = await refreshUserToken(user.google_refresh_token);
      accessToken = refreshed.accessToken;

      await supabase
        .from('users')
        .update({
          google_access_token: refreshed.accessToken,
          token_expires_at: refreshed.expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('email', userEmail);
    }

    const subjectChanged = subject.trim().toLowerCase() !== original_subject.trim().toLowerCase();
    const rawEmail = buildRFC2822Email(userEmail, to_email, subject, emailBody);
    const encodedEmail = encodeBase64Url(rawEmail);

    const gmailPayload: { raw: string; threadId?: string } = { raw: encodedEmail };
    if (!subjectChanged && thread_id) {
      gmailPayload.threadId = thread_id;
    }

    const gmailResponse = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gmailPayload),
    });

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text();
      console.error('[Send API] Gmail error:', errorText);
      return NextResponse.json(
        { error: `Failed to send email: ${errorText}` },
        { status: 500 }
      );
    }

    const gmailResult: GmailSendResponse = await gmailResponse.json();

    if (subjectChanged && gmailResult.threadId !== thread_id) {
      await supabase.from('thread_ticket_mapping').upsert(
        {
          gmail_thread_id: gmailResult.threadId,
          ticket_key: ticket_key,
        },
        { onConflict: 'gmail_thread_id' }
      );
    }

    const now = new Date().toISOString();

    await supabase.from('email_messages').insert({
      gmail_message_id: gmailResult.id,
      gmail_thread_id: gmailResult.threadId,
      from_email: userEmail,
      to_emails: [to_email],
      cc_emails: [],
      subject: subject,
      snippet: emailBody.slice(0, 200),
      internal_ts: now,
      direction: 'outbound',
      is_noise: false,
    });

    await supabase
      .from('email_tickets')
      .update({
        last_outbound_ts: now,
        responded_by: userEmail,
        responded_at: now,
        status: 'awaiting_customer',
        claimed_by: null,
        claimed_at: null,
      })
      .eq('ticket_key', ticket_key);

    await logActivity(ticket_key, 'responded', userEmail);

    return NextResponse.json({
      success: true,
      message_id: gmailResult.id,
      thread_id: gmailResult.threadId,
      subject_changed: subjectChanged,
    });
  } catch (error) {
    console.error('[Send API] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
