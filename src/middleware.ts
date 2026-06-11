import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { canAccessWhatsApp } from '@/lib/whatsapp-access';

const VOLUNTEER_VIEWER_ALLOWED = [
  '/',
  '/volunteers',
];

const VOLUNTEER_VIEWER_ALLOWED_PREFIXES = [
  '/auth',
  '/api/auth',
  '/api/volunteers',
  '/api/segments',
  '/api/applications',
];

export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role;

    if (!role) {
      return NextResponse.redirect(new URL('/auth/signin', req.url));
    }

    if (role === 'volunteer_viewer') {
      const { pathname } = req.nextUrl;

      // /whatsapp holds non-buyer PII — per-email allowlist, not role-wide
      const isWhatsApp =
        pathname.startsWith('/whatsapp') || pathname.startsWith('/api/whatsapp');

      const allowed = isWhatsApp
        ? canAccessWhatsApp(req.nextauth.token?.email, role)
        : VOLUNTEER_VIEWER_ALLOWED.includes(pathname) ||
          VOLUNTEER_VIEWER_ALLOWED_PREFIXES.some(prefix => pathname.startsWith(prefix));

      if (!allowed) {
        return NextResponse.redirect(new URL('/volunteers', req.url));
      }

      if (pathname === '/') {
        return NextResponse.redirect(new URL('/volunteers', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/auth/signin',
    },
  }
);

export const config = {
  matcher: [
    '/((?!api/auth|api/email/sync|api/email/thread|api/cron|api/finances/aggregate|auth|_next/static|_next/image|favicon.ico).*)',
  ],
};
