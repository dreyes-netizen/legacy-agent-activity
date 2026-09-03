import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  passwordMatches,
} from '@/lib/auth/session';

// Plain form POST rather than a fetch() so login works with no client JS.
export const runtime = 'nodejs';

/**
 * Fixed delay on every failure.
 *
 * This is a speed bump, not real rate limiting -- a shared password on a public
 * URL is brute-forceable and serverless instances share no memory, so there is
 * nowhere to keep an attempt counter without a round trip. If this app ends up
 * somewhere reachable, put a real rate limit in front of it (Vercel Firewall,
 * or an attempts table in Neon).
 */
const FAILURE_DELAY_MS = 400;

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), { status: 303 });
}

function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === 'string' ? raw : '';
  // Only same-origin absolute paths -- never a protocol-relative "//evil.com"
  // or a full URL, which would turn login into an open redirect.
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export async function POST(request: NextRequest) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: 'DASHBOARD_PASSWORD is not configured on the server.' },
      { status: 500 },
    );
  }

  const form = await request.formData();
  const submitted = form.get('password');
  const next = safeNext(form.get('next'));

  const ok =
    typeof submitted === 'string' && (await passwordMatches(submitted, expected));

  if (!ok) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    const login = new URL('/login', request.nextUrl.origin);
    login.searchParams.set('error', '1');
    if (next !== '/') login.searchParams.set('next', next);
    return NextResponse.redirect(login, { status: 303 });
  }

  const response = redirectTo(request, next);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionToken(),
    httpOnly: true, // unreadable from JS, so an XSS cannot lift the session
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
