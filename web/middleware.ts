import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

// Gate every page and API route behind the shared password. The matcher below
// is an allow-list of what stays public, so a route added later is protected
// by default rather than exposed by omission.
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) {
    return NextResponse.next();
  }

  // An unauthenticated API call should get a status, not an HTML login page --
  // otherwise a fetch() from a stale tab "succeeds" with a page of markup.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  // Preserve where they were headed so the filters in a shared link survive
  // being bounced through login.
  const intended = request.nextUrl.pathname + request.nextUrl.search;
  if (intended && intended !== '/') {
    login.searchParams.set('next', intended);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Everything except the login page, the auth endpoint, Next's static
    // assets, and files with an extension (favicon, images).
    '/((?!login|api/auth|_next/static|_next/image|.*\\.[\\w]+$).*)',
  ],
};
