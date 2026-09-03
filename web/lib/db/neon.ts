// Server-only Neon client. Neon is the only thing this dashboard reads: the
// Python sync in this repo keeps it current from the CallTrackingMetrics API,
// so no page ever waits on CTM.
//
// `@neondatabase/serverless` talks to Neon over HTTP rather than holding a TCP
// socket, so a single tagged-template `sql` instance is safe inside Next.js
// server code and serverless functions.
import 'server-only';
import { neon } from '@neondatabase/serverless';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add the Neon connection string to .env.local (see .env.example).',
    );
  }
  return url;
}

// `cache: 'no-store'` opts out of Next.js fetch-level caching. The sync writes
// every few minutes and the whole point of the freshness badge is that the
// number on screen is the number in the database.
export const sql = neon(getDatabaseUrl(), { fetchOptions: { cache: 'no-store' } });
