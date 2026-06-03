import { PageHero } from '@/components/site/page-hero';
import { PreviewBanner } from '@/components/site/preview-banner';
import { ReleaseTable } from '@/components/site/release-table';
import { getLatestRelease } from '@/lib/releases';

const platformNotes = [
  {
    label: 'macOS',
    note: 'Universal DMGs ship separate Intel and Apple Silicon binaries so rollout teams can pick the right artifact quickly.',
    badge: 'arm64 · x64',
  },
  {
    label: 'Windows',
    note: 'Installer and portable executable builds are listed separately when both are published.',
    badge: 'x64',
  },
  {
    label: 'Linux',
    note: 'AppImage, Debian package, and portable tarball variants remain visible wherever they are published.',
    badge: 'x64',
  },
];

export default async function DownloadPage() {
  const latest = await getLatestRelease();

  return (
    <div className="mx-auto max-w-7xl space-y-12 px-5 py-12 sm:px-8 sm:py-16">
      <PageHero
        eyebrow="Download Preview"
        title="Install the current packaged desktop builds."
        summary="Release artifacts are sourced from GitHub Releases at build time. The download page falls back to a checked-in snapshot if remote metadata is unavailable during static export."
      />
      <PreviewBanner />
      {latest ? (
        <ReleaseTable release={latest} />
      ) : (
        <div className="section-frame rounded-2xl p-6 text-sm text-[var(--muted-foreground)]">
          No preview artifacts are currently available.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {platformNotes.map((p, i) => (
          <div
            key={p.label}
            className="section-frame tile reveal rounded-2xl p-6"
            style={{ animationDelay: `${100 + i * 80}ms` }}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[0.95rem] font-medium text-[var(--foreground-strong)]">{p.label}</p>
              <span className="tag">
                <span className="dot" />
                {p.badge}
              </span>
            </div>
            <p className="text-sm leading-7 text-[var(--muted-foreground)]">{p.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
