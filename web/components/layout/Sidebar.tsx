'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { navItems, type NavItem } from './navItems';

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-md transition-colors duration-150 ${
        active
          ? 'bg-white/10 text-white'
          : 'text-white/65 hover:bg-white/[0.07] hover:text-white/85'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0 opacity-80" aria-hidden="true" strokeWidth={2} />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const currentSection = navItems.find((item) => isActive(pathname, item.href))?.label ?? 'Agent Activity';

  return (
    <aside
      aria-label="Main navigation"
      className="w-[220px] bg-navy flex flex-col flex-shrink-0 h-screen max-md:hidden print:hidden"
    >
      <div className="px-5 py-[18px] border-b border-white/[0.07] flex flex-col items-center gap-2.5">
        {/* White plate because the mark is mostly dark (average rgb(63,96,149))
            and would disappear against the navy. object-contain because the
            source is 1.153:1, not square -- a fixed square would squash it. */}
        <div className="w-16 h-16 rounded-xl bg-white flex items-center justify-center p-2">
          <Image
            src="/agslogo.png"
            // Empty alt: "Alliance Global Solutions" is rendered as text
            // immediately below, so a described image would be announced twice.
            alt=""
            width={512}
            height={444}
            priority
            className="w-full h-auto object-contain"
          />
        </div>
        <div className="text-center">
          <p className="font-mono text-2xs tracking-mono-widest uppercase text-white/60 mb-0.5">
            Alliance Global Solutions
          </p>
          <p className="text-md font-semibold text-white tracking-tight">Agent Activity</p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex-1 px-2.5 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </nav>

      <div className="border-t border-white/[0.07] px-3 py-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-white/85 truncate">{currentSection}</p>
          <p className="text-xs text-white/50 truncate">Alliance Global Solutions</p>
        </div>
        {/* A form, not a link: signing out is a state change, so it must not be
            reachable by a GET that a prefetcher or crawler could trigger. */}
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="p-1.5 -m-1.5 rounded-md text-white/50 hover:text-white/85 hover:bg-white/[0.07] transition-colors"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </aside>
  );
}
