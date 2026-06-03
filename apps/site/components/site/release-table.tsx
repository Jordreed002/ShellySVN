import type { SiteRelease } from '@/lib/types';

function formatBytes(size?: number) {
  if (!size) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function ReleaseTable({ release }: { release: SiteRelease }) {
  return (
    <div className="section-frame overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">{release.channel}</p>
          <h2 className="mt-4 text-3xl">
            Downloads for <em>{release.tag}</em>
          </h2>
          <p className="mt-2 text-[0.85rem] text-[var(--muted-foreground)]">
            Published{' '}
            {new Date(release.publishedAt).toLocaleDateString('en-GB', { dateStyle: 'long' })}
          </p>
        </div>
        <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--dim)]">
          {release.artifacts.length} artifacts
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[rgba(180,184,210,0.02)] text-[0.72rem] uppercase tracking-[0.14em] text-[var(--dim)]">
              <th className="px-6 py-3.5 font-normal">Platform</th>
              <th className="px-6 py-3.5 font-normal">Arch</th>
              <th className="px-6 py-3.5 font-normal">Package</th>
              <th className="px-6 py-3.5 font-normal">Size</th>
              <th className="px-6 py-3.5 font-normal">Artifact</th>
            </tr>
          </thead>
          <tbody>
            {release.artifacts.map((artifact) => (
              <tr
                key={artifact.fileName}
                className="border-t border-[var(--border)] transition-colors hover:bg-[rgba(180,184,210,0.025)]"
              >
                <td className="px-6 py-4 font-medium text-[var(--foreground-strong)]">
                  {artifact.platform}
                </td>
                <td className="px-6 py-4 font-mono text-[0.82rem] text-[var(--muted-foreground)]">
                  {artifact.arch}
                </td>
                <td className="px-6 py-4 text-[var(--muted-foreground)]">{artifact.label}</td>
                <td className="px-6 py-4 font-mono text-[0.82rem] text-[var(--muted-foreground)]">
                  {formatBytes(artifact.sizeBytes)}
                </td>
                <td className="px-6 py-4">
                  <a
                    href={artifact.downloadUrl}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-[0.82rem] text-[var(--foreground-strong)] hover:border-[var(--accent-ring)] hover:text-[var(--accent-bright)]"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M8 2v9m0 0l-3-3m3 3l3-3M3 14h10"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {artifact.fileName}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
