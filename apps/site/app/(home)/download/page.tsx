import Link from 'next/link';
import { Band } from '@/components/site/band';
import { Icon } from '@/components/site/icons';
import { PageHero } from '@/components/site/page-hero';
import { PreviewBanner } from '@/components/site/preview-banner';
import { ReleaseTable } from '@/components/site/release-table';
import { getLatestRelease } from '@/lib/releases';
import { bundledSvnVersion, gitConfig, licenceResolved } from '@/lib/shared';

const platformNotes = [
  {
    label: 'macOS',
    badge: 'arm64 · x64',
    note: 'macOS 14 Sonoma or newer. Separate artifacts for Apple silicon and Intel. Gatekeeper will ask you to confirm on first launch — the builds are not notarised yet.',
    icon: 'apple' as const,
  },
  {
    label: 'Windows',
    badge: 'x64',
    note: 'Windows 10 and 11. The installer is per-user by default, so it needs no administrator rights. SmartScreen will warn because the build is unsigned.',
    icon: 'windows' as const,
  },
  {
    label: 'Linux',
    badge: 'x64',
    note: 'glibc 2.31 or newer. AppImage runs without root or a package manager; deb, rpm and tarball variants are published alongside it.',
    icon: 'linux' as const,
  },
];

export default async function DownloadPage() {
  const latest = await getLatestRelease();

  return (
    <>
      <PageHero
        eyebrow="Download · free"
        title={
          <>
            Everything is in the download, <em>including Subversion</em>.
          </>
        }
        summary={
          <>
            No account, no licence key, no package manager. Pick your platform, and{' '}
            <strong>Subversion {bundledSvnVersion} comes with it</strong>. Works against any SVN
            server from 1.6 up, and runs alongside the CLI or TortoiseSVN on the same working copy.
          </>
        }
      />

      <Band tight>
        <PreviewBanner />
      </Band>

      <Band alt n="01">
        <div className="section-head" style={{ marginBottom: '2rem' }}>
          <p className="kicker">Choose a build</p>
          <h2 className="display">
            Three platforms, <em>one codebase</em>.
          </h2>
        </div>
        {latest ? (
          <ReleaseTable release={latest} />
        ) : (
          <div className="section-frame rounded-2xl p-6 text-sm text-[var(--muted-foreground)]">
            No preview artifacts are currently available. Builds are published on{' '}
            <Link href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/releases`}>
              GitHub Releases
            </Link>
            .
          </div>
        )}
        <div className="features" style={{ marginTop: '1rem' }}>
          {platformNotes.map((p) => (
            <article className="section-frame tile feature-card" key={p.label}>
              <div className="head">
                <h3>
                  <Icon
                    name={p.icon}
                    style={{
                      display: 'inline-block',
                      width: 16,
                      height: 16,
                      verticalAlign: '-2px',
                      marginRight: 8,
                      color: 'var(--accent)',
                    }}
                  />
                  {p.label}
                </h3>
                <span className="tag">
                  <span className="dot" />
                  {p.badge}
                </span>
              </div>
              <p>{p.note}</p>
            </article>
          ))}
        </div>
      </Band>

      <Band n="02">
        <div className="split">
          <div>
            <p className="kicker">After it opens</p>
            <h2
              className="display"
              style={{ fontSize: 'clamp(1.85rem,3.6vw,2.8rem)', marginTop: '0.9rem' }}
            >
              Three things, <em>then a working copy.</em>
            </h2>
            <p className="lede" style={{ maxWidth: '44ch' }}>
              There is no setup wizard and no account step. The install guide covers the
              platform-specific first-launch prompts in more detail.
            </p>
            <div className="actions" style={{ display: 'flex', gap: 10, marginTop: '1.5rem' }}>
              <Link className="btn btn-secondary" href="/docs/getting-started/install">
                <Icon name="book" />
                Install guide
              </Link>
              <Link className="btn btn-ghost" href="/docs/workflows/sparse-checkout">
                Sparse checkout →
              </Link>
            </div>
          </div>
          <ul className="claims">
            {[
              'Paste your repository URL — https://, svn:// or svn+ssh://',
              'Sign in with the credentials you already use',
              'Choose a checkout depth — the size is shown before anything is fetched',
              'Or point it at a working copy you already have on disk',
            ].map((step) => (
              <li className="exhibit" key={step}>
                <Icon name="check" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      </Band>

      <Band alt n="03">
        <div className="section-head">
          <p className="kicker">Build it yourself</p>
          <h2 className="display">
            The same commands <em>CI runs</em>.
          </h2>
          <p className="lede">
            If you would rather not trust our binary, the client builds from source in four lines.
          </p>
        </div>
        {!licenceResolved ? (
          <div className="callout warn" style={{ maxWidth: '64ch', marginTop: '1.5rem' }}>
            <Icon name="warn" />
            <div>
              <p>
                <b>The licence is not settled.</b> The source is public, but there is no{' '}
                <code>LICENSE</code> file in the repository and no <code>license</code> field in{' '}
                <code>package.json</code>. Until one lands, the terms for forking, vendoring or
                redistributing this are unresolved — worth knowing before it goes on a company
                image.
              </p>
            </div>
          </div>
        ) : null}
      </Band>
    </>
  );
}
