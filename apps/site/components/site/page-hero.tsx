import type { ReactNode } from 'react';

/**
 * The interior-page header, in the Bands language: kicker, display heading,
 * lede constrained to a readable measure, optional actions row.
 */
export function PageHero({
  eyebrow,
  title,
  summary,
  children,
}: {
  children?: ReactNode;
  eyebrow: string;
  summary: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className="wrap page-head">
      <p className="kicker reveal reveal-1">{eyebrow}</p>
      <h1 className="reveal reveal-2">{title}</h1>
      <p className="lede reveal reveal-3">{summary}</p>
      {children ? <div className="actions reveal reveal-4">{children}</div> : null}
    </header>
  );
}
