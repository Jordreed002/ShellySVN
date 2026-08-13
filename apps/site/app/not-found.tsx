import Link from 'next/link';
import { Icon, IconSprite } from '@/components/site/icons';
import { ReleaseStrip } from '@/components/site/release-strip';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="site-shell">
      <IconSprite />
      <ReleaseStrip />
      <SiteHeader />
      <main className="wrap">
        <section className="notfound">
          <p className="code">404</p>
          <h1>That path is not in this working copy.</h1>
          <p>
            The page you asked for does not exist, or it moved. Nothing was deleted — unlike a
            repository, this site has no history to check.
          </p>
          <div className="actions">
            <Link className="btn btn-primary btn-lg" href="/">
              <Icon name="shell" />
              Back to the overview
            </Link>
            <Link className="btn btn-secondary btn-lg" href="/docs">
              <Icon name="book" />
              Search the docs
            </Link>
          </div>
          <div className="links">
            <Link href="/features">Features</Link>
            <Link href="/download">Download</Link>
            <Link href="/docs">Documentation</Link>
            <Link href="/roadmap">Roadmap</Link>
            <Link href="/changelog">Changelog</Link>
            <Link href="/faq">FAQ</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
