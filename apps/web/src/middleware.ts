import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Optimistic auth gate for /app/*. Uses a lightweight cookie check (no DB) per
 * Better Auth's recommended middleware pattern. Enforcement is opt-in via
 * AUTH_ENFORCE=true so the app stays explorable during local development.
 */
export function middleware(request: NextRequest) {
  if (process.env.AUTH_ENFORCE !== 'true') return NextResponse.next();

  const sessionCookie = getSessionCookie(request);
  if (request.nextUrl.pathname.startsWith('/app') && !sessionCookie) {
    const url = new URL('/auth/login', request.url);
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*'],
};
