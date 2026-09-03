'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from './navItems';

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border flex md:hidden print:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 h-14 min-w-0 transition-colors duration-150 ${
              active ? 'text-navy' : 'text-muted hover:text-app-text'
            }`}
          >
            <Icon className="w-5 h-5 shrink-0" aria-hidden="true" strokeWidth={active ? 2.5 : 2} />
            <span className="text-[10px] font-medium leading-tight text-center truncate max-w-full px-1">
              {item.short}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
