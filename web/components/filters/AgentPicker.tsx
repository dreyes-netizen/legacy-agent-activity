'use client';

// A checkbox-list dropdown, hand-rolled to match the AGS KPI App's
// MultiSelectFilter rather than pulling in a component library -- that app has
// @base-ui/react installed but unused, so a library dropdown here would be the
// odd one out rather than the consistent choice.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { HEADER_INPUT } from '@/components/ui/style';
import { cn } from '@/lib/utils';
import type { AgentOption } from '@/lib/metrics';

/** Must match the panel's w-64 below -- used to predict overflow before the
 *  panel has rendered, so it never visibly flips after opening. */
const PANEL_WIDTH_PX = 256;

export function AgentPicker({
  options,
  selected,
  onChange,
}: {
  options: AgentOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [align, setAlign] = useState<'left' | 'right'>('left');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function toggleOpen() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setAlign(rect.left + PANEL_WIDTH_PX > window.innerWidth - 8 ? 'right' : 'left');
      }
      return next;
    });
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const visible = query
    ? options.filter((option) => option.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  const label = selected.length === 0 ? 'All agents' : `${selected.length} selected`;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(HEADER_INPUT, 'flex items-center gap-1.5 cursor-pointer min-w-[9rem]')}
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown
          className={cn('w-3.5 h-3.5 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-40 mt-1 w-64 rounded-lg border border-border bg-white shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="p-2 border-b border-row-border">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
              className="w-full h-9 rounded-md border border-border px-2 text-base md:text-md outline-none focus:border-app-blue"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 && (
              <p className="px-3 py-2 text-md text-muted">No agents match.</p>
            )}
            {visible.map((option) => (
              <label
                key={option.ctmUserId}
                className="flex items-center gap-2 px-3 py-2 text-md cursor-pointer hover:bg-row-hover"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.ctmUserId)}
                  onChange={() => toggle(option.ctmUserId)}
                  className="accent-app-blue"
                />
                <span className="truncate">{option.name}</span>
              </label>
            ))}
          </div>

          {selected.length > 0 && (
            <div className="p-2 border-t border-row-border">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full h-9 rounded-md text-md text-app-blue hover:bg-row-hover transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
