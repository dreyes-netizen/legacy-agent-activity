import { LayoutGrid, CalendarClock, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  /** Short form for the mobile tab bar, where width is tight. */
  short: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { href: '/',       label: 'Overview', short: 'Home',   icon: LayoutGrid },
  { href: '/shifts', label: 'Shifts',   short: 'Shifts', icon: CalendarClock },
];
