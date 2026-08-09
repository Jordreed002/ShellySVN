import { PageHero } from '@/components/site/page-hero';
import { getSiteReleases } from '@/lib/releases';

export default async function ChangelogPage() {
  const releases = await getSiteReleases();

  return (
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHero
        eyebrow="Changelog"
        title="Release notes sourced from GitHub metadata."
        summary="This page lists the release feed used by the download surface. It is built from GitHub Releases at build time and falls back to a checked-in snapshot when remote metadata is unavailable."
      />
      <div className="space-y-4">
        {releases.map((release) => (
          <article key={release.tag} className="section-frame rounded-3xl p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="eyebrow">{release.channel}</p>
                <h2 className="mt-4 text-3xl">{release.tag}</h2>
              </div>
              <a
                href={release.notesUrl}
                className="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm font-medium text-stone-900 hover:bg-white"
              >
                Open release
              </a>
            </div>
            <p className="mt-4 text-sm text-stone-700">
              Published{' '}
              {new Date(release.publishedAt).toLocaleDateString('en-GB', { dateStyle: 'long' })}
            </p>
            {release.bodyMd ? (
              <pre className="mt-5 overflow-x-auto rounded-3xl bg-[#141210] p-5 text-sm leading-7 text-stone-200 whitespace-pre-wrap">
                {release.bodyMd}
              </pre>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
