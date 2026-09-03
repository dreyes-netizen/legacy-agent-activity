import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const runtime = 'nodejs';

// POST-only: signing out changes state, so it must not be reachable by a GET
// that a link prefetcher or crawler could fire.
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.nextUrl.origin), {
    status: 303,
  });
  response.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return response;
}
