// Shared-password session handling.
//
// The cookie is an HMAC-signed expiry stamp, nothing more -- there is one
// shared credential, so there is no user identity to carry. Signing (rather
// than storing a bare "loggedIn=1") is what stops anyone simply setting the
// cookie themselves.
//
// Everything here uses Web Crypto so it runs unchanged in middleware, which
// may execute on the edge runtime where Node's `crypto` module is unavailable.

const encoder = new TextEncoder();

export const SESSION_COOKIE = 'laa_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12h -- roughly one shift

function requireSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_SECRET is not set. Add a long random string to .env.local (see .env.example).',
    );
  }
  return secret;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(requireSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Returns an ArrayBuffer rather than a Uint8Array: crypto.subtle.verify wants a
// BufferSource backed by a plain ArrayBuffer, and a Uint8Array's buffer is typed
// as ArrayBufferLike (which may be a SharedArrayBuffer) so it does not satisfy it.
function fromBase64Url(value: string): ArrayBuffer | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return buffer;
  } catch {
    return null;
  }
}

/** Signed token carrying only its own expiry. */
export async function createSessionToken(now: Date = new Date()): Promise<string> {
  const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = String(expiresAt);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * True only for a token whose signature verifies AND whose expiry is in the
 * future. Signature is checked before expiry so a tampered payload can never
 * reach the expiry comparison.
 */
export async function verifySessionToken(
  token: string | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (!token) return false;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = fromBase64Url(token.slice(separator + 1));
  if (!signature) return false;

  // crypto.subtle.verify does the comparison itself, so no hand-rolled
  // (and easily non-constant-time) byte loop is needed.
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(),
    signature,
    encoder.encode(payload),
  );
  if (!valid) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Math.floor(now.getTime() / 1000);
}

/**
 * Constant-time password comparison.
 *
 * Both sides are hashed to a fixed 32 bytes first, so the XOR accumulation
 * below cannot leak the password's length through an early exit -- which a
 * plain `a === b` or a length check would.
 */
export async function passwordMatches(submitted: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(submitted)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}
