import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { supabase } from './supabase';

const ALLOWED_DOMAINS = ['im-xp.com', 'icelandeclipse.com'];

const VOLUNTEER_VIEWER_EMAILS = ['volunteers@icelandeclipse.com'];

export type UserRole = 'admin' | 'volunteer_viewer';

function resolveRole(email: string): UserRole {
  return VOLUNTEER_VIEWER_EMAILS.includes(email.toLowerCase())
    ? 'volunteer_viewer'
    : 'admin';
}

export function isAllowedDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_DOMAINS.includes(domain);
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email || !isAllowedDomain(user.email)) {
        console.log('[Auth] Rejected sign-in for:', user.email);
        return false;
      }

      if (account && supabase) {
        const expiresAt = account.expires_at
          ? new Date(account.expires_at * 1000).toISOString()
          : null;

        console.log('[Auth] Saving tokens for:', user.email, {
          hasAccessToken: !!account.access_token,
          hasRefreshToken: !!account.refresh_token,
          expiresAt,
        });

        const { error } = await supabase.from('users').upsert(
          {
            email: user.email,
            name: user.name,
            picture: user.image,
            google_access_token: account.access_token,
            google_refresh_token: account.refresh_token,
            token_expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'email' }
        );

        if (error) {
          console.error('[Auth] Failed to save user tokens:', error);
        } else {
          console.log('[Auth] Successfully saved tokens for:', user.email);
        }
      } else {
        console.warn('[Auth] Missing account or supabase client', {
          hasAccount: !!account,
          hasSupabase: !!supabase
        });
      }

      return true;
    },
    async jwt({ token, account, user }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      if (user) {
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        token.role = resolveRole(user.email || '');
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.image = token.picture as string;
        session.user.role = token.role || 'admin';
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
};
