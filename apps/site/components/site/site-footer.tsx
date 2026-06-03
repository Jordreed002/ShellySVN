import Link from 'next/link';
import { appTagline, gitConfig, marketingLinks } from '@/lib/shared';

export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-[var(--border)] bg-[rgba(10,11,17,0.6)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/40 to-transparent" />
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-14 sm:px-8 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]"
            >
              <img src="/brand/icon.png" alt="" className="h-5 w-5" />
            </span>
            <span className="text-[0.95rem] font-medium text-[var(--foreground-strong)]">
              ShellySVN
            </span>
          </div>
          <p className="max-w-md text-sm leading-7 text-[var(--muted-foreground)]">{appTagline}</p>
          <p className="text-[0.75rem] text-[var(--dim)]">
            Bundles Subversion 1.14 · no external dependencies required
          </p>
        </div>
        <div>
          <p className="kicker mb-4">Site</p>
          <div className="space-y-2.5 text-sm text-[var(--muted-foreground)]">
            {marketingLinks.map((item) => (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className="text-[0.875rem] hover:text-[var(--foreground-strong)]"
                >
                  {item.label}
                </Link>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="kicker mb-4">Source</p>
          <Link
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            className="text-[0.875rem] text-[var(--muted-foreground)] hover:text-[var(--foreground-strong)]"
          >
            github.com/{gitConfig.user}
            <br />
            /{gitConfig.repo}
          </Link>
        </div>
        <div>
          <p className="kicker mb-4">Platforms</p>
          <ul className="space-y-2.5 text-[0.875rem] text-[var(--muted-foreground)]">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_currentColor]" />
              macOS · arm64 / x64
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_currentColor]" />
              Windows · x64
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_currentColor]" />
              Linux · x64
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-5 text-[0.75rem] text-[var(--dim)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>A modern Subversion client for professionals.</p>
          <p>
            Preview channel · built {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </footer>
  );
}
