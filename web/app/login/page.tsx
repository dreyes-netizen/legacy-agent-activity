import Image from 'next/image';
import { AlertCircle } from 'lucide-react';
import { CARD, INPUT, LABEL, MICRO_LABEL } from '@/components/ui/style';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Sign in — Agent Activity' };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const failed = searchParams.error === '1';
  // Only same-origin paths are honoured; the POST handler re-validates, so a
  // crafted ?next=//evil.com cannot turn login into an open redirect.
  const next = searchParams.next?.startsWith('/') && !searchParams.next.startsWith('//')
    ? searchParams.next
    : '/';

  return (
    <div className="min-h-screen bg-ground flex items-center justify-center px-4 py-10">
      <div className={cn(CARD, 'w-full max-w-sm p-6 animate-fade-in-up')}>
        <div className="flex flex-col items-center gap-2.5 mb-6">
          {/* No plate here: the card is already white, and the mark is dark, so
              it reads on its own. A navy plate would have hidden it. */}
          <Image
            src="/agslogo.png"
            alt=""
            width={512}
            height={444}
            priority
            className="h-14 w-auto object-contain"
          />
          <div className="text-center">
            <p className={cn(MICRO_LABEL, 'text-2xs mb-0.5')}>Alliance Global Solutions</p>
            <h1 className="text-lg font-semibold tracking-tight">Agent Activity</h1>
          </div>
        </div>

        <form action="/api/auth" method="post" className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />

          <div>
            <label htmlFor="password" className={LABEL}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              aria-invalid={failed || undefined}
              aria-describedby={failed ? 'login-error' : undefined}
              className={INPUT}
            />
          </div>

          {failed && (
            <p
              id="login-error"
              role="alert"
              className="flex items-center gap-1.5 text-xs text-nte-red"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              Incorrect password.
            </p>
          )}

          <button
            type="submit"
            className="h-11 md:h-9 rounded-md bg-app-blue text-white text-md font-medium transition-colors duration-100 hover:bg-app-blue/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/40 focus-visible:ring-offset-2"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
