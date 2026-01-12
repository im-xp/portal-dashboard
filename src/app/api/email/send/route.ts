import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';
const SUPPORT_EMAIL = process.env.GMAIL_SUPPORT_ADDRESS || 'theportalsupport@icelandeclipse.com';

interface SendRequest {
  ticket_key: string;
  to_email: string;
  cc_emails?: string;
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

interface EmailHeaders {
  inReplyTo?: string;
  references?: string;
}

function buildRFC2822Email(
  from: string,
  to: string,
  cc: string | undefined,
  subject: string,
  body: string,
  threadingHeaders?: EmailHeaders
): string {
  const date = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@icelandeclipse.com>`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
  ];

  if (cc) {
    headers.push(`Cc: ${cc}`);
  }

  headers.push(
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
  );

  if (threadingHeaders?.inReplyTo) {
    headers.push(`In-Reply-To: ${threadingHeaders.inReplyTo}`);
  }
  if (threadingHeaders?.references) {
    headers.push(`References: ${threadingHeaders.references}`);
  }

  return `${headers.join('\r\n')}\r\n\r\n${body}`;
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
    const reqBody: SendRequest = await request.json();
    const { ticket_key, to_email, cc_emails, subject, body: emailBody, original_subject, thread_id } = reqBody;

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

    // Fetch last message for this ticket to get its Message-ID for proper threading
    let threadingHeaders: EmailHeaders | undefined;
    if (!subjectChanged && thread_id) {
      const { data: lastMessage } = await supabase
        .from('email_messages')
        .select('message_id')
        .eq('gmail_thread_id', thread_id)
        .order('internal_ts', { ascending: false })
        .limit(1)
        .single();

      if (lastMessage?.message_id) {
        threadingHeaders = {
          inReplyTo: lastMessage.message_id,
          references: lastMessage.message_id,
        };
        console.log('[Send API] Using threading headers:', threadingHeaders);
      }
    }

    const rawEmail = buildRFC2822Email(SUPPORT_EMAIL, to_email, cc_emails, subject, emailBody, threadingHeaders);
    const encodedEmail = encodeBase64Url(rawEmail);

    // Try with threadId first (for proper threading), fallback to no threadId if 404
    const useThreadId = !subjectChanged && thread_id;
    let usedThreadIdSuccessfully = false;
    let gmailPayload: { raw: string; threadId?: string } = { raw: encodedEmail };
    if (useThreadId) {
      gmailPayload.threadId = thread_id;
    }

    let gmailResponse = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gmailPayload),
    });

    // If 404 with threadId, retry without it (thread may not exist in user's delegated access)
    // The In-Reply-To and References headers will still maintain threading for the recipient
    if (!gmailResponse.ok && useThreadId) {
      const errorText = await gmailResponse.text();
      if (errorText.includes('404') || errorText.includes('notFound')) {
        console.log('[Send API] ThreadId not found, retrying without threadId (threading headers will maintain conversation)');
        gmailPayload = { raw: encodedEmail };
        gmailResponse = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gmailPayload),
        });
      }
    } else if (gmailResponse.ok && useThreadId) {
      usedThreadIdSuccessfully = true;
    }

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text();
      console.error('[Send API] Gmail error:', errorText);

      if (errorText.includes('Mail service not enabled') ||
          errorText.includes('Invalid from header') ||
          errorText.includes('not authorized')) {
        return NextResponse.json(
          { error: `Send As not configured. Please add ${SUPPORT_EMAIL} in your Gmail Settings → Accounts → "Send mail as".` },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: `Failed to send email: ${errorText}` },
        { status: 500 }
      );
    }

    const gmailResult: GmailSendResponse = await gmailResponse.json();

    // Only update thread mappings if we successfully used the original threadId
    // Otherwise we'd corrupt the ticket by pointing to a new thread that doesn't exist in the support inbox
    if (usedThreadIdSuccessfully) {
      await supabase.from('thread_ticket_mapping').upsert(
        {
          gmail_thread_id: gmailResult.threadId,
          ticket_key: ticket_key,
        },
        { onConflict: 'gmail_thread_id' }
      );
      await supabase
        .from('email_tickets')
        .update({ gmail_thread_id: gmailResult.threadId })
        .eq('ticket_key', ticket_key);
    } else {
      console.log('[Send API] Sent without threadId - not updating ticket thread mapping to avoid corruption');
    }

    const now = new Date().toISOString();

    await supabase.from('email_messages').insert({
      gmail_message_id: gmailResult.id,
      gmail_thread_id: gmailResult.threadId,
      from_email: SUPPORT_EMAIL,
      to_emails: [to_email],
      cc_emails: cc_emails ? cc_emails.split(',').map(e => e.trim()).filter(Boolean) : [],
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
        status: 'awaiting_customer_response',
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
