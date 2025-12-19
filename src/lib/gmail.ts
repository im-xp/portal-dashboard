// Gmail API client for email queue sync

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';
const SUPPORT_EMAIL = process.env.GMAIL_SUPPORT_ADDRESS || 'theportalsupport@icelandeclipse.com';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

// Cache for access token
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getAccessToken(): Promise<string> {
  // Check if we have a valid cached token
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth credentials not configured');
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
  
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  return cachedToken.token;
}

/**
 * List messages matching a query
 */
export async function listMessages(query: string, maxResults = 100): Promise<GmailListResponse> {
  const token = await getAccessToken();
  
  const params = new URLSearchParams({
    q: query,
    maxResults: maxResults.toString(),
  });

  const response = await fetch(
    `${GMAIL_API_BASE}/users/me/messages?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list messages: ${error}`);
  }

  return response.json();
}

/**
 * Get full message details
 */
export async function getMessage(messageId: string): Promise<GmailMessage> {
  const token = await getAccessToken();

  const response = await fetch(
    `${GMAIL_API_BASE}/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get message ${messageId}: ${error}`);
  }

  return response.json();
}

/**
 * Extract header value from message
 */
export function getHeader(message: GmailMessage, name: string): string | null {
  const header = message.payload?.headers?.find(
    h => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value || null;
}

/**
 * Parse email address from header (handles "Name <email>" format)
 */
export function parseEmailAddress(header: string | null): string | null {
  if (!header) return null;
  
  // Match email in angle brackets or standalone email
  const match = header.match(/<([^>]+)>/) || header.match(/([^\s,]+@[^\s,]+)/);
  return match ? match[1].toLowerCase().trim() : null;
}

/**
 * Parse multiple email addresses from header
 */
export function parseEmailAddresses(header: string | null): string[] {
  if (!header) return [];
  
  const emails: string[] = [];
  // Split by comma and parse each
  const parts = header.split(',');
  for (const part of parts) {
    const email = parseEmailAddress(part);
    if (email) emails.push(email);
  }
  return emails;
}

/**
 * Internal sender addresses/domains that should not create tickets
 */
const INTERNAL_SENDERS = [
  'theportalsupport@icelandeclipse.com',
  'theportal@icelandeclipse.com',
  'hallo@icelandeclipse.com',
  'hello@icelandeclipse.com',
  'sarah@icelandeclipse.com',
  // Add more internal addresses as needed
];

const INTERNAL_DOMAINS = [
  'im-xp.com', // Internal team domain
];

/**
 * Check if an email is from an internal sender (should not create tickets)
 */
export function isInternalSender(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  
  // Check exact matches
  if (INTERNAL_SENDERS.includes(normalized)) {
    return true;
  }
  
  // Check domain matches
  const domain = normalized.split('@')[1];
  if (domain && INTERNAL_DOMAINS.includes(domain)) {
    return true;
  }
  
  return false;
}

/**
 * Check if a message is noise (auto-reply, bounce, etc.)
 */
export function isNoiseMessage(message: GmailMessage): boolean {
  const from = getHeader(message, 'From')?.toLowerCase() || '';
  
  // Check for common noise senders
  const noiseSenders = [
    'mailer-daemon@',
    'postmaster@',
    'no-reply@',
    'noreply@',
    'donotreply@',
  ];
  
  if (noiseSenders.some(ns => from.includes(ns))) {
    return true;
  }

  // Check for auto-reply headers (would need full headers for this)
  // For now, just check sender patterns
  
  return false;
}

/**
 * Determine message direction based on sender
 */
export function getMessageDirection(fromEmail: string): 'inbound' | 'outbound' {
  const supportEmail = SUPPORT_EMAIL.toLowerCase();
  return fromEmail.toLowerCase() === supportEmail ? 'outbound' : 'inbound';
}

/**
 * Build Gmail deep link for a thread
 * Uses the inbox view with thread ID for direct access
 */
export function buildGmailLink(threadId: string): string {
  // Format: /mail/u/0/#inbox/<threadId> for delegated access
  // The user will be viewing theportalsupport@ mailbox
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

