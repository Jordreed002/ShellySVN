import Link from 'next/link';
import { gitConfig, marketingLinks } from '@/lib/shared';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[rgba(10,11,17,0.78)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-3.5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_0_24px_-8px_rgba(124,124,245,0.6)]"
          >
            <img src="/brand/icon.png" alt="" className="h-5 w-5" />
          </span>
          <span className="text-[0.95rem] font-medium tracking-tight text-[var(--foreground-strong)]">
            ShellySVN
          </span>
          <span className="hidden rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-[var(--muted-foreground)] sm:inline">
            Preview
          </span>
        </Link>
        <nav className="hidden items-center gap-1 text-[0.875rem] text-[var(--muted-foreground)] md:flex">
          {marketingLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 hover:bg-[rgba(180,184,210,0.05)] hover:text-[var(--foreground-strong)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            className="btn btn-ghost hidden sm:inline-flex"
            aria-label="GitHub repository"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2 .37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </Link>
          <Link href="/docs" className="btn btn-secondary text-[0.82rem]">
            Docs
          </Link>
          <Link href="/download" className="btn btn-primary text-[0.82rem]">
            Download
          </Link>
        </div>
      </div>
    </header>
  );
}
