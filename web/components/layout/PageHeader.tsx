import Link from 'next/link';
import type { ReactNode } from 'react';

interface Breadcrumb {
  href: string;
  label: string;
}

interface PageHeaderProps {
  breadcrumb?: Breadcrumb | Breadcrumb[];
  /** Uppercase eyebrow label above the title. Hidden when breadcrumb is set. */
  label?: string;
  title: string;
  subtitle?: string;
  /** Extra content appended after the subtitle, in the same wrapping row (e.g. the
   *  sync-freshness badge) -- deliberately inline rather than a new stacked row, so it
   *  doesn't add header height. Wraps to its own line only on narrow viewports. */
  meta?: ReactNode;
  /** Right-aligned controls (filters, buttons). */
  actions?: ReactNode;
}

export function PageHeader({
  breadcrumb,
  label,
  title,
  subtitle,
  meta,
  actions,
}: PageHeaderProps) {
  const crumbs: Breadcrumb[] = breadcrumb
    ? Array.isArray(breadcrumb)
      ? breadcrumb
      : [breadcrumb]
    : [];

  return (
    <div className="bg-navy px-4 md:px-8 py-3 md:py-4 print:hidden">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          {crumbs.length > 0 ? (
            <div className="mb-1.5 flex items-center gap-1.5">
              {crumbs.map((crumb, index) => (
                <span key={crumb.href} className="flex items-center gap-1.5">
                  {index > 0 && <span className="text-white/30 text-2xs">/</span>}
                  <Link
                    href={crumb.href}
                    className="inline-flex items-center py-2 -my-2 font-mono text-2xs tracking-mono-widest uppercase text-white/50 hover:text-white/80 transition-colors"
                  >
                    {index === 0 && '← '}
                    {crumb.label}
                  </Link>
                </span>
              ))}
            </div>
          ) : (
            label && (
              <p className="mb-1 font-mono text-2xs tracking-mono-widest uppercase text-white/50">
                {label}
              </p>
            )
          )}

          <h1 className="text-xl md:text-2xl font-semibold text-white tracking-tight truncate">
            {title}
          </h1>

          {(subtitle || meta) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {subtitle && <p className="text-sm text-white/60">{subtitle}</p>}
              {meta}
            </div>
          )}
        </div>

        {actions && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
