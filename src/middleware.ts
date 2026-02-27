import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

const VOLUNTEER_VIEWER_ALLOWED = [
  '/',
  '/volunteers',
];

const VOLUNTEER_VIEWER_ALLOWED_PREFIXES = [
  '/auth',
  '/api/auth',
  '/api/volunteers',
];

export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role;

    if (!role) {
      return NextResponse.redirect(new URL('/auth/signin', req.url));
    }

    if (role === 'volunteer_viewer') {
      const { pathname } = req.nextUrl;

      const allowed =
        VOLUNTEER_VIEWER_ALLOWED.includes(pathname) ||
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
    '/((?!api/auth|api/email/sync|api/email/thread|api/cron|auth|_next/static|_next/image|favicon.ico).*)',
  ],
};
