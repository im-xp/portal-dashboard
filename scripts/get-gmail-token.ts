/**
 * One-time script to get Gmail OAuth refresh token
 * 
 * Prerequisites:
 * 1. Create a Google Cloud project at https://console.cloud.google.com
 * 2. Enable Gmail API
 * 3. Create OAuth 2.0 credentials (Web application)
 * 4. Add http://localhost:3333/callback as authorized redirect URI
 * 
 * Usage:
 * 1. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local
 * 2. Run: npx tsx scripts/get-gmail-token.ts
 * 3. Open the URL in browser and authorize
 * 4. Copy the refresh token to .env.local as GOOGLE_REFRESH_TOKEN
 */

import { createServer } from 'http';
import { parse } from 'url';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.local');
  process.exit(1);
}

// Generate auth URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // Force refresh token

console.log('\n🔑 Gmail OAuth Token Generator\n');
console.log('1. Open this URL in your browser:');
console.log('\n   ' + authUrl.toString() + '\n');
console.log('2. Log in as theportalsupport@icelandeclipse.com');
console.log('3. Grant access to Gmail');
console.log('4. You will be redirected back here\n');
console.log('Waiting for callback...\n');

// Start server to receive callback
const server = createServer(async (req, res) => {
  const parsedUrl = parse(req.url || '', true);
  
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/callback') {
    const code = parsedUrl.query.code as string;
    
    if (!code) {
      res.writeHead(400);
      res.end('Missing authorization code');
      return;
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID!,
          client_secret: CLIENT_SECRET!,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
      });

      const tokens = await tokenResponse.json();

      if (tokens.error) {
        throw new Error(tokens.error_description || tokens.error);
      }

      console.log('✅ Success! Add this to your .env.local:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
            <h1>✅ Success!</h1>
            <p>Refresh token obtained. Check your terminal for the token.</p>
            <p>Add this to your <code>.env.local</code>:</p>
            <pre style="background: #f0f0f0; padding: 1rem; border-radius: 8px; overflow-x: auto;">GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}</pre>
            <p>You can close this window.</p>
          </body>
        </html>
      `);

      // Close server after a short delay
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1000);

    } catch (error) {
      console.error('❌ Error exchanging code:', error);
      res.writeHead(500);
      res.end('Error: ' + String(error));
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3333, () => {
  console.log('Server listening on http://localhost:3333');
});

