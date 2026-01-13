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
 * Get message with metadata only (for sync)
 */
export async function getMessage(messageId: string): Promise<GmailMessage> {
  const token = await getAccessToken();

  const response = await fetch(
    `${GMAIL_API_BASE}/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID`,
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
 * Get full message including body (for AI summarization)
 */
export async function getMessageFull(messageId: string): Promise<GmailMessage & { body?: string }> {
  const token = await getAccessToken();

  const response = await fetch(
    `${GMAIL_API_BASE}/users/me/messages/${messageId}?format=full`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get message ${messageId}: ${error}`);
  }

  const message = await response.json();
  
  // Extract body from payload
  const body = extractBody(message.payload);
  
  return { ...message, body };
}

/**
 * Extract plain text body from Gmail message payload
 */
function extractBody(payload: GmailMessage['payload'] & { body?: { data?: string }; parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }> }): string {
  if (!payload) return '';

  // Check for body data directly on payload
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Check parts for text/plain first
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      // Recursively check nested parts
      if (part.parts) {
        const nested = extractBody(part as typeof payload);
        if (nested) return nested;
      }
    }
    // Fallback to text/html if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return htmlToText(html);
      }
    }
  }

  return '';
}

/**
 * Decode base64url encoded string
 */
function decodeBase64Url(data: string): string {
  // Replace URL-safe characters and decode
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Convert HTML email to plain text while preserving paragraph structure
 * This is critical for quote detection which relies on line breaks
 */
function htmlToText(html: string): string {
  let text = html;

  // Convert block elements to newlines BEFORE stripping tags
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Blockquotes become newlines (quote detection relies on "On ... wrote:" patterns)
  text = text.replace(/<blockquote[^>]*>/gi, '\n');
  text = text.replace(/<\/blockquote>/gi, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Normalize whitespace while preserving newlines
  // Replace multiple spaces with single space (but not newlines)
  text = text.replace(/[^\S\n]+/g, ' ');
  // Collapse multiple newlines to max 2
  text = text.replace(/\n{3,}/g, '\n\n');
  // Trim whitespace from each line
  text = text.split('\n').map(line => line.trim()).join('\n');

  return text.trim();
}

/**
 * Decode HTML entities (&#39; -> ', &amp; -> &, etc.)
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // Must be last
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
  'im-xp.com',
  'icelandeclipse.com',
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
 * Check if a subject indicates a forwarded email
 */
export function isForwardedEmail(subject: string): boolean {
  const normalizedSubject = subject.toLowerCase().trim();
  return normalizedSubject.startsWith('fwd:') || normalizedSubject.startsWith('fw:');
}

/**
 * Extract the original sender's email from a forwarded email body
 * Looks for patterns like:
 * - "From: Name <email@example.com>"
 * - "---------- Forwarded message ---------\nFrom: Name <email@example.com>"
 */
export function extractForwardedSender(emailBody: string): string | null {
  if (!emailBody) return null;
  
  // Pattern 1: Gmail forward format "---------- Forwarded message ---------\nFrom: Name <email>"
  const gmailForwardMatch = emailBody.match(
    /-{5,}\s*Forwarded message\s*-{5,}[\s\S]*?From:\s*(?:[^<\n]*<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i
  );
  if (gmailForwardMatch) {
    return gmailForwardMatch[1].toLowerCase();
  }
  
  // Pattern 2: Simple "From: email@example.com" at start of forward
  const simpleFromMatch = emailBody.match(
    /^[\s\S]{0,500}From:\s*(?:[^<\n]*<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/im
  );
  if (simpleFromMatch) {
    const extractedEmail = simpleFromMatch[1].toLowerCase();
    // Make sure it's not an internal sender
    if (!isInternalSender(extractedEmail)) {
      return extractedEmail;
    }
  }
  
  return null;
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
  return isInternalSender(fromEmail) ? 'outbound' : 'inbound';
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

/**
 * Strip quoted content from email body
 * Removes reply chains, forwarded message markers, and quote blocks
 * to keep only the new/original content
 */
export function stripQuotedContent(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const resultLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Gmail/standard quote marker start: "On [day], [month] [date]..."
    // These often wrap across lines, so detect the start pattern
    if (/^On\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d)/i.test(trimmed)) {
      // Look ahead to see if "wrote:" appears within next few lines
      const lookAhead = lines.slice(i, i + 4).join(' ');
      if (/wrote:\s*$/i.test(lookAhead) || /> wrote:/i.test(lookAhead)) {
        break;
      }
    }

    // Line ends with "wrote:" (catches wrapped Gmail quotes)
    if (/>\s*wrote:\s*$/i.test(trimmed)) {
      break;
    }

    // Outlook style: "-----Original Message-----" or "---------- Forwarded message ---------"
    if (/^-{3,}\s*(Original Message|Forwarded message)/i.test(trimmed)) {
      break;
    }

    // Block of consecutive quoted lines (3+ lines starting with >)
    if (trimmed.startsWith('>')) {
      let quoteCount = 0;
      for (let j = i; j < lines.length && j < i + 5; j++) {
        if (lines[j].trim().startsWith('>')) quoteCount++;
      }
      if (quoteCount >= 3) {
        break;
      }
    }

    resultLines.push(line);
  }

  return resultLines.join('\n').trim();
}

