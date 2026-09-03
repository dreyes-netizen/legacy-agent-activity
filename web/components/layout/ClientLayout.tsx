'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';

export function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-ground">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* pb accounts for MobileNav's own height (h-14) plus the home-indicator safe area it
            pads itself by -- a plain pb-16 isn't enough on notched phones, where the inset
            alone can exceed the slack that leaves, letting the nav cover the last content. */}
        <main className="flex-1 overflow-y-auto relative pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          {children}
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
