import Link from 'next/link';
import { Band } from '@/components/site/band';
import { Icon } from '@/components/site/icons';
import { PageHero } from '@/components/site/page-hero';
import { getSiteReleases } from '@/lib/releases';

export default async function ChangelogPage() {
  const releases = await getSiteReleases();

  return (
    <>
      <PageHero
        eyebrow="Changelog"
        title={
          <>
            What changed, <em>and when</em>.
          </>
        }
        summary={
          <>
            Release notes for every published build, sourced from GitHub Releases at build time.
            Preview releases are listed here the same as stable ones —{' '}
            <strong>nothing is hidden until it is finished</strong>.
          </>
        }
      >
        <Link className="btn btn-primary btn-lg" href="/download">
          <Icon name="dl" />
          Download the current build
        </Link>
        <Link className="btn btn-secondary btn-lg" href="/roadmap">
          What&rsquo;s next →
        </Link>
      </PageHero>

      <Band tight>
        {releases.length ? (
          releases.map((release) => (
            <div className="cl-entry" key={release.tag}>
              <div>
                <p className="v">{release.tag}</p>
                <p className="date">
                  {new Date(release.publishedAt).toLocaleDateString('en-GB', { dateStyle: 'long' })}
                </p>
                <p style={{ marginTop: '0.7rem' }}>
                  <span className="tag preview">
                    <span className="dot" />
                    {release.channel}
                  </span>
                </p>
              </div>
              <div>
                {release.bodyMd ? (
                  <p className="notes">{release.bodyMd}</p>
                ) : (
                  <p className="notes" style={{ color: 'var(--faint)' }}>
                    No release notes were published with this tag.
                  </p>
                )}
                <p style={{ marginTop: '1rem' }}>
                  <Link className="btn btn-secondary" href={release.notesUrl}>
                    <Icon name="ext" />
                    Open release
                  </Link>
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="lede">No releases have been published yet.</p>
        )}
      </Band>

      <Band alt>
        <div className="callout" style={{ maxWidth: '70ch', marginTop: 0 }}>
          <Icon name="help" />
          <div>
            <p>
              <b>Versioning.</b> Minor releases carry a theme and an exit gate; patch releases fix
              defects and never add surface. If a change needs a new setting or a new pane, it waits
              for a minor.
            </p>
            <p>
              Full commit history and release artifacts live on GitHub. Every entry above
              corresponds to a tagged release.
            </p>
          </div>
        </div>
      </Band>
    </>
  );
}
