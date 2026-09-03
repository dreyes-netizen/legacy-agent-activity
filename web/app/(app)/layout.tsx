import type { ReactNode } from 'react';
import { ClientLayout } from '@/components/layout/ClientLayout';

// Route group for the authenticated app shell. /login sits outside it so the
// login screen renders without the sidebar and mobile nav.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <ClientLayout>{children}</ClientLayout>;
}
