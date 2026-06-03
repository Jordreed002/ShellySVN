import type { ReactNode } from 'react';

export function PageHero({
  eyebrow,
  title,
  summary,
  children,
}: {
  children?: ReactNode;
  eyebrow: string;
  summary: string;
  title: string;
}) {
  return (
    <header className="mb-12 space-y-6">
      <p className="eyebrow reveal reveal-1">{eyebrow}</p>
      <div className="max-w-4xl">
        <h1 className="display reveal reveal-2 text-5xl leading-[0.98] sm:text-6xl lg:text-[5rem]">
          {title}
        </h1>
        <p className="reveal reveal-3 mt-6 max-w-2xl text-lg leading-8 text-[var(--muted-foreground)]">
          {summary}
        </p>
      </div>
      {children ? <div className="reveal reveal-4">{children}</div> : null}
    </header>
  );
}
