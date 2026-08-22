import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A full-bleed section band.
 *
 * Alternating `alt` bands against a hairline give a long page the landmarks a
 * single continuous background does not. `n` sets the section number in the
 * left margin.
 */
export function Band({
  children,
  alt,
  tight,
  n,
  id,
  className,
}: {
  children: ReactNode;
  alt?: boolean;
  tight?: boolean;
  n?: string;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={cn('band', alt && 'alt', tight && 'tight', className)}>
      <div className="wrap">
        {n ? <span className="band-n">{n}</span> : null}
        {children}
      </div>
    </section>
  );
}
