import Link from 'next/link';

export function PreviewBanner() {
  return (
    <div className="section-frame relative overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[var(--ember)] via-[var(--ember)]/40 to-transparent" />
      <div className="flex flex-col gap-4 pl-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-3xl space-y-2">
          <p className="eyebrow ember">Preview release</p>
          <p className="text-[0.98rem] leading-7 text-[var(--foreground)]">
            ShellySVN is currently best for <strong className="font-medium text-[var(--foreground-strong)]">browsing, sparse checkout, diffs, and packaging</strong>. For critical commits, keep your existing SVN client around until the preview stabilises.
          </p>
        </div>
        <Link
          href="/roadmap"
          className="btn btn-secondary shrink-0"
        >
          Known limitations →
        </Link>
      </div>
    </div>
  );
}
